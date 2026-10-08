"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { detectCategory, runExtractionPipeline } from "@/lib/docai/pipeline";
import { createStubCaller } from "@/lib/docai/stubCaller";
import { createAnthropicCaller } from "@/lib/ai/anthropicCaller";
import { dollars, loadMonthSpend } from "@/lib/data/docaiUsage";
import type { ModelCaller } from "@/lib/docai/pipeline";
import { getCategory } from "@/lib/docai/categories";
import { normalizeGpa } from "@/lib/docai/gpa";
// Shared with the grading-scale entry screen on purpose. A table typed
// in by a coordinator and one read off a scan need the same check, and
// keeping two copies is how they drift.
import { gradingScaleProblem } from "@/lib/fit/ncaa/gradingScale";
import {
  checkIngestedRecord,
  decodedByteLength,
  isPlausibleBase64,
  MAX_RECORDS_PER_UPLOAD,
} from "@/lib/docai/acceptance";
import { MAX_INGEST_BYTES } from "@/lib/docai/limits";
import { isRealDate } from "@/lib/docai/lenient";
import { isStaleProcessing } from "@/lib/data/documentState";
import { moveLifecycle } from "@/lib/data/vault";
import { checkVaultFile, readerCanRead, type VaultFormat } from "@/lib/vault/format";
import { didNotLookLike, isLifecycle, isStaleProcessing as isStaleLifecycle } from "@/lib/vault/lifecycle";
import { planFieldRestore, readableColumn } from "@/lib/data/undoPlan";
import { applyFinancialAid, applyMetricsReport, applyOfferLetter, applyRecommendation, applyTestScores, fillHighSchoolFromTranscript, undoContact, undoDetail, undoMetrics, undoTarget, type FieldChange, type TargetChange } from "@/lib/data/applyExtraction";
import { recomputeFitsForAthlete } from "@/lib/data/fits";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { applyRefusal, isStubReading, readerFor } from "@/lib/data/readBy";
import { applyExtractedEdits } from "@/lib/data/extractedEdit";
import { clampCredit, COURSE_SUBJECTS, MAX_COURSE_GRADE, MAX_COURSE_SCHOOL, MAX_COURSE_TERM, MAX_COURSE_TITLE } from "@/lib/validation/course";
import { CATEGORY_SCHEMAS } from "@/lib/docai/categories";
import type { DocCategoryId, IngestedRecord, ResolverAthlete, SourceRole, StoredRecord, TriageResult } from "@/lib/docai/types";

// The caller side of src/lib/docai. The pipeline deliberately returns a
// result and never writes anything, because org_id, RLS and the athlete
// row live out here (see the header comment in pipeline.ts). This file is
// where a pipeline result becomes a row.
//
// Ingestion does NOT happen here. src/lib/docai/ingest.ts depends on
// File/FileReader/createImageBitmap/canvas and runs in the browser, which
// is why it was verified with Playwright rather than vitest. The client
// hands this action already-ingested records.

// True when no real model is configured. Every screen that shows a result
// produced this way says so out loud rather than implying a document was
// actually read. Lives here and not in src/lib/docai, which stays free of
// environment and framework specifics per CLAUDE.md.
export async function isStubbedModel(): Promise<boolean> {
  return !process.env.ANTHROPIC_API_KEY;
}

// The model that reads a document when a key is set. Named here, and
// handed to the pipeline, so documents.read_by records the model that
// actually did the reading.
const EXTRACTION_MODEL = "claude-opus-5";

// Whether this document's reading may be written onto an athlete, and if
// not, why (audit wired F1). The one gate for both ways a reading lands:
// the Apply button and the pipeline's own auto-apply. A document the
// stand-in read is refused forever, anything is refused while no key is
// set, and a document read before read_by existed needs the model ledger
// to show a real call for it. See src/lib/data/readBy.ts.
async function applyGate(orgId: string, documentId: string | null): Promise<string | null> {
  const stubbed = await isStubbedModel();
  if (!documentId) return applyRefusal({ readBy: null, stubbed, ledgerShowsRealRead: false });
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("read_by").eq("id", documentId).eq("org_id", orgId).maybeSingle();
  const readBy = ((data as { read_by?: string | null } | null)?.read_by ?? null) || null;
  let ledgerShowsRealRead = false;
  if (readBy === null && !stubbed) {
    const { data: calls } = await supabase.from("docai_usage").select("id").eq("org_id", orgId).eq("document_id", documentId).limit(1);
    ledgerShowsRealRead = ((calls ?? []) as unknown[]).length > 0;
  }
  return applyRefusal({ readBy, stubbed, ledgerShowsRealRead });
}

// The model that reads a document. With no API key on the server, the
// stub, which every screen labels as simulated. With one, the real
// caller, which writes every call's tokens and cost to the org's ledger
// (docai_usage) so the month's cap in processDocument means something.
async function modelCallerFor(orgId: string, documentId: string, stub: { category: DocCategoryId; seedText: string }): Promise<ModelCaller> {
  if (await isStubbedModel()) return createStubCaller(stub);
  const supabase = await createClient();
  return createAnthropicCaller({
    onUsage: async (u) => {
      const { error } = await supabase.from("docai_usage").insert({
        org_id: orgId,
        document_id: documentId,
        request_id: u.requestId,
        model: u.model,
        input_tokens: u.inputTokens,
        output_tokens: u.outputTokens,
        cache_read_tokens: u.cacheReadTokens,
        cache_write_tokens: u.cacheWriteTokens,
        cost_cents: u.costCents,
      });
      // A call that cannot be recorded cannot be allowed to count as
      // read: the cap would never fill. The pipeline files the throw as
      // a failed extraction and the document says so.
      if (error) throw new Error(`The reading was done but could not be recorded (${error.message}), so it was not used.`);
    },
  });
}

export interface ProcessResult {
  ok: boolean;
  // The document to open. With several files in one go, the first.
  documentId?: string;
  // Every document this upload made, in order.
  documentIds?: string[];
  error?: string;
}

// One file the browser put in the bucket, bytes untouched. `reader` is the
// copy the existing reader reads: set only for a file someone tagged with
// one of the six types and that the reader can read (PDF, JPG, PNG). For a
// PDF it points at the same object as the original; for a photo it is the
// shrunk copy the browser made, stored next to the original.
export interface OriginalUpload {
  storagePath: string;
  name: string;
  reader?: StoredRecord | null;
}

// What applying a document changed, stored on documents.applied_changes
// so discarding it can put things back. See migrations/0011.
interface AppliedChanges {
  athleteId: string;
  // Column name to the value before this apply and the value it wrote.
  // Both are needed: the undo restores a field only when its current
  // value still matches `after`, so a correction made by hand after the
  // apply is left alone rather than reverted.
  athleteFields: Record<string, { before: unknown; after: unknown }>;
  // Set only when this document CREATED a shared grading-scale row.
  // Never set when it found one already there, because first writer wins
  // and undoing this document must not delete somebody else's table.
  gradingScaleId: string | null;
  // athletes.detail keys a test score document wrote.
  detail?: Record<string, FieldChange>;
  // The recruiting target an offer letter or an award letter touched.
  target?: TargetChange;
  // The contact a recommendation letter added.
  contactId?: string | null;
  // The metric entries a metrics report logged.
  metricIds?: string[];
  // Course rows from OTHER documents that this apply superseded. They
  // are gone and an undo cannot bring them back, so it says so rather
  // than implying a clean reversal.
  coursesSuperseded: number;
}

interface ApplyOutcome {
  warnings: string[];
  changes: AppliedChanges;
  // True when the gate refused the reading and nothing was written.
  refused?: boolean;
}

// Returns the reason to refuse, or null to proceed. Decoding happens
// here rather than in src/lib/docai, which stays free of Node specifics
// per CLAUDE.md; the check itself is the pure function in acceptance.ts.
function validateRecords(records: IngestedRecord[]): string | null {
  if (records.length > MAX_RECORDS_PER_UPLOAD) {
    return `That is ${records.length} files at once. Upload up to ${MAX_RECORDS_PER_UPLOAD} at a time.`;
  }

  for (const r of records) {
    if (typeof r.base64 !== "string" || !isPlausibleBase64(r.base64)) {
      return `${r.originalName || "That file"} did not arrive as readable file data.`;
    }

    // Length is computed from the string before anything is decoded, so
    // an oversized payload is refused without allocating it.
    const byteLength = decodedByteLength(r.base64);
    if (byteLength > MAX_INGEST_BYTES) {
      const mb = (byteLength / 1024 / 1024).toFixed(1);
      const max = (MAX_INGEST_BYTES / 1024 / 1024).toFixed(0);
      return `${r.originalName || "That file"} is ${mb}MB, over the ${max}MB limit.`;
    }

    // Only the leading bytes are decoded, which is all a format sniff
    // needs. 64 covers every signature in magicBytes.ts with room spare.
    const header = new Uint8Array(Buffer.from(r.base64.slice(0, 88), "base64"));

    const verdict = checkIngestedRecord({
      originalName: r.originalName,
      originalSize: r.originalSize,
      mediaType: r.mediaType,
      kind: r.kind,
      base64Length: r.base64.length,
      byteLength,
      header,
    });
    if (!verdict.ok) return verdict.reason ?? "That file cannot be processed.";
  }

  return null;
}

// A storage path the browser is allowed to have produced: this org's
// folder, then the upload's request id, then a file name, with nothing
// that could climb out of the folder.
const STORAGE_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;

type StorageReader = {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
};

// The ONE place the app removes anything from the documents bucket, and it
// only ever removes an upload that never got a document row. A document's
// originals are permanent (migration 0048 drops the delete policies, and
// src/laws/vaultLaws.test.ts fails on any other .remove( on the bucket or
// .delete() on documents). Done through the service role because nobody
// signed in can delete from the bucket any more; so it is checked here
// instead: this org's folder only, the three part path the browser writes,
// and nothing a row refers to, in storage_paths or original_paths.
async function removeUnregisteredUploads(orgId: string, paths: string[]): Promise<void> {
  const own = [...new Set(paths)].filter((p) => STORAGE_PATH.test(p) && p.startsWith(`${orgId}/`));
  if (!own.length) return;
  try {
    const admin = createAdminClient();
    const [inReader, inOriginal] = await Promise.all([
      admin.from("documents").select("storage_paths").eq("org_id", orgId).overlaps("storage_paths", own),
      admin.from("documents").select("original_paths").eq("org_id", orgId).overlaps("original_paths", own),
    ]);
    // If it cannot be established that nothing refers to a file, it stays.
    if (inReader.error || inOriginal.error) return;
    const referenced = new Set<string>();
    for (const r of (inReader.data ?? []) as { storage_paths: string[] | null }[]) for (const p of r.storage_paths ?? []) referenced.add(p);
    for (const r of (inOriginal.data ?? []) as { original_paths: string[] | null }[]) for (const p of r.original_paths ?? []) referenced.add(p);
    const loose = own.filter((p) => !referenced.has(p));
    if (loose.length) await admin.storage.from("documents").remove(loose);
  } catch {
    // The refusal stands either way; a loose file is listed by
    // scripts/list_unregistered_uploads.mjs.
  }
}

async function readStoredRecords(
  supabase: StorageReader,
  orgId: string,
  stored: StoredRecord[]
): Promise<{ ok: true; records: IngestedRecord[] } | { ok: false; error: string }> {
  const records: IngestedRecord[] = [];
  for (const r of stored) {
    if (!STORAGE_PATH.test(r.storagePath) || !r.storagePath.startsWith(`${orgId}/`)) {
      return { ok: false, error: `${r.originalName || "That file"} was not uploaded to this organization's folder.` };
    }
    const { data, error } = await supabase.storage.from("documents").download(r.storagePath);
    if (error || !data) {
      return { ok: false, error: `${r.originalName || "That file"} could not be read back after upload. Try again.` };
    }
    const { storagePath: _path, ...rest } = r;
    records.push({ ...rest, base64: Buffer.from(await data.arrayBuffer()).toString("base64") });
  }
  return { ok: true, records };
}

// Roster rows the resolver needs to match a name to an athlete, and the
// richer context the extraction prompt gets. Both come from the same
// query; the resolver deliberately sees less.
async function loadRoster(orgId: string): Promise<{ roster: ResolverAthlete[]; context: unknown[] }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("athletes")
    .select("id, name, sport, position, gpa, detail")
    .eq("org_id", orgId)
    .is("deleted_at", null);

  const rows = (data ?? []) as { id: string; name: string; sport: string; position: string | null; gpa: number | null; detail: unknown }[];
  return {
    roster: rows.map((a) => ({
      id: a.id,
      name: a.name,
      // The school the resolver weighs a name against: a transfer's
      // current college, or a high school athlete's high school.
      school: (a.detail as { currentSchool?: string } | null)?.currentSchool || (a.detail as { highSchool?: string } | null)?.highSchool || undefined,
      gradYear: (a.detail as { gradYear?: number } | null)?.gradYear ?? undefined,
    })),
    context: rows.map((a) => ({ id: a.id, name: a.name, sport: a.sport, position: a.position })),
  };
}

// The two things the activity log may say about a document: what kind
// it is, as the category's label lower-cased for the middle of a
// sentence ("document" when nothing has said yet), and which athlete
// it was for, by name. Never a field that was read off it.
function documentKind(category: DocCategoryId | null | undefined): string {
  return category ? getCategory(category).label.toLowerCase() : "document";
}

async function orgAthleteName(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, athleteId: string | null | undefined): Promise<{ id: string; name: string } | null> {
  if (!athleteId) return null;
  const { data } = await supabase.from("athletes").select("id, name").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

// Turns a selection the browser has already put in the bucket into
// documents. The shape of an upload:
//
//   - Every file is stored exactly as picked (the originals). Nothing is
//     shrunk, converted or renamed on the way in.
//   - A file tagged with one of the six types that the reader can read
//     (PDF, JPG, PNG) goes to the existing reader, together, as one
//     document of N pages, exactly as before. Its row passes through
//     Processing and always ends in Needs Review.
//   - Every other file (no type chosen, or a format the reader cannot
//     read) is its own document and goes straight to Needs Review.
//   - A file that is not one of the seven formats, or whose bytes do not
//     match its name, refuses the whole selection; the uploads that never
//     got a row are removed again so nothing is left behind.
//   - The same bytes as an earlier document are stored anyway, not read,
//     and say so on the row.
export async function processDocument(
  slug: string,
  input: {
    // The old shape: the reader's copies. Each is its own original too.
    records?: StoredRecord[];
    // The vault shape: every file picked, with its reader copy if any.
    originals?: OriginalUpload[];
    sourceRole: SourceRole;
    // Null means no type: the file is stored and goes to Needs Review.
    requestedCategory: DocCategoryId | null;
    // Set when the upload started from a particular athlete's page.
    // This is an ID, not a name: passing only the name meant the
    // resolver ran a FUZZY match against the roster, and with "Chris
    // Johnson" and "Chris Johnson Jr" on the same roster its
    // longest-name tie-break pinned the document to the wrong brother
    // while the user stood on the right one's page. Two athletes with
    // identical names resolved nondeterministically.
    athleteId?: string;
  }
): Promise<ProcessResult> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Org not found." };
  const user = await requireRole(org.id, STAFF_ROLES);

  const originals: OriginalUpload[] = input.originals ?? (input.records ?? []).map((r) => ({ storagePath: r.storagePath, name: r.originalName, reader: r }));
  if (!originals.length) return { ok: false, error: "No files were uploaded." };

  const supabase = await createClient();
  const stubbed = await isStubbedModel();
  const category = input.requestedCategory;

  // Files confirmed in the bucket by this call. A refusal removes exactly
  // these, and only if no row ends up referring to them.
  const confirmed = new Set<string>();
  const refuse = async (error: string, extra: Partial<ProcessResult> = {}): Promise<ProcessResult> => {
    await removeUnregisteredUploads(org.id, [...confirmed]);
    return { ok: false, error, ...extra };
  };
  // Before any download, what is known to exist is only what the caller
  // says it uploaded, so the cap and count refusals clear those too.
  const claimed = [...new Set(originals.flatMap((o) => [o.storagePath, ...(o.reader ? [o.reader.storagePath] : [])]))];

  if (originals.length > MAX_RECORDS_PER_UPLOAD) {
    claimed.forEach((p) => confirmed.add(p));
    return refuse(`That is ${originals.length} files at once. Upload up to ${MAX_RECORDS_PER_UPLOAD} at a time.`);
  }

  const readsAnything = category !== null && originals.some((o) => o.reader);

  // The month's cap, before a row is written or a byte is read. Only
  // the real model spends money; the stub is free and never capped.
  if (!stubbed && readsAnything) {
    const spend = await loadMonthSpend(supabase, org.id);
    if (spend.exhausted) {
      claimed.forEach((p) => confirmed.add(p));
      return refuse(
        spend.capCents === 0
          ? "Document reading is turned off for this organization. An Admin can set a monthly budget under More."
          : `This month's document reading budget (${dollars(spend.capCents)}) is used up. An Admin can raise it under More.`
      );
    }
  }

  // The originals, read back from the bucket with the caller's own client,
  // so Storage's policies decide whether they may see the file at all.
  // Read back, checked and hashed from the bytes that are really there;
  // the browser's word for what a file is counts for nothing.
  const checked: { upload: OriginalUpload; format: VaultFormat; mediaType: string; size: number; sha: Buffer; hex: string }[] = [];
  for (const o of originals) {
    if (!STORAGE_PATH.test(o.storagePath) || !o.storagePath.startsWith(`${org.id}/`)) {
      return refuse(`${o.name || "That file"} was not uploaded to this organization's folder.`);
    }
    const { data: blob, error: readError } = await supabase.storage.from("documents").download(o.storagePath);
    if (readError || !blob) return refuse(`${o.name || "That file"} could not be read back after upload. Try again.`);
    confirmed.add(o.storagePath);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const verdict = checkVaultFile(o.name, bytes);
    if (!verdict.ok) return refuse(verdict.reason);
    const digest = createHash("sha256").update(bytes).digest();
    checked.push({ upload: o, format: verdict.format, mediaType: verdict.mediaType, size: verdict.size, sha: digest, hex: digest.toString("hex") });
  }

  // Which of them the reader gets: a type was chosen, the format is one
  // the reader reads, and the browser supplied a copy for it.
  const forReader = category === null ? [] : checked.filter((c) => c.upload.reader && readerCanRead(c.format));

  // The reader's copies, validated the way every upload was before: size,
  // format sniff, HEIC refusal. A copy that fails does not lose the file;
  // the original is stored and the reason goes on the row.
  let readerRecords: IngestedRecord[] = [];
  let readerProblem: string | null = null;
  if (forReader.length) {
    const fetched = await readStoredRecords(supabase, org.id, forReader.map((c) => c.upload.reader!));
    if (!fetched.ok) readerProblem = fetched.error;
    else {
      readerRecords = fetched.records;
      readerProblem = validateRecords(readerRecords);
      forReader.forEach((c) => confirmed.add(c.upload.reader!.storagePath));
    }
  }

  // One document for the readable group, one per other file.
  type Spec = { files: typeof checked; reads: boolean };
  const specs: Spec[] = [];
  if (forReader.length) specs.push({ files: forReader, reads: true });
  for (const c of checked) if (!forReader.includes(c)) specs.push({ files: [c], reads: false });

  const pinned = await orgAthleteName(supabase, org.id, input.athleteId);
  const documentIds: string[] = [];
  let readerDocumentId: string | null = null;

  for (const spec of specs) {
    const first = spec.files[0]!;
    // The document's hash: a single file's own SHA-256, or, for a document
    // of several pages, the hash of the pages' bytes in order.
    const hash = spec.files.length === 1 ? first.hex : createHash("sha256").update(Buffer.concat(spec.files.map((f) => f.sha))).digest("hex");

    // The same bytes twice is the same document twice. It is stored all
    // the same (nothing is thrown away), but it is not read again or
    // charged again, and the row points at the first copy. A discarded
    // copy does not count: discarding is how somebody says "read it
    // again".
    const { data: twin } = await supabase
      .from("documents")
      .select("id, file_name, created_at")
      .eq("org_id", org.id)
      .eq("content_hash", hash)
      .neq("status", "discarded")
      // A family's own copy, filed with an assignment and never read, is
      // not a twin: an Admin who wants the file read uploads it.
      .neq("status", "filed")
      .order("created_at", { ascending: true })
      .limit(1);
    const earlier = ((twin ?? []) as { id: string; file_name: string; created_at: string }[])[0];
    const duplicateReason = earlier ? `Same file as ${earlier.file_name} uploaded ${new Date(earlier.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : null;

    const typeLabel = category ? getCategory(category).label : null;
    const skipReason = duplicateReason ?? (spec.reads ? readerProblem : null) ?? (!spec.reads && category && !readerCanRead(first.format) ? "The reader reads PDF, JPG and PNG. Stored as is." : null);
    const reads = spec.reads && !skipReason;

    // The row exists before the reader runs, so a crash mid-extraction
    // leaves a visible document rather than nothing at all.
    const { data: created, error: insertError } = await supabase
      .from("documents")
      .insert({
        org_id: org.id,
        file_name: first.upload.name,
        file_size: spec.files.reduce((n, f) => n + f.size, 0),
        media_type: first.mediaType,
        format: first.format,
        requested_category: category,
        source_role: input.sourceRole,
        // The reader's own state: processing while it reads, pending (waiting
        // for a person) otherwise. The five-state lifecycle is separate.
        status: reads ? "processing" : "pending",
        lifecycle: "uploaded",
        uploaded_by: user.id,
        request_id: first.upload.reader?.requestId ?? null,
        storage_paths: spec.reads && !readerProblem ? spec.files.map((f) => f.upload.reader!.storagePath) : spec.files.map((f) => f.upload.storagePath),
        original_paths: spec.files.map((f) => f.upload.storagePath),
        content_hash: hash,
        // Which model reads it, written once, before the reading starts.
        // 'stub' is permanent (a trigger in migration 0040), so a reading
        // the stand-in invented can never be relabelled and applied.
        read_by: reads ? readerFor(stubbed, EXTRACTION_MODEL) : null,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      // Nothing about the files changed; the ones without a row go.
      return refuse(documentIds.length ? "Some files were stored, but not all. Open Documents to see which." : "Could not store that file.", { documentIds });
    }
    const documentId = (created as { id: string }).id;
    documentIds.push(documentId);
    if (spec.reads) readerDocumentId = documentId;

    // The upload, logged once its row exists. The reading may still fail
    // or settle on another athlete; what is recorded is that a file of
    // this kind came in, for the athlete whose page it started from when
    // it started from one.
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      athleteId: pinned?.id ?? null,
      action: "document_uploaded",
      subjectType: "document",
      subjectId: documentId,
      summary: activitySummary("document_uploaded", { name: pinned?.name ?? null, kind: documentKind(category) }),
    });

    const moveArgs = { orgId: org.id, documentId, by: "system" as const, actorId: user.id, kind: documentKind(category), athlete: pinned };
    if (!reads) {
      // Stored, not read: straight to Needs Review with the reason, if any.
      await moveLifecycle(supabase, { ...moveArgs, to: "needs_review", reviewReason: skipReason ?? (typeLabel ? null : "No type chosen.") });
      continue;
    }

    await moveLifecycle(supabase, { ...moveArgs, to: "processing" });
    // Anything that throws from here leaves a row that says so, rather
    // than one stuck at "processing" for good. The reading itself
    // reports its own failures through the pipeline result; this is for
    // the unexpected: a roster query that fails, a bug.
    try {
      await readAndFile(slug, org.id, documentId, { records: input.records ?? spec.files.map((f) => f.upload.reader!), sourceRole: input.sourceRole, requestedCategory: category, athleteId: input.athleteId }, readerRecords);
    } catch (e) {
      await supabase
        .from("documents")
        .update({
          status: "failed",
          failure_stage: "crash",
          failure_reason: `Reading stopped unexpectedly: ${(e as Error).message || "unknown error"}. Nothing was changed on any athlete.`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("org_id", org.id);
    }
    await finishReading(supabase, { ...moveArgs, category });
  }

  // Whatever this call put in the bucket that no row ended up referring to
  // (a reader copy that was not used) goes, so nothing is left loose.
  await removeUnregisteredUploads(org.id, claimed);

  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/roster`);
  const documentId = readerDocumentId ?? documentIds[0];
  return { ok: true, documentId, documentIds };
}

// The reader is done, however it ended: the row leaves Processing for
// Needs Review, and the reason a person would want is written on it. A
// file that was not the type it was tagged as, a reader error, a timeout
// and a low-confidence reading all end the same way, with the file kept
// and the reason shown. Nothing is a rejection.
async function finishReading(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { orgId: string; documentId: string; actorId: string; kind: string; athlete: { id: string; name: string } | null; category: DocCategoryId | null }
): Promise<void> {
  const { data } = await supabase
    .from("documents")
    .select("status, failure_stage, failure_reason, lifecycle")
    .eq("id", args.documentId)
    .eq("org_id", args.orgId)
    .maybeSingle();
  const row = data as { status: string; failure_stage: string | null; failure_reason: string | null; lifecycle: string } | null;
  if (!row || row.lifecycle !== "processing") return;
  let reason: string | null = null;
  if (row.status === "failed") {
    reason = row.failure_stage === "triage_wrong_category" && args.category ? didNotLookLike(getCategory(args.category).label) : (row.failure_reason ?? "The reader could not use this file.");
  }
  await moveLifecycle(supabase, { orgId: args.orgId, documentId: args.documentId, to: "needs_review", by: "system", actorId: args.actorId, kind: args.kind, athlete: args.athlete, reviewReason: reason });
}

async function readAndFile(
  slug: string,
  orgId: string,
  documentId: string,
  input: { records: StoredRecord[]; sourceRole: SourceRole; requestedCategory: DocCategoryId | null; athleteId?: string },
  records: IngestedRecord[]
): Promise<ProcessResult> {
  const supabase = await createClient();
  const org = { id: orgId };
  const first = records[0]!;

  const seedText = `${first.originalName}:${first.originalSize}`;
  const callModel = await modelCallerFor(org.id, documentId, {
    category: input.requestedCategory ?? "transcript",
    seedText,
  });

  // Detect first when no category was forced.
  let categoryId = input.requestedCategory;
  let detectedType: string | null = null;
  let priorTriage: TriageResult | null | undefined;
  if (!categoryId) {
    const detected = await detectCategory({ records, callModel });
    if (!detected.ok) {
      await supabase
        .from("documents")
        .update({
          status: "failed",
          failure_stage: "model_call",
          failure_reason: `The document could not be read: ${detected.error}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("org_id", org.id);
      revalidatePath(`/org/${slug}/documents`);
      return { ok: true, documentId };
    }
    detectedType = detected.triage?.detectedType ?? null;
    priorTriage = detected.triage;
    if (!detected.categoryId) {
      await supabase
        .from("documents")
        .update({
          status: "failed",
          failure_stage: "undetected",
          failure_reason:
            detectedType && detectedType !== "unreadable"
              ? `This looks like a ${detectedType.replace(/_/g, " ")}, which is not a document type this reads yet.`
              : "Could not tell what this document is. Pick a type and try again.",
          triage: detected.triage,
          detected_type: detectedType,
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
        .eq("org_id", org.id);
      revalidatePath(`/org/${slug}/documents`);
      return { ok: true, documentId };
    }
    categoryId = detected.categoryId;
  }

  // Film is in the registry as an explicit not-yet-supported placeholder,
  // so it is refused honestly rather than being silently impossible.
  if (getCategory(categoryId).shape === "unsupported") {
    await supabase
      .from("documents")
      .update({
        status: "failed",
        category: categoryId,
        detected_type: detectedType,
        failure_stage: "unsupported",
        failure_reason: getCategory(categoryId).unsupportedMessage || "That document type is not supported yet.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("org_id", org.id);
    revalidatePath(`/org/${slug}/documents`);
    return { ok: true, documentId };
  }

  const { roster, context } = await loadRoster(org.id);

  // Resolve the pin to a real athlete in THIS org. An id that is not on
  // this roster is ignored rather than trusted.
  const pinnedAthlete = input.athleteId ? roster.find((a) => a.id === input.athleteId) ?? null : null;

  // Prior versions of this athlete's data are what let the pipeline say
  // whether an upload is a first, a correction or a stale re-send. Only
  // meaningful for an athlete already known: the first version of this
  // compared the new document against the org's latest applied one of
  // the same category, whoever's it was, and called a different
  // athlete's transcript a "replacement".
  const { data: priorRows } = pinnedAthlete
    ? await supabase
        .from("documents")
        .select("request_id, category, extracted, created_at")
        .eq("org_id", org.id)
        .eq("category", categoryId)
        .eq("status", "applied")
        .eq("athlete_id", pinnedAthlete.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] as unknown[] };

  const priorVersions = ((priorRows ?? []) as { request_id: string | null; category: string; extracted: Record<string, unknown> | null; created_at: string }[])
    .filter((r) => r.request_id && r.extracted)
    .map((r) => ({
      requestId: r.request_id as string,
      category: r.category as DocCategoryId,
      gpa: (r.extracted as { gpa?: number | null })?.gpa ?? null,
      gradYear: (r.extracted as { gradYear?: number | null })?.gradYear ?? null,
      ts: r.created_at,
    }));

  const result = await runExtractionPipeline({
    categoryId,
    records,
    sourceRole: input.sourceRole,
    roster,
    rosterContext: context,
    priorVersions,
    callModel,
    priorTriage,
    // The resolver's override is still passed, because the extraction
    // prompt uses it, but the routing decision below does not depend on
    // it: a pinned upload resolves by ID.
    override: pinnedAthlete?.name,
    extractionModel: EXTRACTION_MODEL,
  });

  if (!result.ok) {
    await supabase
      .from("documents")
      .update({
        status: "failed",
        category: categoryId,
        detected_type: detectedType ?? result.triage?.detectedType ?? null,
        page_count: result.triage?.pagesDetected ?? null,
        failure_stage: result.stage,
        failure_reason: result.error,
        triage: result.triage ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("org_id", org.id);
    revalidatePath(`/org/${slug}/documents`);
    return { ok: true, documentId };
  }

  const topCandidate = result.candidates[0] ?? null;
  // auto_apply is the pipeline's call, but it still needs somebody to
  // apply it TO. A confident extraction that matched nobody is a review,
  // not an application. And a reading the gate refuses (the stand-in's,
  // or anything while no key is set) is never applied on its own: it
  // waits in review, where the screen says why it can not be applied.
  const wantsAutoApply = result.route === "auto_apply" && topCandidate != null;
  const canAutoApply = wantsAutoApply && (await applyGate(org.id, documentId)) === null;

  await supabase
    .from("documents")
    .update({
      status: canAutoApply ? "applied" : result.route === "reject" ? "failed" : "pending",
      category: categoryId,
      detected_type: detectedType ?? result.triage?.detectedType ?? null,
      page_count: result.triage?.pagesDetected ?? null,
      route: result.route,
      extracted: result.extracted,
      provenance: result.provenance,
      triage: result.triage ?? null,
      candidates: result.candidates.map((c) => ({ athleteId: c.athlete.id, name: c.athlete.name, score: c.score, reasons: c.reasons })),
      athlete_id: canAutoApply ? topCandidate!.athlete.id : null,
      applied_at: canAutoApply ? new Date().toISOString() : null,
      failure_reason:
        result.route === "reject"
          ? `Confidence was too low to use this without checking it.${Array.isArray(result.extracted.warnings) && result.extracted.warnings.length ? ` ${(result.extracted.warnings as string[]).join(" ")}` : ""}`
          : null,
      failure_stage: result.route === "reject" ? "rejected" : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("org_id", org.id);

  if (canAutoApply) {
    const outcome = await applyGuarded(org.id, topCandidate!.athlete.id, categoryId, result.extracted, documentId, null);
    if (outcome.refused) {
      // Refused between the check and the write. Nothing was written, so
      // the document goes back to review rather than saying applied.
      await supabase
        .from("documents")
        .update({ status: "pending", athlete_id: null, applied_at: null, updated_at: new Date().toISOString() })
        .eq("id", documentId)
        .eq("org_id", org.id);
      revalidatePath(`/org/${slug}/documents`);
      return { ok: true, documentId };
    }
    // applied_changes is written whether or not there were warnings. An
    // apply that half succeeded is exactly the one somebody will want to
    // undo, so it must not be the one with nothing recorded.
    await supabase
      .from("documents")
      .update({
        applied_changes: outcome.changes,
        ...(outcome.warnings.length ? { failure_reason: outcome.warnings.join(" ") } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("org_id", org.id);
  }

  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/roster`);
  return { ok: true, documentId };
}

// An apply that throws halfway is still an apply that changed things.
// What it managed to record is kept so a discard can put it back, and
// the throw becomes a warning on the document instead of a row left
// saying "applied" with nothing recorded.
async function applyGuarded(
  orgId: string,
  athleteId: string,
  categoryId: DocCategoryId,
  extracted: Record<string, unknown>,
  documentId: string | null,
  appliedBy: string | null
): Promise<ApplyOutcome> {
  const changes: AppliedChanges = { athleteId, athleteFields: {}, gradingScaleId: null, coursesSuperseded: 0 };
  // Checked here, where both paths meet, not only behind the button: a
  // server action is a public endpoint and auto-apply has no button.
  const refusal = await applyGate(orgId, documentId);
  if (refusal) return { warnings: [refusal], changes, refused: true };
  try {
    return await applyExtractionToAthlete(orgId, athleteId, categoryId, extracted, documentId, appliedBy, changes);
  } catch (e) {
    return { warnings: [`Applying stopped partway: ${(e as Error).message || "unknown error"}. Discard this document to put back what it did change.`], changes };
  }
}

// Writes the extracted fields onto the athlete. Only the fields this app
// actually stores are touched; everything else stays on the document row
// rather than being dropped into a column that does not exist.
//
// For a transcript this is more than a GPA patch. The transcript GPA is
// the school's own number and is NOT an NCAA core GPA; the core one is
// computed from the course list, which is why the courses are stored as
// rows rather than summarised into a column. Writing only the GPA, which
// is what this did until 2026-09-16, left the eligibility screen with
// nothing to read and every athlete stuck on "cannot be calculated yet".
async function applyExtractionToAthlete(
  orgId: string,
  athleteId: string,
  categoryId: DocCategoryId,
  extracted: Record<string, unknown>,
  documentId: string | null,
  // Who pressed Apply, for the metric entries' entered_by. Null on an
  // auto-apply, where nobody did.
  appliedBy: string | null = null,
  // What this apply changed, so discarding it can put things back. Each
  // field records both the value before and the value written: the undo
  // restores a field only when its current value still matches what this
  // document put there, so a correction made by hand afterwards is never
  // reverted to a number from before the document existed. Handed in by
  // applyGuarded so a throw partway still leaves what was recorded.
  changes: AppliedChanges = { athleteId, athleteFields: {}, gradingScaleId: null, coursesSuperseded: 0 }
): Promise<ApplyOutcome> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  const warnings: string[] = [];

  // Read once up front rather than per field. The date-of-birth branch
  // used to run its own query for exactly this.
  const { data: currentAthlete } = await supabase
    .from("athletes")
    .select("gpa, gpa_verified, date_of_birth, home_state, detail")
    .eq("id", athleteId)
    .eq("org_id", orgId)
    .single();
  const before = (currentAthlete ?? {}) as Record<string, unknown>;
  const currentDetail = (before.detail ?? null) as { kind?: string; highSchool?: string } | null;

  // A college transcript (a transfer athlete's) carries a GPA worth
  // keeping and a course list that is not the high school core list
  // the eligibility screen computes from, so the courses and any
  // grading table stay on the document. A middle school transcript
  // carries nothing NCAA counts.
  const level = typeof extracted.level === "string" ? extracted.level : "high_school";
  if (categoryId === "transcript" && level === "middle_school") {
    warnings.push("This is a middle school transcript, so nothing from it was put on the record.");
    return { warnings, changes };
  }

  if (categoryId === "transcript") {
    if (typeof extracted.gpa === "number") {
      // athletes.gpa is numeric(3,2), so it holds 0.00 to 9.99, and the
      // extraction schema explicitly allows 5.0, 10, 20 and 100 point
      // scales. A Westminster transcript reporting 86.2 therefore raised
      // a numeric overflow, the error was discarded, and the whole
      // patch including date_of_birth was lost in silence. Normalize to
      // the 4.0 scale the column was built for, and drop anything that
      // still will not fit rather than writing a number that fails.
      const scale = typeof extracted.gpaScale === "string" ? extracted.gpaScale : undefined;
      const normalized = normalizeGpa(extracted.gpa, scale);
      if (normalized) {
        patch.gpa = normalized.gpa;
        patch.gpa_verified = extracted.gpaVerified === true;
      } else {
        warnings.push(`Could not place a GPA of ${extracted.gpa} on any known scale, so the athlete's GPA was left alone.`);
      }
    }
    // Needed by the age-based eligibility clock, which can start before
    // an athlete enrols anywhere. Only set when it is missing, so a
    // re-read of an older transcript never overwrites a corrected one.
    if (typeof extracted.dateOfBirth === "string" && isRealDate(extracted.dateOfBirth)) {
      if (currentAthlete && !currentAthlete.date_of_birth) patch.date_of_birth = extracted.dateOfBirth;
    }

    if (level === "college") {
      warnings.push("College courses were left on the document: they are not the high school core list the eligibility screen reads.");
    } else {
      // A high school athlete's own high school stands in for a header
      // the reading could not make out, so the course rows still name
      // the school whose grading scale converts them.
      const fallbackSchool = currentDetail?.kind === "hs" ? currentDetail.highSchool?.trim() || null : null;
      const courseOutcome = await replaceCoursesFromDocument(orgId, athleteId, documentId, extracted, fallbackSchool);
      warnings.push(...courseOutcome.warnings);
      changes.coursesSuperseded = courseOutcome.superseded;

      const scaleOutcome = await recordGradingScale(extracted, documentId);
      warnings.push(...scaleOutcome.warnings);
      changes.gradingScaleId = scaleOutcome.createdId;

      // The header school fills a blank High School on a high school
      // athlete, and is recorded so a discard takes it back off. Never
      // overwrites one somebody typed.
      const filled = await fillHighSchoolFromTranscript(supabase, orgId, athleteId, extracted);
      warnings.push(...filled.warnings);
      if (filled.detail) changes.detail = { ...(changes.detail ?? {}), ...filled.detail };
    }
  }

  // The other four types, each in src/lib/data/applyExtraction.ts. A
  // change to the target or the scores is a change to a matching input,
  // so the athlete's stored matches are rescored right after.
  if (categoryId !== "transcript") {
    const part =
      categoryId === "test_scores"
        ? await applyTestScores(supabase, orgId, athleteId, extracted)
        : categoryId === "offer_letter"
          ? await applyOfferLetter(supabase, orgId, athleteId, extracted)
          : categoryId === "financial_aid"
            ? await applyFinancialAid(supabase, orgId, athleteId, extracted, documentId)
            : categoryId === "recommendation"
              ? await applyRecommendation(supabase, orgId, athleteId, extracted)
              : categoryId === "metrics"
                ? await applyMetricsReport(supabase, orgId, athleteId, extracted, appliedBy)
                : { warnings: [`${categoryId} documents are kept on file and not applied to the record.`] };
    warnings.push(...part.warnings);
    if (part.detail) changes.detail = part.detail;
    if (part.target) changes.target = part.target;
    if (part.contactId) changes.contactId = part.contactId;
    if (part.metricIds) changes.metricIds = part.metricIds;
    if (part.recompute) {
      const { error } = await recomputeFitsForAthlete(supabase, orgId, athleteId);
      if (error) warnings.push(`Applied, but the matches could not be rescored: ${error}`);
    }
  }

  if (Object.keys(patch).length === 0) return { warnings, changes };

  for (const [column, after] of Object.entries(patch)) {
    changes.athleteFields[column] = { before: before[column] ?? null, after };
  }

  const { error } = await supabase.from("athletes").update(patch).eq("id", athleteId).eq("org_id", orgId);
  if (error) {
    warnings.push(`Could not update the athlete's record: ${error.message}`);
    // Nothing was written, so nothing is recorded as needing an undo.
    changes.athleteFields = {};
    return { warnings, changes };
  }
  // The GPA is an academic input, so the stored matches are stale the
  // moment it changes. The other document types rescored on apply from
  // the start; the transcript, built first, did not.
  if ("gpa" in patch) {
    const { error: fitError } = await recomputeFitsForAthlete(supabase, orgId, athleteId);
    if (fitError) warnings.push(`Applied, but the matches could not be rescored: ${fitError}`);
  }
  return { warnings, changes };
}

interface ExtractedCourse {
  title: string;
  subject: string;
  credit: number;
  grade: string;
  weighted?: boolean;
  term?: string | null;
  // Null or absent on an ordinary single-school transcript, where the
  // header school covers every row.
  school?: string | null;
}

// Replaces this document's own course rows, rather than appending to
// whatever is already there. Applying the same transcript twice is a
// normal thing to do (a re-read after fixing the category, a corrected
// scan), and appending would silently double every credit and leave the
// core GPA unchanged while the credit totals went to 32 of 16.
//
// Rows from OTHER documents are left alone on purpose: a transfer
// student legitimately has two transcripts, and the second one must not
// delete the first one's courses.
async function replaceCoursesFromDocument(
  orgId: string,
  athleteId: string,
  documentId: string | null,
  extracted: Record<string, unknown>,
  // The athlete's own high school, used when the header could not be read.
  fallbackSchool: string | null = null
): Promise<{ warnings: string[]; superseded: number }> {
  const warnings: string[] = [];
  const raw = extracted.courses;
  if (!Array.isArray(raw) || raw.length === 0) return { warnings, superseded: 0 };
  const supabase = await createClient();

  // The school printed in the transcript header. Used for any course
  // row that does not name its own, which is every row on the ordinary
  // single-school transcript.
  const printed = typeof extracted.school === "string" ? extracted.school.trim().slice(0, MAX_COURSE_SCHOOL) : "";
  const headerSchool = printed || (fallbackSchool ? fallbackSchool.slice(0, MAX_COURSE_SCHOOL) : null);
  // Every value is clamped to what its column can hold. credit is
  // numeric(4,2), so anything at or above 100 raised a numeric overflow
  // that rejected the WHOLE batch after the delete had already
  // committed: the athlete's courses vanished and the action still
  // reported success. The schema has no upper bound on credit, and a
  // transcript that prints cumulative hours rather than per-course units
  // is enough to trigger it without any bad intent.
  // The same limits a course typed by hand is held to
  // (src/lib/validation/course.ts), so the two can never disagree.
  const SUBJECTS = new Set<string>(COURSE_SUBJECTS);
  const rows = (raw as ExtractedCourse[])
    .filter((c) => c && typeof c.title === "string" && c.title.trim() !== "")
    .filter((c) => SUBJECTS.has(String(c.subject)))
    .slice(0, MAX_COURSES_PER_DOCUMENT)
    .map((c) => ({
      org_id: orgId,
      athlete_id: athleteId,
      document_id: documentId,
      title: String(c.title).slice(0, MAX_COURSE_TITLE),
      subject: c.subject,
      credit: clampCredit(c.credit),
      grade: String(c.grade ?? "").slice(0, MAX_COURSE_GRADE),
      term: c.term ? String(c.term).slice(0, MAX_COURSE_TERM) : null,
      // Per course, falling back to the header. A transfer student's
      // transcript covers two schools that convert numeric grades
      // differently, so one school's 85 is a B and another's is a C.
      // Until the extraction schema carried this, every row took the
      // header school and half a transfer transcript converted through
      // the wrong table.
      school_name: (typeof c.school === "string" && c.school.trim() !== "" ? c.school.trim().slice(0, MAX_COURSE_SCHOOL) : null) ?? headerSchool,
      weighted: c.weighted === true,
      // Deliberately left null: nobody has checked this course against
      // the school's NCAA-approved list, and the engine reports unchecked
      // as unchecked rather than treating it as approved.
      ncaa_approved: null,
    }));

  const dropped = (raw as ExtractedCourse[]).length - rows.length;
  if (dropped > 0) warnings.push(`${dropped} course row(s) were unusable and left out.`);
  if (!rows.length) return { warnings, superseded: 0 };

  // Supersede per SCHOOL, once per distinct school in this batch. A
  // single delete against the header school was wrong the moment a
  // transcript could name two: the second school's existing rows
  // survived alongside the new ones and every credit at that school
  // doubled.
  const schools = [...new Set(rows.map((r) => r.school_name))];

  // Counted before the delete, so an undo can say honestly that these
  // rows are gone and are not coming back. Discarding this document
  // removes what it wrote; it cannot resurrect what it replaced.
  let superseded = 0;
  for (const name of schools) {
    const base = supabase
      .from("athlete_courses")
      .select("id", { count: "exact", head: true })
      .eq("athlete_id", athleteId)
      .eq("org_id", orgId);
    const { count } = await (name ? base.eq("school_name", name) : base.is("school_name", null));
    superseded += count ?? 0;
  }

  for (const name of schools) {
    const base = supabase.from("athlete_courses").delete().eq("athlete_id", athleteId).eq("org_id", orgId);
    const { error: deleteError } = await (name ? base.eq("school_name", name) : base.is("school_name", null));
    if (deleteError) {
      warnings.push(
        `Could not clear the previous courses for ${name ?? "this athlete"}, so they were left as they were: ${deleteError.message}`,
      );
      return { warnings, superseded: 0 };
    }
  }

  const { error } = await supabase.from("athlete_courses").insert(rows);
  if (error) warnings.push(`Could not save the course list: ${error.message}`);
  return { warnings, superseded };
}

// A transcript has tens of courses, not thousands. The cap stops a
// runaway extraction from writing an unbounded batch.
const MAX_COURSES_PER_DOCUMENT = 200;

// A transcript that prints its school's own numeric-to-letter table is
// the only way most of these grades become scorable, because the NCAA
// converts numerics using the school's published scale and refuses to
// guess. So when the model reads that table off the page, it is worth
// keeping.
//
// Written through the service role because the table is shared reference
// data that ordinary members cannot write (migrations/0008), and left
// UNVERIFIED with a note saying which document it came from. An existing
// row is never overwritten: a scale someone has actually confirmed
// outranks one read off a scan, and two orgs' athletes at the same
// school share this row.
async function recordGradingScale(
  extracted: Record<string, unknown>,
  documentId: string | null
): Promise<{ warnings: string[]; createdId: string | null }> {
  const warnings: string[] = [];
  const bands = extracted.gradingScale;
  const school = typeof extracted.school === "string" ? extracted.school.trim() : "";
  if (!school || !Array.isArray(bands) || bands.length === 0) return { warnings, createdId: null };

  // This row is SHARED reference data. Every org with an athlete at this
  // school converts every numeric grade through it, so a wrong table
  // silently rewrites other organizations' eligibility verdicts, and
  // there is no UI anywhere that can correct one afterwards.
  //
  // The migration put this table behind the service role so a
  // coordinator could not type a bad table in by hand. Writing model
  // output straight through the same service role hands that exact power
  // to a PDF supplied by a parent or an email sender, which is worse:
  // nobody reviewed it at all. So the table is checked for internal
  // sanity before it is trusted, and a table that fails is reported to
  // the person who uploaded it rather than stored.
  const problem = gradingScaleProblem(bands);
  if (problem) {
    warnings.push(`The grading table read off this transcript was not saved: ${problem} Ask the school for its conversion table.`);
    return { warnings, createdId: null };
  }

  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from("high_school_grading_scales")
    .select("id")
    .ilike("school_name", school)
    .maybeSingle();
  if (readError) {
    warnings.push(`Could not check whether a grading scale already exists for ${school}.`);
    return { warnings, createdId: null };
  }
  // First writer wins, on purpose: a scale someone has confirmed
  // outranks one read off a scan, and silently replacing another org's
  // verified table would be the worst version of this.
  if (existing) return { warnings, createdId: null };

  const { data: inserted, error } = await admin.from("high_school_grading_scales").insert({
    school_name: school,
    bands,
    source_note: documentId
      ? `Read off the transcript uploaded as document ${documentId}. Not confirmed with the school.`
      : "Read off a transcript. Not confirmed with the school.",
    verified_at: null,
  })
    .select("id")
    .single();
  if (error) {
    warnings.push(`Could not save the grading scale read off this transcript: ${error.message}`);
    return { warnings, createdId: null };
  }
  return { warnings, createdId: (inserted as { id: string } | null)?.id ?? null };
}

export async function applyDocument(slug: string, documentId: string, athleteId: string): Promise<{ ok: boolean; error?: string }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Org not found." };
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, category, extracted, status, read_by")
    .eq("id", documentId)
    .eq("org_id", org.id)
    .single();

  const doc = data as { id: string; category: DocCategoryId | null; extracted: Record<string, unknown> | null; status: string; read_by?: string | null } | null;
  if (!doc) return { ok: false, error: "Document not found." };
  if (!doc.category || !doc.extracted) return { ok: false, error: "There is nothing extracted to apply." };

  // A server action is a public endpoint; the Apply button is only a
  // suggestion about when to call it. Without this check a document the
  // pipeline explicitly REFUSED could still be applied, because a
  // rejected document keeps its extracted payload alongside its failure
  // reason. The same call also re-applied an already-applied document,
  // which inserts a second copy of its courses, and resurrected a
  // discarded one.
  if (doc.status === "applied") return { ok: false, error: "That document has already been applied." };
  if (doc.status === "discarded") return { ok: false, error: "That document was discarded. Process it again if you want to use it." };
  if (doc.status === "failed") return { ok: false, error: "That document did not pass extraction, so there is nothing safe to apply from it." };
  if (doc.status === "processing") return { ok: false, error: "That document is still being read." };

  // Before the claim, so a refused reading never even moves to applied.
  const refusal = await applyGate(org.id, doc.id);
  if (refusal) return { ok: false, error: refusal };

  // Same cross-org check the other actions make: RLS proves the document
  // belongs to this org, not that the athlete does.
  const athlete = await orgAthleteName(supabase, org.id, athleteId);
  if (!athlete) return { ok: false, error: "That athlete isn't on this org's roster." };

  // Claim the document before touching the athlete: the status moves to
  // applied only if it is still pending at that moment, so two taps on
  // Apply, or two people reviewing the same queue, apply it once. The
  // second one is told so instead of logging every metric twice.
  const { data: claimed, error: claimError } = await supabase
    .from("documents")
    .update({
      status: "applied",
      athlete_id: athleteId,
      applied_at: new Date().toISOString(),
      applied_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("org_id", org.id)
    .eq("status", "pending")
    .select("id");
  if (claimError) return { ok: false, error: `Could not apply the document: ${claimError.message}` };
  if (!claimed || (claimed as unknown[]).length === 0) return { ok: false, error: "That document was just applied or discarded by someone else." };

  const outcome = await applyGuarded(org.id, athleteId, doc.category, doc.extracted, doc.id, user.id);
  if (outcome.refused) {
    // Refused after the claim. Nothing was written onto the athlete, so
    // the claim is let go and the document goes back to review.
    await supabase
      .from("documents")
      .update({ status: "pending", athlete_id: null, applied_at: null, applied_by: null, updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("org_id", org.id)
      .eq("status", "applied");
    revalidatePath(`/org/${slug}/documents`);
    return { ok: false, error: outcome.warnings.join(" ") };
  }
  const applyWarnings = outcome.warnings;

  const { error: statusError } = await supabase
    .from("documents")
    .update({
      // What to put back if this is discarded later. See migrations/0011.
      applied_changes: outcome.changes,
      ...(applyWarnings.length ? { failure_reason: applyWarnings.join(" ") } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("org_id", org.id);

  // Applied, so logged: the kind and the athlete, nothing that was read.
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: athlete.id,
    action: "document_applied",
    subjectType: "document",
    subjectId: doc.id,
    summary: activitySummary("document_applied", { name: athlete.name, kind: documentKind(doc.category) }),
  });

  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/roster`);
  if (statusError) return { ok: false, error: `Applied, but what it changed could not be recorded: ${statusError.message}` };
  // Partial failures surface instead of being reported as a clean
  // success. Every write in this path used to be unchecked, so a
  // rejected insert looked identical to a completed one.
  if (applyWarnings.length) return { ok: true, error: applyWarnings.join(" ") };
  return { ok: true };
}

// Discarding is now an undo, not just a status change.
//
// Until 2026-09-16 this set a status and left everything the apply had
// written in place: the course rows, the GPA, the gpa_verified flag, the
// date of birth and any shared grading scale. Nothing in the app could
// remove them, so a transcript applied to the wrong athlete stayed on
// that athlete's record permanently and looked exactly like data someone
// had typed in. A discarded document that leaves its data behind is
// worse than one that cannot be discarded at all, because the screen
// says it is gone.
//
// The returned `undone` sentences are shown to whoever pressed the
// button, because "discarded" is not a complete account of what just
// happened to an athlete's record.
export async function discardDocument(
  slug: string,
  documentId: string
): Promise<{ ok: boolean; error?: string; undone?: string[] }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Org not found." };
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, status, applied_changes, created_at, category, athlete_id")
    .eq("id", documentId)
    .eq("org_id", org.id)
    .single();

  const doc = data as { id: string; status: string; applied_changes: AppliedChanges | null; created_at: string; category: DocCategoryId | null; athlete_id: string | null } | null;
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status === "discarded") return { ok: false, error: "That document was already discarded." };
  // A reading takes a couple of minutes at most. One still marked as
  // being read after that was killed mid-way (the hosting function has
  // a hard limit) and will never finish, so it can be cleared.
  if (doc.status === "processing" && !isStaleProcessing(doc.created_at)) return { ok: false, error: "That document is still being read." };

  // Claimed first, from the status it was read at, so two discards of
  // the same applied document undo it once: the second finds it already
  // discarded and stops here.
  const { data: claimed, error: claimError } = await supabase
    .from("documents")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("org_id", org.id)
    .eq("status", doc.status)
    .select("id");
  if (claimError) return { ok: false, error: `Could not discard the document: ${claimError.message}` };
  if (!claimed || (claimed as unknown[]).length === 0) return { ok: false, error: "That document was just changed by someone else. Reload and look again." };

  const undone = doc.status === "applied" ? await undoApply(org.id, doc.id, doc.applied_changes) : [];

  const { error } = await supabase
    .from("documents")
    .update({
      // The record is consumed. Leaving it would let a second discard,
      // or a later bug, try to restore values a second time.
      applied_changes: null,
      // Kept on the row rather than only returned, so the screen still
      // says what happened after a reload.
      undo_note: undone.length ? undone.join(" ") : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("org_id", org.id);
  if (error) return { ok: false, error: `Undid the changes, but what was undone could not be recorded: ${error.message}` };

  // Discarded, so logged: the kind, and the athlete it had been filed
  // to when it had one. What was undone stays on the document row.
  const filed = await orgAthleteName(supabase, org.id, doc.athlete_id);

  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: filed?.id ?? null,
    action: "document_discarded",
    subjectType: "document",
    subjectId: doc.id,
    summary: activitySummary("document_discarded", { name: filed?.name ?? null, kind: documentKind(doc.category) }),
  });

  // A discarded document is also Archived: it leaves the working lists and
  // stays in the vault. A reading stuck in Processing is first let go to
  // Needs Review, the one move staff may make out of it.
  const vault = { orgId: org.id, documentId: doc.id, by: "staff" as const, actorId: user.id, kind: documentKind(doc.category), athlete: filed };
  const { data: lifeRow } = await supabase.from("documents").select("lifecycle").eq("id", doc.id).eq("org_id", org.id).maybeSingle();
  if ((lifeRow as { lifecycle?: string } | null)?.lifecycle === "processing") await moveLifecycle(supabase, { ...vault, to: "needs_review" });
  const afterRow = await supabase.from("documents").select("lifecycle").eq("id", doc.id).eq("org_id", org.id).maybeSingle();
  const lifecycleNow = (afterRow.data as { lifecycle?: string } | null)?.lifecycle;
  if (lifecycleNow === "needs_review" || lifecycleNow === "ready") await moveLifecycle(supabase, { ...vault, to: "archived" });
  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/roster`);
  return { ok: true, undone };
}

// Puts back what an apply changed. Returns a plain-language account of
// what it did, including what it could not undo.
async function undoApply(orgId: string, documentId: string, changes: AppliedChanges | null): Promise<string[]> {
  const supabase = await createClient();
  const done: string[] = [];

  // Course rows are found by query rather than from the record, so they
  // are removed even for a document applied before applied_changes
  // existed.
  const { count } = await supabase
    .from("athlete_courses")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .eq("org_id", orgId);
  if (count && count > 0) {
    const { error } = await supabase.from("athlete_courses").delete().eq("document_id", documentId).eq("org_id", orgId);
    if (error) done.push(`Could not remove the ${count} course rows this document added: ${error.message}`);
    else done.push(`Removed ${count} course ${count === 1 ? "row" : "rows"} this document added.`);
  }

  if (!changes) {
    // Applied before this was recorded. Say so rather than implying a
    // clean reversal: the GPA and date of birth it wrote are still there
    // and there is no way to know what they replaced.
    done.push("This was applied before undo was available, so any GPA or date of birth it wrote is still on the record.");
    return done;
  }

  if (changes.detail && changes.athleteId) done.push(...(await undoDetail(supabase, orgId, changes.athleteId, changes.detail)));
  if (changes.target) done.push(...(await undoTarget(supabase, orgId, changes.target)));
  if (changes.contactId) done.push(...(await undoContact(supabase, orgId, changes.contactId)));
  if (changes.metricIds?.length) done.push(...(await undoMetrics(supabase, orgId, changes.metricIds)));
  if ((changes.target || changes.detail || changes.metricIds?.length) && changes.athleteId) {
    const { error } = await recomputeFitsForAthlete(supabase, orgId, changes.athleteId);
    if (error) done.push(`The matches could not be rescored afterwards: ${error}`);
  }

  if (changes.coursesSuperseded > 0) {
    done.push(
      `${changes.coursesSuperseded} course ${changes.coursesSuperseded === 1 ? "row" : "rows"} from an earlier transcript for the same school were replaced when this was applied and cannot be brought back.`,
    );
  }

  const fields = Object.entries(changes.athleteFields ?? {});
  if (fields.length > 0 && changes.athleteId) {
    const { data: current } = await supabase
      .from("athletes")
      .select("gpa, gpa_verified, date_of_birth")
      .eq("id", changes.athleteId)
      .eq("org_id", orgId)
      .single();

    // The decision itself lives in src/lib/data/undoPlan.ts, where it
    // can be tested: this file is "use server", so nothing in it can be
    // exported to a test.
    const { restore, kept } = planFieldRestore(current as Record<string, unknown> | null, changes.athleteFields ?? {});

    if (Object.keys(restore).length > 0) {
      const { error } = await supabase.from("athletes").update(restore).eq("id", changes.athleteId).eq("org_id", orgId);
      if (error) done.push(`Could not restore the athlete's previous values: ${error.message}`);
      else done.push(`Put back the athlete's previous ${Object.keys(restore).map(readableColumn).join(" and ")}.`);
      if (!error && "gpa" in restore) {
        const { error: fitError } = await recomputeFitsForAthlete(supabase, orgId, changes.athleteId);
        if (fitError) done.push(`The matches could not be rescored afterwards: ${fitError}`);
      }
    }
    if (kept.length > 0) {
      // Somebody corrected it by hand after the apply. Their value is
      // the current truth and reverting it to something from before the
      // document existed would be the worse mistake.
      done.push(`Left the ${kept.map(readableColumn).join(" and ")} alone, because it has been changed since this was applied.`);
    }
  }

  // Only a scale this document CREATED, and only while nobody has
  // confirmed it since. A shared table another org may now be relying on
  // is not this document's to delete once somebody has vouched for it.
  if (changes.gradingScaleId) {
    const admin = createAdminClient();
    const { data: scale } = await admin
      .from("high_school_grading_scales")
      .select("id, school_name, verified_at")
      .eq("id", changes.gradingScaleId)
      .maybeSingle();
    const row = scale as { id: string; school_name: string; verified_at: string | null } | null;
    if (row && !row.verified_at) {
      const { error } = await admin.from("high_school_grading_scales").delete().eq("id", row.id);
      if (error) done.push(`Could not remove the grading scale this document created: ${error.message}`);
      else done.push(`Removed the ${row.school_name} grading scale, which only existed because of this document.`);
    } else if (row) {
      done.push(`Kept the ${row.school_name} grading scale: somebody has confirmed it since, so it is no longer just this document's reading.`);
    }
  }

  return done;
}

// The five-state moves a person makes (migration 0048): Mark Ready and
// Archive from Needs Review, Archive from Ready, Unarchive from Archived
// (back to Needs Review), and letting go of a reading that never finished.
// There is no delete: a document, and the file it holds, stays for good.
//
// Staff only, one conditional write (a second tap finds it moved and says
// so), and every move writes the activity log with who and when.
export async function moveDocument(slug: string, documentId: string, to: "ready" | "archived" | "needs_review"): Promise<{ ok: boolean; error?: string; gone?: boolean }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Org not found.", gone: true };
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("id, lifecycle, lifecycle_changed_at, category, requested_category, athlete_id").eq("id", documentId).eq("org_id", org.id).maybeSingle();
  const doc = data as { id: string; lifecycle: string; lifecycle_changed_at: string | null; category: DocCategoryId | null; requested_category: DocCategoryId | null; athlete_id: string | null } | null;
  if (!doc || !isLifecycle(doc.lifecycle)) return { ok: false, error: "That document is already gone.", gone: true };

  // Out of Processing only when the reading has plainly died.
  if (doc.lifecycle === "processing" && !isStaleLifecycle(doc.lifecycle, doc.lifecycle_changed_at)) {
    return { ok: false, error: "That document is still being read." };
  }

  const athlete = await orgAthleteName(supabase, org.id, doc.athlete_id);
  const moved = await moveLifecycle(supabase, {
    orgId: org.id,
    documentId: doc.id,
    to,
    by: "staff",
    actorId: user.id,
    kind: documentKind(doc.category ?? doc.requested_category),
    athlete,
    expectedFrom: doc.lifecycle,
    // A reading that never finished says so on the row.
    ...(doc.lifecycle === "processing" ? { reviewReason: "Reading did not finish." } : {}),
  });
  if (!moved.ok) return { ok: false, error: moved.error };

  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/documents/${documentId}`);
  return { ok: true };
}

// The form wrapper the document screen posts to: moves, then comes back to
// the document with the reason when it was refused.
export async function moveDocumentAndStay(slug: string, documentId: string, to: "ready" | "archived" | "needs_review"): Promise<void> {
  const result = await moveDocument(slug, documentId, to);
  if (result.ok) redirect(`/org/${slug}/documents/${documentId}`);
  const reason = encodeURIComponent(result.error ?? "That could not be done.");
  // A document that is not there (or not this org's) has no page to come
  // back to, so the person lands on the list with the reason.
  redirect(result.gone ? `/org/${slug}/documents?error=${reason}` : `/org/${slug}/documents/${documentId}?error=${reason}`);
}

export interface ExtractedEditState {
  errors: Record<string, string>;
}

// Correcting what was read before it is applied (audit crud F5): a
// misread GPA, a wrong school, an SAT total off by a digit. Only while
// the document waits in review, only staff, and never a reading the
// stand-in invented: correcting invented data by hand does not make the
// rest of it real. The corrected reading is checked against the
// category's schema again before it is stored, the same check every
// model reading passes (CLAUDE.md: never trust unvalidated extraction).
export async function updateExtracted(slug: string, documentId: string, _prevState: ExtractedEditState, formData: FormData): Promise<ExtractedEditState> {
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("id, status, category, extracted, read_by").eq("id", documentId).eq("org_id", org.id).maybeSingle();
  const doc = data as { id: string; status: string; category: DocCategoryId | null; extracted: Record<string, unknown> | null; read_by?: string | null } | null;
  if (!doc) return { errors: { form: "Document not found." } };
  if (doc.status !== "pending") return { errors: { form: "Only a document waiting in review can be corrected." } };
  if (isStubReading(doc.read_by ?? null)) return { errors: { form: "This reading was made up by the stand-in, so correcting it would not make it real. Discard it and upload the file again once the AI key is set." } };
  if (!doc.category || doc.category === "film" || !doc.extracted) return { errors: { form: "There is nothing read off this document to correct." } };

  const edited = applyExtractedEdits(doc.category, doc.extracted, formData);
  if (!edited.ok) return { errors: edited.errors };
  const checked = CATEGORY_SCHEMAS[doc.category].safeParse(edited.extracted);
  if (!checked.success) {
    const errors: Record<string, string> = {};
    for (const issue of checked.error.issues) {
      const key = issue.path.join(".");
      if (key && !errors[key]) errors[key] = issue.message;
    }
    return { errors: Object.keys(errors).length ? errors : { form: "That correction does not fit this kind of document." } };
  }

  // Warnings the reading raised stay with it: a correction answers them,
  // it does not erase what the reader was unsure of.
  const next = { ...(checked.data as Record<string, unknown>), warnings: doc.extracted.warnings ?? (checked.data as Record<string, unknown>).warnings };
  const { data: saved, error } = await supabase
    .from("documents")
    .update({ extracted: next, updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("org_id", org.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { errors: { form: `Could not save the correction: ${error.message}` } };
  if (!saved || (saved as unknown[]).length === 0) return { errors: { form: "That document was just applied or discarded by someone else." } };

  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/documents/${documentId}`);
  redirect(`/org/${slug}/documents/${documentId}`);
}
