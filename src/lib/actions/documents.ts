"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { detectCategory, runExtractionPipeline } from "@/lib/docai/pipeline";
import { createStubCaller } from "@/lib/docai/stubCaller";
import { getCategory } from "@/lib/docai/categories";
import type { DocCategoryId, IngestedRecord, ResolverAthlete, SourceRole } from "@/lib/docai/types";

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

export interface ProcessResult {
  ok: boolean;
  documentId?: string;
  error?: string;
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
    records: IngestedRecord[];
    sourceRole: SourceRole;
    // Null means "work out what this is". Dave wanted both ways in.
    requestedCategory: DocCategoryId | null;
    // Set when the upload started from a particular athlete's page, so
    // there is no question whose document this is. Goes to the
    // pipeline's resolver override, which pins the match rather than
    // guessing from the name printed on the page. This is what makes a
    // nameless portal transcript usable: the name is missing from the
    // document, and the person uploading it already told us.
    athleteOverride?: string;
  }
): Promise<ProcessResult> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Org not found." };
  await requireRole(org.id, STAFF_ROLES);

  if (!input.records.length) return { ok: false, error: "No files were uploaded." };

  const first = input.records[0]!;
  const supabase = await createClient();

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
    })
    .select("id")
    .single();

  if (insertError || !created) return { ok: false, error: "Could not start processing." };
  const documentId = (created as { id: string }).id;

  const seedText = `${first.originalName}:${first.originalSize}`;
  const callModel = createStubCaller({
    category: input.requestedCategory ?? "transcript",
    seedText,
  });

  // Detect first when no category was forced.
  let categoryId = input.requestedCategory;
  let detectedType: string | null = null;
  if (!categoryId) {
    const detected = await detectCategory({ records: input.records, callModel });
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
    records: input.records,
    sourceRole: input.sourceRole,
    roster,
    rosterContext: context,
    priorVersions,
    callModel,
    override: input.athleteOverride,
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
    await applyExtractionToAthlete(org.id, topCandidate!.athlete.id, categoryId, result.extracted, documentId);
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
): Promise<void> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};

  if (categoryId === "transcript") {
    if (typeof extracted.gpa === "number") {
      patch.gpa = extracted.gpa;
      patch.gpa_verified = extracted.gpaVerified === true;
    }
    // Needed by the age-based eligibility clock, which can start before
    // an athlete enrols anywhere. Only set when it is missing, so a
    // re-read of an older transcript never overwrites a corrected one.
    if (typeof extracted.dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}$/.test(extracted.dateOfBirth)) {
      const { data: current } = await supabase.from("athletes").select("date_of_birth").eq("id", athleteId).eq("org_id", orgId).single();
      if (current && !current.date_of_birth) patch.date_of_birth = extracted.dateOfBirth;
    }

    await replaceCoursesFromDocument(orgId, athleteId, documentId, extracted);
    await recordGradingScale(extracted, documentId);
  }

  if (Object.keys(patch).length === 0) return;
  await supabase.from("athletes").update(patch).eq("id", athleteId).eq("org_id", orgId);
}

interface ExtractedCourse {
  title: string;
  subject: string;
  credit: number;
  grade: string;
  weighted?: boolean;
  term?: string | null;
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
): Promise<void> {
  const raw = extracted.courses;
  if (!Array.isArray(raw) || raw.length === 0) return;
  const supabase = await createClient();

  if (documentId) {
    await supabase.from("athlete_courses").delete().eq("document_id", documentId).eq("org_id", orgId);
  }

  const school = typeof extracted.school === "string" ? extracted.school : null;
  const rows = (raw as ExtractedCourse[])
    .filter((c) => c && typeof c.title === "string" && c.title.trim() !== "")
    .map((c) => ({
      org_id: orgId,
      athlete_id: athleteId,
      document_id: documentId,
      title: c.title,
      subject: c.subject,
      credit: Number.isFinite(c.credit) ? c.credit : 0,
      grade: String(c.grade ?? ""),
      term: c.term ?? null,
      school_name: school,
      weighted: c.weighted === true,
      // Deliberately left null: nobody has checked this course against
      // the school's NCAA-approved list, and the engine reports unchecked
      // as unchecked rather than treating it as approved.
      ncaa_approved: null,
    }));

  if (!rows.length) return;
  await supabase.from("athlete_courses").insert(rows);
}

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
async function recordGradingScale(extracted: Record<string, unknown>, documentId: string | null): Promise<void> {
  const bands = extracted.gradingScale;
  const school = typeof extracted.school === "string" ? extracted.school.trim() : "";
  if (!school || !Array.isArray(bands) || bands.length === 0) return;

  const admin = createAdminClient();
  const { data: existing } = await admin.from("high_school_grading_scales").select("id").eq("school_name", school).maybeSingle();
  if (existing) return;

  await admin.from("high_school_grading_scales").insert({
    school_name: school,
    bands,
    source_note: documentId ? `Read off the transcript uploaded as document ${documentId}. Not confirmed with the school.` : "Read off a transcript. Not confirmed with the school.",
    verified_at: null,
  });
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

  await applyExtractionToAthlete(org.id, athleteId, doc.category, doc.extracted, doc.id);

  await supabase
    .from("documents")
    .update({
      status: "applied",
      athlete_id: athleteId,
      applied_at: new Date().toISOString(),
      applied_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("org_id", org.id);

  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/roster`);
  return { ok: true };
}

export async function discardDocument(slug: string, documentId: string): Promise<{ ok: boolean; error?: string }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Org not found." };
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  await supabase
    .from("documents")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("org_id", org.id);

  revalidatePath(`/org/${slug}/documents`);
  return { ok: true };
}
