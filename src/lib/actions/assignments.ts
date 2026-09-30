"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { activitySummary, logActivity } from "@/lib/data/activity";
import {
  ASSIGNMENT_KIND_LOG_WORD,
  REVIEW_DECISION_LOG_WORD,
  SUBMIT_FIELDS,
  isFamilyStoragePathFor,
  isOpenStatus,
  loadAssignment,
  type ReviewDecision,
} from "@/lib/data/assignments";
import { parseAssignmentForm, parseReview, parseSubmissionNote } from "@/lib/validation/assignment";
import { checkIngestedRecord } from "@/lib/docai/acceptance";

// Assignments (migration 0046). An Admin creates, reviews and cancels;
// the Athlete login for the athlete submits, through one database
// function and nothing else.
//
// Every action scopes by org and athlete and refuses the wrong role:
//
//   - createAssignment, reviewAssignment (and its two wrappers) and
//     cancelAssignment are Admin only (requireRole with STAFF_ROLES: an
//     Athlete login or a Viewer is sent away). Every write is filtered by
//     org_id, athlete_id and id, and a zero-row result says so rather
//     than pretending it saved. Each writes its activity_log line after
//     its own write succeeds (names and kinds only, never the title, the
//     instructions, the family's note or the reviewer's comment).
//   - submitAssignment is the Athlete login only (requireFamily, then
//     requireFamilyAthlete: an Admin is refused, and an athlete the
//     login is not linked to is not found). It writes through
//     supabase.rpc("submit_assignment") and never touches the assignments
//     table itself; the function writes the log line. There is no email.
//
// No Doc AI runs on a submission. The file is kept (a documents row with
// status filed), never read by a model, never in Needs Review.

export interface AssignmentActionState {
  errors: Record<string, string>;
  // What was typed, handed back on a refusal so the form keeps it.
  comment?: string;
  note?: string;
}

// RLS only checks the new row's own org_id; the athlete must be this
// org's too (the coherence trigger is the backstop). The name comes
// back for the activity log's line.
async function loadOrgAthlete(orgId: string, athleteId: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id, name").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

// The profile, its assignment screens, Today, My Athletes, the org-wide
// list and the family's screens for the same athlete.
function revalidateAssignments(slug: string, athleteId: string, assignmentId?: string) {
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster/${athleteId}/assignments`);
  if (assignmentId) revalidatePath(`/org/${slug}/roster/${athleteId}/assignments/${assignmentId}`);
  revalidatePath(`/org/${slug}`);
  revalidatePath(`/org/${slug}/mine`);
  revalidatePath(`/org/${slug}/assignments`);
  revalidatePath(`/org/${slug}/family/${athleteId}`);
  if (assignmentId) revalidatePath(`/org/${slug}/family/${athleteId}/assignments/${assignmentId}`);
}

// ── Admin: create ────────────────────────────────────────────────────

export async function createAssignment(slug: string, athleteId: string, _prevState: AssignmentActionState, formData: FormData): Promise<AssignmentActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseAssignmentForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const athlete = await loadOrgAthlete(org.id, athleteId);
  if (!athlete) return { errors: { form: "That athlete isn't on this org's roster." } };

  const v = parsed.values;
  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("assignments")
    .insert({
      org_id: org.id,
      athlete_id: athleteId,
      title: v.title,
      instructions: v.instructions ?? null,
      category: v.category,
      kind: v.kind,
      due_on: v.dueOn ?? null,
      created_by: user.id,
    })
    .select("id")
    .maybeSingle();
  if (error) return { errors: { form: error.message } };
  const createdId = (created as { id?: string } | null)?.id ?? null;

  // The line names the athlete and the kind. Never the title or the
  // instructions.
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: athlete.id,
    action: "assignment_created",
    subjectType: "assignment",
    subjectId: createdId,
    summary: activitySummary("assignment_created", { name: athlete.name, kind: ASSIGNMENT_KIND_LOG_WORD[v.kind] }),
  });

  revalidateAssignments(slug, athleteId, createdId ?? undefined);
  redirect(`/org/${slug}/roster/${athleteId}/assignments`);
}

// ── Admin: review ────────────────────────────────────────────────────

// Complete, or Needs Revision with the comment that says what to change.
// Only a submitted assignment is reviewed, and the update says so in its
// own filter, so two Admins reviewing at once cannot both win.
export async function reviewAssignment(
  slug: string,
  athleteId: string,
  assignmentId: string,
  decision: string,
  comment: string | null | undefined,
): Promise<AssignmentActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const typed = (comment ?? "").trim();
  const parsed = parseReview(decision, comment);
  if (!parsed.ok || !parsed.decision) return { errors: parsed.errors, comment: typed };

  const athlete = await loadOrgAthlete(org.id, athleteId);
  if (!athlete) return { errors: { form: "That athlete isn't on this org's roster." }, comment: typed };

  const supabase = await createClient();
  const assignment = await loadAssignment(supabase, org.id, athleteId, assignmentId);
  if (!assignment) return { errors: { form: "That assignment is not on this athlete's list any more." }, comment: typed };
  if (assignment.status !== "submitted") return { errors: { form: "Only a submitted assignment can be reviewed." }, comment: typed };

  const patch: Record<string, unknown> = {
    status: parsed.decision,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  };
  // A comment on Complete is optional and is kept when given; on Needs
  // Revision it is required and always written.
  if (parsed.comment) patch.reviewer_comment = parsed.comment;

  const { data, error } = await supabase
    .from("assignments")
    .update(patch)
    .eq("id", assignmentId)
    .eq("org_id", org.id)
    .eq("athlete_id", athleteId)
    .eq("status", "submitted")
    .select("id");
  if (error) return { errors: { form: error.message }, comment: typed };
  if (!data || data.length === 0) return { errors: { form: "That assignment was already reviewed." }, comment: typed };

  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: athlete.id,
    action: "assignment_reviewed",
    subjectType: "assignment",
    subjectId: assignmentId,
    summary: activitySummary("assignment_reviewed", {
      name: athlete.name,
      kind: ASSIGNMENT_KIND_LOG_WORD[assignment.kind],
      to: REVIEW_DECISION_LOG_WORD[parsed.decision as ReviewDecision],
    }),
  });

  revalidateAssignments(slug, athleteId, assignmentId);
  return { errors: {} };
}

// The Needs Revision form: the same review with the comment read off the
// form's own field, for a useActionState form.
export async function reviewAssignmentForm(
  slug: string,
  athleteId: string,
  assignmentId: string,
  decision: string,
  _prevState: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  return reviewAssignment(slug, athleteId, assignmentId, decision, String(formData.get("comment") ?? ""));
}

// The Complete button: a form action that returns nothing. A refusal
// (not submitted, not this athlete's) changes nothing and the screen
// simply shows the row as it is.
export async function completeAssignment(slug: string, athleteId: string, assignmentId: string): Promise<void> {
  await reviewAssignment(slug, athleteId, assignmentId, "complete", null);
}

// ── Admin: cancel ────────────────────────────────────────────────────

// Cancel is a status and history stays. A complete row is refused, and
// so is one already cancelled; both change nothing. Posted by the Cancel
// button behind a confirm, so it returns nothing.
export async function cancelAssignment(slug: string, athleteId: string, assignmentId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const athlete = await loadOrgAthlete(org.id, athleteId);
  if (!athlete) return;
  const supabase = await createClient();
  const assignment = await loadAssignment(supabase, org.id, athleteId, assignmentId);
  if (!assignment || assignment.status === "complete" || assignment.status === "cancelled") return;

  const { data, error } = await supabase
    .from("assignments")
    .update({ status: "cancelled" })
    .eq("id", assignmentId)
    .eq("org_id", org.id)
    .eq("athlete_id", athleteId)
    .in("status", ["assigned", "submitted", "needs_revision"])
    .select("id");
  if (error || !data || data.length === 0) return;

  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: athlete.id,
    action: "assignment_cancelled",
    subjectType: "assignment",
    subjectId: assignmentId,
    summary: activitySummary("assignment_cancelled", { name: athlete.name, kind: ASSIGNMENT_KIND_LOG_WORD[assignment.kind] }),
  });

  revalidateAssignments(slug, athleteId, assignmentId);
}

// ── Athlete login: submit ────────────────────────────────────────────

// The file types the bytes can really be, and the media type each one is
// filed under. The type comes from what the bytes are, never from what
// the client said.
const MEDIA_TYPE_OF: Record<string, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

// The last path segment, the file's name as it was uploaded.
function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

// Submit an assignment as the Athlete login for its athlete. For a file,
// the browser has already put it at <org>/family/<request>/<file> in the
// documents bucket (src/lib/data/assignments.ts, FAMILY_STORAGE_PATH);
// the form carries the path, the file's name and its claimed type
// (SUBMIT_FIELDS) and this action does not believe any of it:
//
//   - the bytes are read back from the bucket and checked by
//     checkIngestedRecord, from what arrived and not what was claimed,
//     the same check the staff uploader runs (the size limit lives in
//     src/lib/docai/limits.ts, once);
//   - the size and the type filed are the bytes' own;
//   - a file already sent for this athlete is refused with a pointer to
//     the first copy.
//
// The bytes are read with the service role, and only here, because an
// Athlete login has no read on the bucket (migrations 0017 and 0024) and
// is meant not to; nothing read is returned or shown. Then the one write
// is the database function. A file that is refused is left where it was
// put: this action cannot tell whose it is, and removing a stranger's
// would be worse than an orphan.
export async function submitAssignment(
  slug: string,
  athleteId: string,
  assignmentId: string,
  _prevState: AssignmentActionState,
  formData: FormData,
): Promise<AssignmentActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireFamily(org.id);
  await requireFamilyAthlete(org.id, user.id, athleteId);

  const typedNote = String(formData.get(SUBMIT_FIELDS.note) ?? "");
  const supabase = await createClient();
  const assignment = await loadAssignment(supabase, org.id, athleteId, assignmentId);
  if (!assignment) return { errors: { form: "That assignment isn't on this athlete's list." }, note: typedNote };
  if (!isOpenStatus(assignment.status)) return { errors: { form: "This assignment isn't open for submission." }, note: typedNote };

  const noted = parseSubmissionNote(formData.get(SUBMIT_FIELDS.note));
  if (!noted.ok) return { errors: noted.errors, note: typedNote };

  const storagePath = String(formData.get(SUBMIT_FIELDS.storagePath) ?? "").trim();
  let file: { name: string; size: number; mediaType: string; hash: string } | null = null;

  if (!storagePath) {
    if (assignment.kind === "upload") return { errors: { file: "Choose a file to send." }, note: typedNote };
  } else {
    if (!isFamilyStoragePathFor(storagePath, org.id)) return { errors: { file: "That file was not uploaded to your organization's family folder." }, note: typedNote };

    const claimedName = String(formData.get(SUBMIT_FIELDS.fileName) ?? "").trim() || baseName(storagePath);
    const claimedType = String(formData.get(SUBMIT_FIELDS.mediaType) ?? "").trim();

    const { data: blob, error: readError } = await createAdminClient().storage.from("documents").download(storagePath);
    if (readError || !blob) return { errors: { file: `${claimedName} could not be read back after upload. Try again.` }, note: typedNote };
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // The claimed type only decides which way a mismatch is refused; the
    // bytes decide what the file is.
    const verdict = checkIngestedRecord({
      originalName: claimedName,
      originalSize: bytes.byteLength,
      mediaType: claimedType,
      kind: claimedType === "application/pdf" ? "pdf" : "image",
      base64Length: Math.ceil(bytes.byteLength / 3) * 4,
      byteLength: bytes.byteLength,
      header: bytes.slice(0, 64),
    });
    if (!verdict.ok) return { errors: { file: verdict.reason ?? "That file cannot be sent." }, note: typedNote };
    const mediaType = MEDIA_TYPE_OF[verdict.sniffed];
    if (!mediaType) return { errors: { file: `${claimedName} is not a PDF or an image.` }, note: typedNote };

    const hash = createHash("sha256").update(bytes).digest("hex");
    // The same bytes twice is the same document twice. Read through the
    // caller's own session, so a login sees only its own athlete's
    // documents here, and a discarded copy does not count.
    const { data: twin } = await supabase
      .from("documents")
      .select("id, file_name, status, created_at")
      .eq("org_id", org.id)
      .eq("content_hash", hash)
      .neq("status", "discarded")
      .order("created_at", { ascending: false })
      .limit(1);
    const earlier = ((twin ?? []) as { id: string; file_name: string; created_at: string }[])[0];
    if (earlier) {
      const when = new Date(earlier.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return { errors: { file: `This exact file was already uploaded on ${when} as ${earlier.file_name}. Send the corrected file instead.` }, note: typedNote };
    }
    file = { name: claimedName.slice(0, 200), size: bytes.byteLength, mediaType, hash };
  }

  // The one write. The function checks the link, the status, the path
  // and the owner of the file again, files the document, moves the row
  // and writes its log line.
  const { error } = await supabase.rpc("submit_assignment", {
    p_assignment: assignmentId,
    p_note: noted.note,
    p_file_name: file?.name ?? null,
    p_file_size: file?.size ?? null,
    p_media_type: file?.mediaType ?? null,
    p_storage_path: file ? storagePath : null,
    p_content_hash: file?.hash ?? null,
  });
  if (error) return { errors: { form: error.message.replace(/^submit_assignment:\s*/, "") }, note: typedNote };

  revalidateAssignments(slug, athleteId, assignmentId);
  redirect(`/org/${slug}/family/${athleteId}`);
}
