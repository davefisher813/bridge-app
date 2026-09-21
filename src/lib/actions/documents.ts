"use server";

import { revalidatePath } from "next/cache";
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
import { planFieldRestore, readableColumn } from "@/lib/data/undoPlan";
import type { DocCategoryId, IngestedRecord, ResolverAthlete, SourceRole, StoredRecord } from "@/lib/docai/types";

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

// The model that reads a document. With no API key on the server, the
// stub, which every screen labels as simulated. With one, the real
// caller, which writes every call's tokens and cost to the org's ledger
// (docai_usage) so the month's cap in processDocument means something.
async function modelCallerFor(orgId: string, documentId: string, stub: { category: DocCategoryId; seedText: string }): Promise<ModelCaller> {
  if (await isStubbedModel()) return createStubCaller(stub);
  const supabase = await createClient();
  return createAnthropicCaller({
    onUsage: async (u) => {
      await supabase.from("docai_usage").insert({
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
    },
  });
}

export interface ProcessResult {
  ok: boolean;
  documentId?: string;
  error?: string;
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
  // Course rows from OTHER documents that this apply superseded. They
  // are gone and an undo cannot bring them back, so it says so rather
  // than implying a clean reversal.
  coursesSuperseded: number;
}

interface ApplyOutcome {
  warnings: string[];
  changes: AppliedChanges;
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
  storage: { from(bucket: string): { download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }> } };
};

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
      school: (a.detail as { currentSchool?: string } | null)?.currentSchool ?? undefined,
      gradYear: (a.detail as { gradYear?: number } | null)?.gradYear ?? undefined,
    })),
    context: rows.map((a) => ({ id: a.id, name: a.name, sport: a.sport, position: a.position })),
  };
}

export async function processDocument(
  slug: string,
  input: {
    // Where the browser put each file in the documents bucket. The bytes
    // are read back from Storage here, never carried in this call: a
    // server action's body is capped at 1MB and a document is not.
    records: StoredRecord[];
    sourceRole: SourceRole;
    // Null means "work out what this is". Dave wanted both ways in.
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
  await requireRole(org.id, STAFF_ROLES);

  if (!input.records.length) return { ok: false, error: "No files were uploaded." };
  if (input.records.length > MAX_RECORDS_PER_UPLOAD) {
    return { ok: false, error: `That is ${input.records.length} files at once. Upload up to ${MAX_RECORDS_PER_UPLOAD} at a time.` };
  }

  const supabase = await createClient();

  // The month's cap, before a row is written or a byte is read. Only
  // the real model spends money; the stub is free and never capped.
  if (!(await isStubbedModel())) {
    const spend = await loadMonthSpend(supabase, org.id);
    if (spend.exhausted) {
      return {
        ok: false,
        error:
          spend.capCents === 0
            ? "Document reading is turned off for this organization. An owner can set a monthly budget under More."
            : `This month's document reading budget (${dollars(spend.capCents)}) is used up. An owner can raise it under More.`,
      };
    }
  }

  // The bytes, read back from the bucket with the caller's own client,
  // so Storage's policies decide whether they may see the file at all.
  // The org prefix is checked here too, so a path into another org's
  // folder is refused by name rather than surfacing as a download error.
  const fetched = await readStoredRecords(supabase, org.id, input.records);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const records = fetched.records;

  // Everything the client checked, checked again here from the bytes
  // that actually arrived. ingest.ts runs in the browser, so a direct
  // call to this action skipped the size cap, the format sniffing and
  // the HEIC refusal entirely. See src/lib/docai/acceptance.ts.
  const rejection = validateRecords(records);
  if (rejection) return { ok: false, error: rejection };

  const first = records[0]!;

  // The row exists before the pipeline runs, so a crash mid-extraction
  // leaves a visible failed document rather than nothing at all.
  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({
      org_id: org.id,
      file_name: first.originalName,
      file_size: first.originalSize,
      media_type: first.originalMime,
      requested_category: input.requestedCategory,
      source_role: input.sourceRole,
      status: "processing",
      request_id: first.requestId,
      storage_paths: input.records.map((r) => r.storagePath),
    })
    .select("id")
    .single();

  if (insertError || !created) return { ok: false, error: "Could not start processing." };
  const documentId = (created as { id: string }).id;

  const seedText = `${first.originalName}:${first.originalSize}`;
  const callModel = await modelCallerFor(org.id, documentId, {
    category: input.requestedCategory ?? "transcript",
    seedText,
  });

  // Detect first when no category was forced.
  let categoryId = input.requestedCategory;
  let detectedType: string | null = null;
  if (!categoryId) {
    const detected = await detectCategory({ records, callModel });
    detectedType = detected.triage?.detectedType ?? null;
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
  // whether an upload is a first, a correction or a stale re-send. Without
  // a matched athlete yet, the lookup is by category across the org.
  const { data: priorRows } = await supabase
    .from("documents")
    .select("request_id, category, extracted, created_at")
    .eq("org_id", org.id)
    .eq("category", categoryId)
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(20);

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
    // The resolver's override is still passed, because the extraction
    // prompt uses it, but the routing decision below does not depend on
    // it: a pinned upload resolves by ID.
    override: pinnedAthlete?.name,
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
  // not an application.
  const canAutoApply = result.route === "auto_apply" && topCandidate != null;

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
      failure_reason: result.route === "reject" ? "Confidence was too low to use this without checking it." : null,
      failure_stage: result.route === "reject" ? "rejected" : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("org_id", org.id);

  if (canAutoApply) {
    const outcome = await applyExtractionToAthlete(org.id, topCandidate!.athlete.id, categoryId, result.extracted, documentId);
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
  documentId: string | null
): Promise<ApplyOutcome> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  const warnings: string[] = [];
  // What this apply changed, so discarding it can put things back. Each
  // field records both the value before and the value written: the undo
  // restores a field only when its current value still matches what this
  // document put there, so a correction made by hand afterwards is never
  // reverted to a number from before the document existed.
  const changes: AppliedChanges = {
    athleteId,
    athleteFields: {},
    gradingScaleId: null,
    coursesSuperseded: 0,
  };

  // Read once up front rather than per field. The date-of-birth branch
  // used to run its own query for exactly this.
  const { data: currentAthlete } = await supabase
    .from("athletes")
    .select("gpa, gpa_verified, date_of_birth")
    .eq("id", athleteId)
    .eq("org_id", orgId)
    .single();
  const before = (currentAthlete ?? {}) as Record<string, unknown>;

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

    const courseOutcome = await replaceCoursesFromDocument(orgId, athleteId, documentId, extracted);
    warnings.push(...courseOutcome.warnings);
    changes.coursesSuperseded = courseOutcome.superseded;

    const scaleOutcome = await recordGradingScale(extracted, documentId);
    warnings.push(...scaleOutcome.warnings);
    changes.gradingScaleId = scaleOutcome.createdId;
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
  }
  return { warnings, changes };
}

// A regex says 2026-02-30 looks like a date. Postgres disagrees, and the
// rejection used to discard the GPA in the same patch.
function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
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
  extracted: Record<string, unknown>
): Promise<{ warnings: string[]; superseded: number }> {
  const warnings: string[] = [];
  const raw = extracted.courses;
  if (!Array.isArray(raw) || raw.length === 0) return { warnings, superseded: 0 };
  const supabase = await createClient();

  // The school printed in the transcript header. Used for any course
  // row that does not name its own, which is every row on the ordinary
  // single-school transcript.
  const headerSchool = typeof extracted.school === "string" ? extracted.school.trim().slice(0, 200) : null;
  // Every value is clamped to what its column can hold. credit is
  // numeric(4,2), so anything at or above 100 raised a numeric overflow
  // that rejected the WHOLE batch after the delete had already
  // committed: the athlete's courses vanished and the action still
  // reported success. The schema has no upper bound on credit, and a
  // transcript that prints cumulative hours rather than per-course units
  // is enough to trigger it without any bad intent.
  const SUBJECTS = new Set(["english", "math", "science", "social_science", "other_academic", "non_academic"]);
  const rows = (raw as ExtractedCourse[])
    .filter((c) => c && typeof c.title === "string" && c.title.trim() !== "")
    .filter((c) => SUBJECTS.has(String(c.subject)))
    .slice(0, MAX_COURSES_PER_DOCUMENT)
    .map((c) => ({
      org_id: orgId,
      athlete_id: athleteId,
      document_id: documentId,
      title: String(c.title).slice(0, 200),
      subject: c.subject,
      credit: Number.isFinite(c.credit) ? Math.max(0, Math.min(99.99, Number(c.credit))) : 0,
      grade: String(c.grade ?? "").slice(0, 20),
      term: c.term ? String(c.term).slice(0, 40) : null,
      // Per course, falling back to the header. A transfer student's
      // transcript covers two schools that convert numeric grades
      // differently, so one school's 85 is a B and another's is a C.
      // Until the extraction schema carried this, every row took the
      // header school and half a transfer transcript converted through
      // the wrong table.
      school_name: (typeof c.school === "string" && c.school.trim() !== "" ? c.school.trim().slice(0, 200) : null) ?? headerSchool,
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
    .select("id, category, extracted, status")
    .eq("id", documentId)
    .eq("org_id", org.id)
    .single();

  const doc = data as { id: string; category: DocCategoryId | null; extracted: Record<string, unknown> | null; status: string } | null;
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

  // Same cross-org check the other actions make: RLS proves the document
  // belongs to this org, not that the athlete does.
  const { data: athlete } = await supabase
    .from("athletes")
    .select("id")
    .eq("id", athleteId)
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .single();
  if (!athlete) return { ok: false, error: "That athlete isn't on this org's roster." };

  const outcome = await applyExtractionToAthlete(org.id, athleteId, doc.category, doc.extracted, doc.id);
  const applyWarnings = outcome.warnings;

  const { error: statusError } = await supabase
    .from("documents")
    .update({
      status: "applied",
      athlete_id: athleteId,
      applied_at: new Date().toISOString(),
      applied_by: user.id,
      // What to put back if this is discarded later. See migrations/0011.
      applied_changes: outcome.changes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("org_id", org.id);

  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/roster`);
  if (statusError) return { ok: false, error: `Applied, but the document status could not be updated: ${statusError.message}` };
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
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, status, applied_changes")
    .eq("id", documentId)
    .eq("org_id", org.id)
    .single();

  const doc = data as { id: string; status: string; applied_changes: AppliedChanges | null } | null;
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status === "discarded") return { ok: false, error: "That document was already discarded." };

  const undone = doc.status === "applied" ? await undoApply(org.id, doc.id, doc.applied_changes) : [];

  const { error } = await supabase
    .from("documents")
    .update({
      status: "discarded",
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
  if (error) return { ok: false, error: `Undid the changes, but the document status could not be updated: ${error.message}` };

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
