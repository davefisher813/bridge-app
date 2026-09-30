// Assignments (migration 0046, assignments). Work an Admin gives an
// athlete, with a due date; the Athlete login for that athlete submits
// it; an Admin reviews it. Cancel is a status and nothing is deleted.
//
// Three rules this file holds:
//
// 1. Overdue is computed, never stored. computeOverdue() is a pure
//    function of due_on, status and today; there is no overdue column
//    and no boolean anywhere (src/laws/assignmentLaws.test.ts). Due Soon
//    is computed the same way, over a window of DUE_SOON_DAYS days.
// 2. There is no in-progress status. A piece of work is assigned,
//    submitted, sent back for revision, complete or cancelled.
// 3. The Viewer (member) reads nothing here. Row level security admits
//    the org's Admins and the athlete's own login, and no member screen
//    or loader names this table.
//
// Every loader filters removed athletes (athletes.deleted_at), because
// assignments.athlete_id cascades on a hard delete and a soft-removed
// athlete's work should not sit in an Admin's To Review list.
//
// This module is pure over a Supabase client passed in, like the other
// loaders in this folder. The callers are server components and actions
// that have already checked who is asking; the org_id and athlete_id
// filters below are on top of that and of row level security, not
// instead of them.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

// ── The closed lists, as the migration has them ──────────────────────

export const ASSIGNMENT_CATEGORIES = ["academics", "recruiting", "eligibility", "financial_aid", "ncaa", "applications", "college_list", "athletics", "other"] as const;
export type AssignmentCategory = (typeof ASSIGNMENT_CATEGORIES)[number];

export const ASSIGNMENT_KINDS = ["upload", "complete_info", "confirm", "other"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

// No in-progress status, on purpose (Dave's plan, 2026-09-27).
export const ASSIGNMENT_STATUSES = ["assigned", "submitted", "needs_revision", "complete", "cancelled"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// Screen labels, Title Case (src/laws/copyLaws.test.ts).
export const ASSIGNMENT_CATEGORY_LABEL: Record<AssignmentCategory, string> = {
  academics: "Academics",
  recruiting: "Recruiting",
  eligibility: "Eligibility",
  financial_aid: "Financial Aid",
  ncaa: "NCAA",
  applications: "Applications",
  college_list: "College List",
  athletics: "Athletics",
  other: "Other",
};

export const ASSIGNMENT_KIND_LABEL: Record<AssignmentKind, string> = {
  upload: "Upload",
  complete_info: "Complete Info",
  confirm: "Confirm",
  other: "Other",
};

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  assigned: "Assigned",
  submitted: "Submitted",
  needs_revision: "Needs Revision",
  complete: "Complete",
  cancelled: "Cancelled",
};

// What an activity line says about an assignment's kind ("Submitted the
// upload assignment for ..."). The same four words are written by SQL in
// submit_assignment (migration 0046); a law checks the two agree.
export const ASSIGNMENT_KIND_LOG_WORD: Record<AssignmentKind, string> = {
  upload: "upload",
  complete_info: "information",
  confirm: "confirmation",
  other: "general",
};

// The review decisions an Admin may make, and the words the activity
// line carries for each.
export const REVIEW_DECISIONS = ["complete", "needs_revision"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REVIEW_DECISION_LOG_WORD: Record<ReviewDecision, string> = {
  complete: "Complete",
  needs_revision: "Needs Revision",
};

// The limits the database holds; the forms say them before it does.
export const ASSIGNMENT_TITLE_MAX = 200;
export const ASSIGNMENT_TEXT_MAX = 4000;

// Due Soon: due today or within this many days (Dave's plan: 7).
export const DUE_SOON_DAYS = 7;

// ── The client upload helper contract ────────────────────────────────
//
// An Athlete login puts the file in the documents bucket from the
// browser, then calls the submitAssignment action with the fields
// below. The path is exactly four segments, <org>/family/<request>/<file>,
// which is what the one family storage policy admits and what
// submit_assignment re-checks. The action never trusts the fields for
// the file itself: it reads the bytes back and validates them.

export const SUBMIT_FIELDS = {
  note: "note",
  storagePath: "storagePath",
  fileName: "fileName",
  mediaType: "mediaType",
} as const;

// A family upload's path: this org, the literal family folder, a request
// id, a file name with nothing that could climb out of the folder.
export const FAMILY_STORAGE_PATH = /^[0-9a-f-]{36}\/family\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;

// The same file-name cleaning the staff uploader does, so both build a
// path the bucket and these rules accept.
export function safeStorageFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return cleaned || "file";
}

// The path a family upload goes to, or null when the pieces would not
// make a path the rules accept.
export function familyStoragePath(orgId: string, requestId: string, fileName: string): string | null {
  const path = `${orgId}/family/${requestId}/${safeStorageFileName(fileName)}`;
  return isFamilyStoragePathFor(path, orgId) ? path : null;
}

// True when the path is a family path in this org: the shape, the org
// prefix, and no bare dot segment for a file name.
export function isFamilyStoragePathFor(path: string, orgId: string): boolean {
  return FAMILY_STORAGE_PATH.test(path) && path.startsWith(`${orgId}/family/`) && !/\/\.\.?$/.test(path);
}

// ── Overdue and Due Soon: pure, never stored ─────────────────────────

// Work still open on the family's side: assigned, or sent back.
export function isOpenStatus(status: string): boolean {
  return status === "assigned" || status === "needs_revision";
}

// The org's calendar day, as YYYY-MM-DD. There is no per-org time zone
// yet and both orgs are in the New York area, so a due date is over when
// New York's day has moved past it, not when UTC's has (which would be
// 8pm the evening before).
export const ORG_TIME_ZONE = "America/New_York";

export function todayIso(now: Date = new Date(), timeZone: string = ORG_TIME_ZONE): string {
  return now.toLocaleDateString("en-CA", { timeZone });
}

function dayOf(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : todayIso(value);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Overdue is due_on in the past on a row still open (assigned or sent
// back). A row due today is not overdue until tomorrow. A row with no
// due date is never overdue, and a submitted, complete or cancelled one
// is never overdue whatever its date. `today` is a YYYY-MM-DD string or
// a Date (read as the org's calendar day).
export function computeOverdue(dueOn: string | null | undefined, status: string, today: string | Date): boolean {
  if (!dueOn || !isOpenStatus(status)) return false;
  return dayOf(dueOn) < dayOf(today);
}

// Due Soon is open, not overdue, and due today or within `days` days.
export function computeDueSoon(dueOn: string | null | undefined, status: string, today: string | Date, days: number = DUE_SOON_DAYS): boolean {
  if (!dueOn || !isOpenStatus(status)) return false;
  const due = dayOf(dueOn);
  const now = dayOf(today);
  return due >= now && due <= addDays(now, days);
}

// ── The row ──────────────────────────────────────────────────────────

export interface Assignment {
  id: string;
  orgId: string;
  athleteId: string;
  title: string;
  instructions: string | null;
  category: AssignmentCategory;
  kind: AssignmentKind;
  dueOn: string | null;
  status: AssignmentStatus;
  documentId: string | null;
  familyNote: string | null;
  reviewerComment: string | null;
  createdBy: string | null;
  reviewedBy: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// An assignment with the athlete it belongs to, for the org-wide lists.
export interface OrgAssignment extends Assignment {
  athleteName: string;
}

// Every select below spells its columns out (the schema law reads them
// against the migration and cannot read a built string).
interface AssignmentDbRow {
  id: string;
  org_id: string;
  athlete_id: string;
  title: string;
  instructions: string | null;
  category: AssignmentCategory;
  kind: AssignmentKind;
  due_on: string | null;
  status: AssignmentStatus;
  document_id: string | null;
  family_note: string | null;
  reviewer_comment: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  athletes?: { name: string | null; deleted_at: string | null } | { name: string | null; deleted_at: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export function toAssignment(r: AssignmentDbRow): Assignment {
  return {
    id: r.id,
    orgId: r.org_id,
    athleteId: r.athlete_id,
    title: r.title,
    instructions: r.instructions ?? null,
    category: r.category,
    kind: r.kind,
    dueOn: r.due_on ?? null,
    status: r.status,
    documentId: r.document_id ?? null,
    familyNote: r.family_note ?? null,
    reviewerComment: r.reviewer_comment ?? null,
    createdBy: r.created_by ?? null,
    reviewedBy: r.reviewed_by ?? null,
    submittedAt: r.submitted_at ?? null,
    reviewedAt: r.reviewed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Ordering and grouping: pure ──────────────────────────────────────

// Overdue first, then Due Soon, then the rest of the open rows by due
// date (none last), then submitted, then complete, then cancelled. Ties
// by due date, then title, so the order is stable. Returns a new array.
export function sortByUrgency<T extends Pick<Assignment, "dueOn" | "status" | "title">>(rows: readonly T[], today: string | Date): T[] {
  const rank = (r: T): number => {
    if (computeOverdue(r.dueOn, r.status, today)) return 0;
    if (computeDueSoon(r.dueOn, r.status, today)) return 1;
    if (isOpenStatus(r.status)) return 2;
    if (r.status === "submitted") return 3;
    if (r.status === "complete") return 4;
    return 5;
  };
  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
    if (a.dueOn && !b.dueOn) return -1;
    if (!a.dueOn && b.dueOn) return 1;
    return a.title.localeCompare(b.title);
  });
}

// The three groups the athlete's full list shows: Open (assigned or
// sent back), Submitted, Done (complete or cancelled).
export function groupAssignments<T extends Pick<Assignment, "status">>(rows: readonly T[]): { open: T[]; submitted: T[]; done: T[] } {
  return {
    open: rows.filter((r) => isOpenStatus(r.status)),
    submitted: rows.filter((r) => r.status === "submitted"),
    done: rows.filter((r) => r.status === "complete" || r.status === "cancelled"),
  };
}

// The org-wide screen's three sections: Submitted for Review, Overdue,
// Due Soon. A row is in at most one: overdue and due soon exclude each
// other, and only open rows are in either.
export function partitionOrgAssignments<T extends Pick<Assignment, "dueOn" | "status" | "title">>(
  rows: readonly T[],
  today: string | Date,
): { submitted: T[]; overdue: T[]; dueSoon: T[] } {
  const sorted = sortByUrgency(rows, today);
  return {
    submitted: sorted.filter((r) => r.status === "submitted"),
    overdue: sorted.filter((r) => computeOverdue(r.dueOn, r.status, today)),
    dueSoon: sorted.filter((r) => computeDueSoon(r.dueOn, r.status, today)),
  };
}

// ── Counts, per athlete: pure ────────────────────────────────────────

export interface AssignmentCounts {
  overdue: number;
  toReview: number;
  open: number;
}

const NO_COUNTS: AssignmentCounts = { overdue: 0, toReview: 0, open: 0 };

// "N overdue, N to review" per athlete, for My Athletes. An athlete with
// nothing is absent from the map; use countsFor() to read one.
export function countByAthlete<T extends Pick<Assignment, "athleteId" | "dueOn" | "status">>(rows: readonly T[], today: string | Date): Map<string, AssignmentCounts> {
  const out = new Map<string, AssignmentCounts>();
  for (const r of rows) {
    const c = out.get(r.athleteId) ?? { overdue: 0, toReview: 0, open: 0 };
    if (computeOverdue(r.dueOn, r.status, today)) c.overdue += 1;
    if (r.status === "submitted") c.toReview += 1;
    if (isOpenStatus(r.status)) c.open += 1;
    out.set(r.athleteId, c);
  }
  return out;
}

export function countsFor(map: Map<string, AssignmentCounts>, athleteId: string): AssignmentCounts {
  return map.get(athleteId) ?? NO_COUNTS;
}

// ── Loaders ──────────────────────────────────────────────────────────

// One athlete's assignments, every status, newest first. An Admin sees
// them all; a family login sees its own athlete's through row level
// security, and the athlete must be one of the org's live athletes.
export async function loadAthleteAssignments(client: Client, orgId: string, athleteId: string): Promise<Assignment[]> {
  const { data: athlete } = await client.from("athletes").select("id").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  if (!athlete) return [];
  const { data } = await client
    .from("assignments")
    .select("id, org_id, athlete_id, title, instructions, category, kind, due_on, status, document_id, family_note, reviewer_comment, created_by, reviewed_by, submitted_at, reviewed_at, created_at, updated_at")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as AssignmentDbRow[]).map(toAssignment);
}

// One assignment, scoped to its org and athlete, or null. A row of
// another org or another athlete, or of a removed athlete, is null.
export async function loadAssignment(client: Client, orgId: string, athleteId: string, assignmentId: string): Promise<Assignment | null> {
  const { data: athlete } = await client.from("athletes").select("id").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  if (!athlete) return null;
  const { data } = await client
    .from("assignments")
    .select("id, org_id, athlete_id, title, instructions, category, kind, due_on, status, document_id, family_note, reviewer_comment, created_by, reviewed_by, submitted_at, reviewed_at, created_at, updated_at")
    .eq("id", assignmentId)
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  return data ? toAssignment(data as AssignmentDbRow) : null;
}

export interface AssignmentDocument {
  id: string;
  fileName: string;
  mediaType: string;
  fileSize: number;
  createdAt: string;
}

// The file an assignment was answered with, for the link on the Admin's
// detail screen and the family's own screen. Scoped to the org and the
// athlete, so a document id that is not this athlete's is null.
export async function loadAssignmentDocument(client: Client, orgId: string, athleteId: string, documentId: string | null): Promise<AssignmentDocument | null> {
  if (!documentId) return null;
  const { data } = await client
    .from("documents")
    .select("id, file_name, media_type, file_size, created_at")
    .eq("id", documentId)
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  const d = data as { id: string; file_name: string; media_type: string; file_size: number; created_at: string } | null;
  return d ? { id: d.id, fileName: d.file_name, mediaType: d.media_type, fileSize: d.file_size, createdAt: d.created_at } : null;
}

// The org's assignments with each athlete's name, newest first. With
// openOnly, only rows an Admin still has something to do about: assigned,
// sent back or submitted (Today and the org-wide list read these). Rows of
// removed athletes are left out. Admin only: row level security gives
// anyone else nothing.
export async function loadOrgAssignments(client: Client, orgId: string, opts: { openOnly?: boolean } = {}): Promise<OrgAssignment[]> {
  const base = client.from("assignments").select("id, org_id, athlete_id, title, instructions, category, kind, due_on, status, document_id, family_note, reviewer_comment, created_by, reviewed_by, submitted_at, reviewed_at, created_at, updated_at, athletes(name, deleted_at)").eq("org_id", orgId);
  const { data } = await (opts.openOnly ? base.in("status", ["assigned", "needs_revision", "submitted"]) : base).order("created_at", { ascending: false });
  const out: OrgAssignment[] = [];
  for (const r of (data ?? []) as AssignmentDbRow[]) {
    const athlete = unwrap(r.athletes);
    if (!athlete || athlete.deleted_at) continue;
    out.push({ ...toAssignment(r), athleteName: athlete.name?.trim() || "Athlete" });
  }
  return out;
}

// Counts per athlete for My Athletes and the roster: overdue, waiting on
// review, open. One read of the org's open rows, computed here.
export async function loadAssignmentCounts(client: Client, orgId: string, today: string | Date = todayIso()): Promise<Map<string, AssignmentCounts>> {
  const rows = await loadOrgAssignments(client, orgId, { openOnly: true });
  return countByAthlete(rows, today);
}
