"use server";

// Bulk actions on the Documents list (Dave, 2026-10-13: "dozens of
// student athletes; one-at-a-time actions are too slow"). Each takes the
// ids BulkSelect posts (repeated `ids` fields) and applies the SAME rule
// the single-document action applies, to each document on its own:
//
//   - Approve: Needs Review to Ready, through moveLifecycle, honouring the
//     document approver gate (migration 0067). A document whose area has a
//     named approver who is not the caller is skipped, never forced.
//   - Archive and Restore: the app's soft put-away and its undo. Nothing
//     is deleted; the file and its record stay for good.
//   - Link to Athlete and Set Type: linkDocumentToAthlete and
//     fileDocumentAs, with their rules (src/lib/data/documentMoves.ts).
//
// Every action: Admins only, scoped by org_id AND ids (an id from another
// org is simply not found and counted as skipped), ONE activity_log row
// per document that changed (the kind of document, never a title), and a
// redirect to the same view with a notice that names how many changed and
// how many were skipped and why. No document is read and no model is called.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseBulkIds, SUGGEST_CAP } from "@/lib/bulk/ids";
import { bulkNotice, SkipTally } from "@/lib/bulk/notice";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { moveLifecycle } from "@/lib/data/vault";
import { loadDocApprovers } from "@/lib/data/docApprovers";
import { loadSuggestionRoster, refreshSuggestion } from "@/lib/data/documentSuggestions";
import { documentKind, isSettableType, moveBlock, orgAthleteName, typeBlock, typePatch } from "@/lib/data/documentMoves";
import { NOBODY_NAMED, type ApproverMap } from "@/lib/documents/approvers";
import { FILE_TYPE_LABEL, isFileType, READER_TYPES, type FileTypeId } from "@/lib/documents/fileTypes";
import { canMove, isLifecycle, type Lifecycle } from "@/lib/vault/lifecycle";
import type { DocCategoryId } from "@/lib/docai/types";

const VIEWS = ["all", "needs_review", "ready", "archived"] as const;

const q = (s: string) => encodeURIComponent(s);

// The list the person was on, so a finished action comes back to it.
function listUrl(slug: string, formData: FormData): string {
  const view = String(formData.get("view") ?? "");
  const search = String(formData.get("q") ?? "").trim().slice(0, 100);
  const qs = new URLSearchParams();
  if ((VIEWS as readonly string[]).includes(view) && view !== "all") qs.set("view", view);
  if (search) qs.set("q", search);
  const s = qs.toString();
  return `/org/${slug}/documents${s ? `?${s}` : ""}`;
}

function land(back: string, kind: "notice" | "error", text: string): never {
  redirect(`${back}${back.includes("?") ? "&" : "?"}${kind}=${q(text)}`);
}

interface DocRow {
  id: string;
  lifecycle: string;
  lifecycle_changed_at: string | null;
  category: DocCategoryId | null;
  requested_category: DocCategoryId | null;
  filed_as: string | null;
  athlete_id: string | null;
  linked_athlete_id: string | null;
  status: string;
  extracted: unknown;
  review_reason: string | null;
  file_name: string;
  format: string | null;
  original_paths: string[] | null;
  identity_status: string | null;
}

const COLUMNS = "id, lifecycle, lifecycle_changed_at, category, requested_category, filed_as, athlete_id, linked_athlete_id, status, extracted, review_reason, file_name, format, original_paths, identity_status";

// Who the caller is, which documents of this org the ids name, and where
// to land. Admins only, checked before anything is read or written.
async function open(slug: string, formData: FormData) {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);
  const back = listUrl(slug, formData);
  const parsed = parseBulkIds(formData);
  if (!parsed.ok) land(back, "error", parsed.error);
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select(COLUMNS).eq("org_id", org.id).in("id", parsed.ids);
  const docs = (data ?? []) as DocRow[];
  const tally = new SkipTally();
  // An id that is not this org's (or is gone) comes back as no row.
  const found = new Set(docs.map((d) => d.id));
  for (const id of parsed.ids) if (!found.has(id)) tally.add("no longer here");
  return { org, user, supabase, back, docs, tally, selected: parsed.ids.length };
}

// Names of the org's active athletes by id, one read, for the log lines.
async function athleteNames(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (wanted.length === 0) return new Map();
  const { data } = await supabase.from("athletes").select("id, name").eq("org_id", orgId).is("deleted_at", null).in("id", wanted);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));
}

function finish(slug: string, back: string, verb: string, applied: number, tally: SkipTally, tail?: string): never {
  revalidatePath(`/org/${slug}/documents`);
  const n = bulkNotice({ verb, noun: "document", applied, skipped: tally.map, tail });
  land(back, n.changed ? "notice" : "error", n.text);
}

// What each move needs a document to be now.
const FROM_FOR: Record<"ready" | "archived" | "needs_review", { reason: string }> = {
  ready: { reason: "not in Needs Review" },
  archived: { reason: "not in Needs Review or Ready" },
  needs_review: { reason: "not archived" },
};

async function moveMany(slug: string, formData: FormData, to: "ready" | "archived" | "needs_review", verb: string): Promise<never> {
  const { org, user, supabase, back, docs, tally } = await open(slug, formData);
  // Read once; only the Ready move has a gate.
  const approvers: ApproverMap = to === "ready" ? await loadDocApprovers(supabase, org.id) : NOBODY_NAMED;
  const names = await athleteNames(supabase, org.id, docs.map((d) => d.athlete_id));
  let applied = 0;
  for (const doc of docs) {
    // The state first (a Ready document is not "waiting" on anyone), then
    // the approver gate and the still-being-read check.
    if (!isLifecycle(doc.lifecycle) || !canMove(doc.lifecycle, to as Lifecycle, "staff")) {
      tally.add(doc.lifecycle === "processing" && moveBlock(doc, to, approvers, user.id) ? "still being read" : FROM_FOR[to].reason);
      continue;
    }
    const block = moveBlock(doc, to, approvers, user.id);
    if (block) {
      tally.add(block.kind === "approver" ? "waiting on their approver" : "still being read");
      continue;
    }
    const moved = await moveLifecycle(supabase, {
      orgId: org.id,
      documentId: doc.id,
      to,
      by: "staff",
      actorId: user.id,
      kind: documentKind(doc.category ?? doc.requested_category),
      athlete: doc.athlete_id && names.has(doc.athlete_id) ? { id: doc.athlete_id, name: names.get(doc.athlete_id)! } : null,
      expectedFrom: doc.lifecycle,
    });
    if (moved.ok) applied += 1;
    else tally.add("changed by someone else");
  }
  finish(slug, back, verb, applied, tally);
}

// Needs Review to Ready, the approver gate honoured per document.
export async function bulkApproveDocuments(slug: string, formData: FormData): Promise<void> {
  await moveMany(slug, formData, "ready", "Approved");
}

// Put away. Nothing is deleted; Restore brings it back.
export async function bulkArchiveDocuments(slug: string, formData: FormData): Promise<void> {
  await moveMany(slug, formData, "archived", "Archived");
}

// Archived back to Needs Review, the same move the document screen's
// Restore makes.
export async function bulkRestoreDocuments(slug: string, formData: FormData): Promise<void> {
  await moveMany(slug, formData, "needs_review", "Restored");
}

// Link each to one athlete of this org's roster (migration 0058): the
// document is listed on their page; nothing is read or applied.
export async function bulkLinkDocumentsToAthlete(slug: string, formData: FormData): Promise<void> {
  const { org, user, supabase, back, docs, tally } = await open(slug, formData);
  const raw = String(formData.get("linkedAthleteId") ?? "").trim();
  if (!raw) land(back, "error", "Pick an athlete to link to.");
  const next = await orgAthleteName(supabase, org.id, raw);
  if (!next) land(back, "error", "That athlete is not on this organization's roster.");
  const before = await athleteNames(supabase, org.id, docs.map((d) => d.linked_athlete_id));

  let applied = 0;
  const touched = new Set<string>([next.id]);
  for (const doc of docs) {
    if (doc.linked_athlete_id === next.id) {
      tally.add("already linked to them");
      continue;
    }
    const { error } = await supabase.from("documents").update({ linked_athlete_id: next.id, updated_at: new Date().toISOString() }).eq("id", doc.id).eq("org_id", org.id);
    if (error) {
      tally.add("could not be saved");
      continue;
    }
    applied += 1;
    const previous = doc.linked_athlete_id ? (before.get(doc.linked_athlete_id) ?? null) : null;
    if (doc.linked_athlete_id) touched.add(doc.linked_athlete_id);
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      athleteId: next.id,
      action: "document_linked",
      subjectType: "document",
      subjectId: doc.id,
      summary: activitySummary("document_linked", { kind: documentKind(doc.category ?? doc.requested_category), to: next.name, from: previous }),
    });
  }
  for (const id of touched) revalidatePath(`/org/${slug}/roster/${id}`);
  finish(slug, back, "Linked", applied, tally);
}

// Set the type of documents the reader has not read (fileDocumentAs's
// rule): a read document keeps the type of its reading and is skipped.
export async function bulkSetDocumentType(slug: string, formData: FormData): Promise<void> {
  const { org, user, supabase, back, docs, tally } = await open(slug, formData);
  const raw = String(formData.get("filedAs") ?? "").trim();
  if (!raw || !isSettableType(raw)) land(back, "error", "Pick one of the types listed.");
  const label = isFileType(raw) ? FILE_TYPE_LABEL[raw as FileTypeId] : READER_TYPES.find((t) => t.id === raw)!.label;

  let applied = 0;
  for (const doc of docs) {
    if (typeBlock(doc)) {
      tally.add("read already, so they keep their type");
      continue;
    }
    const { error } = await supabase.from("documents").update(typePatch(raw, doc)).eq("id", doc.id).eq("org_id", org.id);
    if (error) {
      tally.add("could not be saved");
      continue;
    }
    applied += 1;
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      athleteId: doc.linked_athlete_id,
      action: "document_typed",
      subjectType: "document",
      subjectId: doc.id,
      summary: activitySummary("document_typed", { kind: documentKind(doc.category ?? doc.requested_category), to: label }),
    });
  }
  finish(slug, back, "Typed", applied, tally, `as ${label}`);
}

// Make Who and What for each document from its original file and the
// roster as it is now (Piece 2), the same rule as the document screen's
// Suggest Again: a person's decision is never overwritten. It opens and
// reads each stored file, so a batch is capped (SUGGEST_CAP) to stay
// inside one request; a larger selection says so and does none of it.
// Suggestions are not decisions, so no activity row is written, as with
// the single action.
export async function bulkSuggestDocuments(slug: string, formData: FormData): Promise<void> {
  const { org, user, supabase, back, docs, tally, selected } = await open(slug, formData);
  if (selected > SUGGEST_CAP) land(back, "error", `Suggest for ${SUGGEST_CAP} or fewer at a time. ${selected} are selected.`);
  const roster = await loadSuggestionRoster(supabase, org.id);
  let applied = 0;
  for (const doc of docs) {
    const result = await refreshSuggestion(supabase, org.id, user.id, roster, doc as Parameters<typeof refreshSuggestion>[4]);
    if (result === "saved") applied += 1;
    else tally.add(result === "unreadable" ? "original file could not be opened" : "could not be saved");
  }
  finish(slug, back, "Suggested for", applied, tally, "");
}
