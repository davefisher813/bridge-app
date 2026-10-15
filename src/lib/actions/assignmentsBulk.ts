"use server";

// Bulk actions on the org Assignments list (Dave, 2026-10-13; migration
// 0071). The list wraps its rows in BulkSelect, which posts the chosen
// ids as repeated `ids` fields. Every action here:
//
//   - refuses anyone but an Admin first (requireRole with STAFF_ROLES),
//     before the ids are read and before any query;
//   - takes its ids through parseBulkIds (UUIDs only, de-duplicated, 200
//     at most) and scopes every read and write by org_id AND the ids, so
//     an id from another org is never touched and never named;
//   - works out which of the rows it may act on, writes only those with
//     the same rule repeated in the update's own filters (so a row that
//     moved on in between is skipped, not clobbered), and skips the rest;
//   - writes one activity_log line per row it changed (names and kinds,
//     never a title, instructions, note or comment);
//   - lands back on the list with a notice that names the counts
//     ("3 completed, 1 skipped") or, when nothing changed, an error.
//
// Delete is permanent and has no undo (the sheet says so); Cancel is the
// soft alternative. Nothing here is a one-tap change: BulkAction's sheet
// is the single confirmation and names the count.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { activitySummary, logActivity, type ActivityAction, type ActivitySummary } from "@/lib/data/activity";
import { ASSIGNMENT_KIND_LOG_WORD, REVIEW_DECISION_LOG_WORD, type AssignmentKind } from "@/lib/data/assignments";
import { parseBulkIds } from "@/lib/bulk/ids";
import { requireNotViewing } from "@/lib/data/viewAs";

interface Row {
  id: string;
  athlete_id: string;
  kind: AssignmentKind;
  status: string;
  document_id: string | null;
}

// Rows a person may still finish, cancel or re-date: everything not
// already complete or cancelled.
const ACTIVE = ["assigned", "submitted", "needs_revision"];
// Rows that may move to another athlete: nothing has happened to them on
// the family's side (migration 0071's honesty trigger holds the same line).
const MOVABLE = ["assigned", "needs_revision"];

function back(slug: string, kind: "notice" | "error", message: string): never {
  redirect(`/org/${slug}/assignments?${kind}=${encodeURIComponent(message)}`);
}

// The Admin check, the ids and the org's rows named by them, with each
// athlete's name for the log. Everything else in this file starts here.
async function begin(slug: string, formData: FormData) {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseBulkIds(formData);
  if (!parsed.ok) back(slug, "error", parsed.error);

  const supabase = await createClient();
  const { data } = await supabase.from("assignments").select("id, athlete_id, kind, status, document_id").eq("org_id", org.id).in("id", parsed.ids);
  const rows = (data ?? []) as Row[];
  const athleteIds = [...new Set(rows.map((r) => r.athlete_id))];
  const names = new Map<string, string>();
  if (athleteIds.length > 0) {
    const { data: athletes } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).in("id", athleteIds);
    for (const a of (athletes ?? []) as { id: string; name: string }[]) names.set(a.id, a.name);
  }
  return { org, user, supabase, ids: parsed.ids, rows, names };
}

type Started = Awaited<ReturnType<typeof begin>>;

async function logEach(s: Started, done: readonly Row[], action: ActivityAction, summary: (r: Row) => ActivitySummary, athleteOf: (r: Row) => string = (r) => r.athlete_id) {
  for (const r of done) {
    await logActivity(s.supabase, {
      orgId: s.org.id,
      actorId: s.user.id,
      athleteId: athleteOf(r),
      action,
      subjectType: "assignment",
      subjectId: r.id,
      summary: summary(r),
    });
  }
}

function revalidateAll(slug: string, athleteIds: Iterable<string>) {
  revalidatePath(`/org/${slug}/assignments`);
  revalidatePath(`/org/${slug}`);
  revalidatePath(`/org/${slug}/mine`);
  for (const id of new Set(athleteIds)) {
    revalidatePath(`/org/${slug}/roster/${id}`);
    revalidatePath(`/org/${slug}/roster/${id}/assignments`);
    revalidatePath(`/org/${slug}/family/${id}`);
  }
}

// "3 completed, 1 skipped.", or the error when nothing changed.
function finish(slug: string, total: number, done: number, verb: string, athleteIds: Iterable<string>, why: string): never {
  revalidateAll(slug, athleteIds);
  const skipped = total - done;
  if (done === 0) back(slug, "error", `0 ${verb}, ${skipped} skipped. ${why}`);
  back(slug, "notice", `${done} ${verb}${skipped > 0 ? `, ${skipped} skipped` : ""}.`);
}

const nameOf = (s: Started, r: Row) => s.names.get(r.athlete_id) ?? "";
const kindOf = (r: Row) => ASSIGNMENT_KIND_LOG_WORD[r.kind];

// Which of the rows came back from the write.
function changedOf(eligible: readonly Row[], data: unknown): Row[] {
  const changed = new Set(((data ?? []) as { id: string }[]).map((d) => d.id));
  return eligible.filter((r) => changed.has(r.id));
}

// ── Mark Complete ────────────────────────────────────────────────────

// Sets complete on the selected rows still assigned, submitted or sent
// back (overdue ones included: overdue is a date, not a status), stamping
// the reviewer and the time the way the single review does.
export async function bulkCompleteAssignments(slug: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const s = await begin(slug, formData);
  const eligible = s.rows.filter((r) => ACTIVE.includes(r.status));
  let done: Row[] = [];
  if (eligible.length > 0) {
    const { data, error } = await s.supabase
      .from("assignments")
      .update({ status: "complete", reviewed_by: s.user.id, reviewed_at: new Date().toISOString() })
      .eq("org_id", s.org.id)
      .in("id", eligible.map((r) => r.id))
      .in("status", ACTIVE)
      .select("id");
    if (error) back(slug, "error", `Could not mark them complete: ${error.message}`);
    done = changedOf(eligible, data);
  }
  await logEach(s, done, "assignment_reviewed", (r) => activitySummary("assignment_reviewed", { name: nameOf(s, r), kind: kindOf(r), to: REVIEW_DECISION_LOG_WORD.complete }));
  finish(slug, s.ids.length, done.length, "completed", done.map((r) => r.athlete_id), "Only open work can be marked complete.");
}

// ── Cancel ───────────────────────────────────────────────────────────

// The soft alternative to Delete: status cancelled, history stays.
export async function bulkCancelAssignments(slug: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const s = await begin(slug, formData);
  const eligible = s.rows.filter((r) => ACTIVE.includes(r.status));
  let done: Row[] = [];
  if (eligible.length > 0) {
    const { data, error } = await s.supabase
      .from("assignments")
      .update({ status: "cancelled" })
      .eq("org_id", s.org.id)
      .in("id", eligible.map((r) => r.id))
      .in("status", ACTIVE)
      .select("id");
    if (error) back(slug, "error", `Could not cancel them: ${error.message}`);
    done = changedOf(eligible, data);
  }
  await logEach(s, done, "assignment_cancelled", (r) => activitySummary("assignment_cancelled", { name: nameOf(s, r), kind: kindOf(r) }));
  finish(slug, s.ids.length, done.length, "cancelled", done.map((r) => r.athlete_id), "Complete and cancelled work stays as it is.");
}

// ── Reassign ─────────────────────────────────────────────────────────

// Moves the rows to another active athlete of the same org. Reassign
// means the assignment itself moves (its athlete_id changes), so the
// work now sits on the new athlete's list and leaves the old one's. Only
// a row nothing has happened to can move: assigned or sent back, with no
// linked file, and not already this athlete's. A submitted row, one with
// a document, and one already theirs are skipped and counted.
export async function bulkReassignAssignments(slug: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const s = await begin(slug, formData);
  const target = String(formData.get("athlete_id") ?? "").trim();
  if (!target) back(slug, "error", "Pick the athlete to move them to.");
  const { data: t } = await s.supabase.from("athletes").select("id, name").eq("id", target).eq("org_id", s.org.id).is("deleted_at", null).maybeSingle();
  const to = t as { id: string; name: string } | null;
  if (!to) back(slug, "error", "That athlete isn't on this organization's roster.");

  const eligible = s.rows.filter((r) => MOVABLE.includes(r.status) && r.document_id === null && r.athlete_id !== to.id);
  let done: Row[] = [];
  if (eligible.length > 0) {
    const { data, error } = await s.supabase
      .from("assignments")
      .update({ athlete_id: to.id })
      .eq("org_id", s.org.id)
      .in("id", eligible.map((r) => r.id))
      .in("status", MOVABLE)
      .is("document_id", null)
      .select("id");
    if (error) back(slug, "error", `Could not move them: ${error.message}`);
    done = changedOf(eligible, data);
  }
  await logEach(
    s,
    done,
    "assignment_reassigned",
    (r) => activitySummary("assignment_reassigned", { name: to.name, kind: kindOf(r), from: nameOf(s, r) }),
    () => to.id,
  );
  finish(slug, s.ids.length, done.length, "moved", [...done.map((r) => r.athlete_id), to.id], "Submitted work, work with a file and work already theirs stay where they are.");
}

// ── Change Due Date ──────────────────────────────────────────────────

// A real calendar date, or blank to clear it.
function parseDue(raw: FormDataEntryValue | null): { ok: true; due: string | null } | { ok: false } {
  const v = String(raw ?? "").trim();
  if (v === "") return { ok: true, due: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false };
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return { ok: false };
  return { ok: true, due: v };
}

export async function bulkChangeDueDate(slug: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const s = await begin(slug, formData);
  const parsed = parseDue(formData.get("due_on"));
  if (!parsed.ok) back(slug, "error", "Pick a real date, or leave it blank to clear it.");

  const eligible = s.rows.filter((r) => ACTIVE.includes(r.status));
  let done: Row[] = [];
  if (eligible.length > 0) {
    const { data, error } = await s.supabase
      .from("assignments")
      .update({ due_on: parsed.due })
      .eq("org_id", s.org.id)
      .in("id", eligible.map((r) => r.id))
      .in("status", ACTIVE)
      .select("id");
    if (error) back(slug, "error", `Could not change the due date: ${error.message}`);
    done = changedOf(eligible, data);
  }
  await logEach(s, done, "assignment_due_changed", (r) => activitySummary("assignment_due_changed", { name: nameOf(s, r), kind: kindOf(r), to: parsed.due ? "changed" : "cleared" }));
  finish(slug, s.ids.length, done.length, "updated", done.map((r) => r.athlete_id), "Complete and cancelled work keeps its date.");
}

// ── Delete ───────────────────────────────────────────────────────────

// Permanent. Admins only (migration 0071 gives the database the same
// rule). Any status. There is no undo; Cancel is the soft alternative.
// The log line is written after the delete, from what was read before it.
export async function bulkDeleteAssignments(slug: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const s = await begin(slug, formData);
  let done: Row[] = [];
  if (s.rows.length > 0) {
    const { data, error } = await s.supabase
      .from("assignments")
      .delete()
      .eq("org_id", s.org.id)
      .in("id", s.rows.map((r) => r.id))
      .select("id");
    if (error) back(slug, "error", `Could not delete them: ${error.message}`);
    done = changedOf(s.rows, data);
  }
  await logEach(s, done, "assignment_deleted", (r) => activitySummary("assignment_deleted", { name: nameOf(s, r), kind: kindOf(r) }));
  finish(slug, s.ids.length, done.length, "deleted", done.map((r) => r.athlete_id), "Nothing was deleted.");
}
