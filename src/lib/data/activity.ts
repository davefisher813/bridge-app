// The activity log (migration 0044, activity_log). An append-only record
// of who did what to what, one row per server action after its own write
// succeeds, read by Admins only.
//
// The rule this file exists to hold: a summary never carries the text of
// a check-in note, a message or a document reading. It is enforced in
// the type system, not by convention. `summary` on an insert is an
// ActivitySummary, a branded string that only activitySummary() below
// can produce, and activitySummary() builds it from a fixed template per
// action out of names, statuses, kinds and dates. There is no template
// slot a note, a body or an extracted field could be handed to, so a
// caller with one in hand has nowhere to put it, and a caller that tries
// `summary: someString` fails `npm run typecheck`. The law in
// src/laws/activityLaws.test.ts greps the callers and runs the fixture
// bodies through the harness to prove neither route leaks.
//
// Logging never breaks the action that logs. logActivity() swallows its
// own failure, warns, and reports it in its return value; the business
// write already happened and a missing log line is the lesser harm.
//
// Row level security admits owner and staff of the org and nobody else,
// and no family or member page names this table (activityLaws). The
// family login's one write ("Sent a message") goes through the
// SECURITY DEFINER function log_family_message, never through here.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

// ── What the log records ─────────────────────────────────────────────
// The same closed list as the activity_action enum. A new kind of event
// is an enum addition in its own migration plus a template here.

export const ACTIVITY_ACTIONS = [
  "athlete_created",
  "athlete_edited",
  "athlete_status_changed",
  "athlete_removed",
  "advisor_set",
  "advisor_cleared",
  "target_added",
  "target_status_changed",
  "target_removed",
  "assignment_created",
  "assignment_submitted",
  "assignment_reviewed",
  "assignment_cancelled",
  "document_uploaded",
  "document_applied",
  "document_discarded",
  "document_reading",
  "document_needs_review",
  "document_ready",
  "document_archived",
  "document_unarchived",
  "checkin_logged",
  "message_sent",
  "member_invited",
  "member_role_changed",
  "member_removed",
  "view_as_started",
  "view_as_ended",
  // Every authority change is on the record (migration 0051; Dave's
  // standing rule, 2026-10-06).
  "member_title_changed",
  "seat_linked",
  "seat_unlinked",
  "steward_set",
  "steward_cleared",
  "settings_changed",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_SUBJECT_TYPES = ["athlete", "target", "assignment", "document", "checkin", "message", "member", "view_as", "seat", "donor", "org"] as const;

export type ActivitySubjectType = (typeof ACTIVITY_SUBJECT_TYPES)[number];

// Which kind of row each action is about, so a caller has one less
// thing to get wrong. Guardian link and unlink are logged as member_*
// with the athlete as subject, which is why this is a default and not a
// constraint.
export const SUBJECT_TYPE_OF: Record<ActivityAction, ActivitySubjectType> = {
  athlete_created: "athlete",
  athlete_edited: "athlete",
  athlete_status_changed: "athlete",
  athlete_removed: "athlete",
  advisor_set: "athlete",
  advisor_cleared: "athlete",
  target_added: "target",
  target_status_changed: "target",
  target_removed: "target",
  assignment_created: "assignment",
  assignment_submitted: "assignment",
  assignment_reviewed: "assignment",
  assignment_cancelled: "assignment",
  document_uploaded: "document",
  document_applied: "document",
  document_discarded: "document",
  document_reading: "document",
  document_needs_review: "document",
  document_ready: "document",
  document_archived: "document",
  document_unarchived: "document",
  checkin_logged: "checkin",
  message_sent: "message",
  member_invited: "member",
  member_role_changed: "member",
  member_removed: "member",
  view_as_started: "view_as",
  view_as_ended: "view_as",
  member_title_changed: "member",
  seat_linked: "seat",
  seat_unlinked: "seat",
  steward_set: "donor",
  steward_cleared: "donor",
  settings_changed: "org",
};

// ── The summary: a branded sentence ──────────────────────────────────
// Only activitySummary() makes one. Nothing else in src may write
// `as ActivitySummary` (activityLaws).

export type ActivitySummary = string & { readonly __brand: "ActivitySummary" };

export const SUMMARY_MAX = 200;

// What each template may be handed: names, statuses, kinds and dates,
// nothing free-form. `name` is always the athlete's name where the row
// is about an athlete, and the person's where it is about a member.
export interface ActivitySubjects {
  athlete_created: { name: string };
  athlete_edited: { name: string };
  athlete_status_changed: { name: string; from?: string | null; to: string };
  athlete_removed: { name: string };
  advisor_set: { name: string; advisor: string };
  advisor_cleared: { name: string };
  target_added: { name: string; school: string };
  target_status_changed: { name: string; school: string; from?: string | null; to: string };
  target_removed: { name: string; school: string };
  // `kind` is the assignment's kind or category label, never its title
  // or instructions.
  assignment_created: { name: string; kind: string };
  // A submission is written by the database for the family login, from
  // literals that name nobody ("Submitted the upload assignment"), so the
  // name is optional here.
  assignment_submitted: { name?: string | null; kind: string };
  assignment_reviewed: { name: string; kind: string; to: string };
  assignment_cancelled: { name: string; kind: string };
  // `kind` is the document category (transcript, test score, ...); the
  // athlete may not be known yet on an upload.
  document_uploaded: { name?: string | null; kind: string };
  document_applied: { name: string; kind: string };
  document_discarded: { name?: string | null; kind: string };
  // The vault's five states (migration 0048). Each is one move of one
  // document; the reason a file landed in Needs Review stays on the
  // document, never in the log (a reader's error can quote the page).
  document_reading: { name?: string | null; kind: string };
  document_needs_review: { name?: string | null; kind: string };
  document_ready: { name?: string | null; kind: string };
  document_archived: { name?: string | null; kind: string };
  document_unarchived: { name?: string | null; kind: string };
  // `kind` is call, meeting, text or other; `date` is the day it
  // happened (ISO date). The note stays in athlete_checkins.
  checkin_logged: { name: string; kind: string; date?: string | null };
  // The body stays in athlete_messages. The family path writes the
  // fixed "Sent a message" from SQL; an Admin's row can name the athlete.
  message_sent: { name?: string | null };
  // `role` is the access level shown (Admin, Viewer, Athlete); `athlete`
  // names the athlete a family login was linked to, when it was one.
  member_invited: { name?: string | null; role: string; athlete?: string | null };
  member_role_changed: { name: string; from?: string | null; to: string };
  member_removed: { name: string; athlete?: string | null };
  view_as_started: { name: string; role?: string | null };
  view_as_ended: { name: string };
  // `to` is the new Title, a short label an Admin typed for display; null
  // when it was cleared.
  member_title_changed: { name: string; to?: string | null };
  // `name` is the seat holder's name on the board; `person` the sign-in.
  seat_linked: { name: string; person: string };
  seat_unlinked: { name: string };
  // `name` is the donor's name; `person` the Admin stewarding them.
  steward_set: { name: string; person: string };
  steward_cleared: { name: string };
  // `setting` is a fixed phrase built by the caller ("the modules", "the
  // Doc AI budget to $20"), never form text.
  settings_changed: { setting: string };
}

// Names are clipped so two of them and two statuses still fit the
// column's 200 characters; the whole sentence is clipped last as a
// backstop, so an insert never fails on length.
const NAME_MAX = 50;
const WORD_MAX = 30;

function clip(value: string | null | undefined, max: number, fallback: string): string {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return fallback;
  return v.length > max ? `${v.slice(0, max - 3).trimEnd()}...` : v;
}

const who = (name: string | null | undefined) => clip(name, NAME_MAX, "an athlete");
const person = (name: string | null | undefined) => clip(name, NAME_MAX, "someone");
const word = (value: string | null | undefined, fallback: string) => clip(value, WORD_MAX, fallback);

// "a" or "an" for the access levels and kinds that appear in templates.
function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? "an" : "a";
}

// "Sep 21, 2026" from an ISO date, or nothing when there is none.
function onDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return ` on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

function fromTo(from: string | null | undefined, to: string): string {
  const f = (from ?? "").trim();
  return f ? ` from ${word(f, "")} to ${word(to, "a new status")}` : ` to ${word(to, "a new status")}`;
}

// One sentence per action. Sentences, not titles, so copyLaws does not
// apply; commas rather than dashes, so the em dash law does.
const TEMPLATES: { [A in ActivityAction]: (s: ActivitySubjects[A]) => string } = {
  athlete_created: (s) => `Added ${who(s.name)}`,
  athlete_edited: (s) => `Edited ${who(s.name)}`,
  athlete_status_changed: (s) => `Moved ${who(s.name)}${fromTo(s.from, s.to)}`,
  athlete_removed: (s) => `Removed ${who(s.name)}`,
  advisor_set: (s) => `Set ${person(s.advisor)} as the advisor for ${who(s.name)}`,
  advisor_cleared: (s) => `Cleared the advisor for ${who(s.name)}`,
  target_added: (s) => `Added ${clip(s.school, NAME_MAX, "a school")} as a target for ${who(s.name)}`,
  target_status_changed: (s) => `Moved ${who(s.name)} at ${clip(s.school, NAME_MAX, "a school")}${fromTo(s.from, s.to)}`,
  target_removed: (s) => `Removed ${clip(s.school, NAME_MAX, "a school")} as a target for ${who(s.name)}`,
  assignment_created: (s) => `Created ${article(word(s.kind, "new"))} ${word(s.kind, "new")} assignment for ${who(s.name)}`,
  assignment_submitted: (s) => (s.name ? `Submitted the ${word(s.kind, "open")} assignment for ${who(s.name)}` : `Submitted the ${word(s.kind, "open")} assignment`),
  assignment_reviewed: (s) => `Reviewed the ${word(s.kind, "open")} assignment for ${who(s.name)} as ${word(s.to, "reviewed")}`,
  assignment_cancelled: (s) => `Cancelled the ${word(s.kind, "open")} assignment for ${who(s.name)}`,
  document_uploaded: (s) => (s.name ? `Uploaded ${article(word(s.kind, "document"))} ${word(s.kind, "document")} for ${who(s.name)}` : `Uploaded ${article(word(s.kind, "document"))} ${word(s.kind, "document")}`),
  document_applied: (s) => `Applied ${article(word(s.kind, "document"))} ${word(s.kind, "document")} to ${who(s.name)}`,
  document_discarded: (s) => (s.name ? `Discarded ${article(word(s.kind, "document"))} ${word(s.kind, "document")} for ${who(s.name)}` : `Discarded ${article(word(s.kind, "document"))} ${word(s.kind, "document")}`),
  document_reading: (s) => `Started reading ${article(word(s.kind, "document"))} ${word(s.kind, "document")}${s.name ? ` for ${who(s.name)}` : ""}`,
  document_needs_review: (s) => `Moved ${article(word(s.kind, "document"))} ${word(s.kind, "document")} to Needs Review${s.name ? ` for ${who(s.name)}` : ""}`,
  document_ready: (s) => `Marked ${article(word(s.kind, "document"))} ${word(s.kind, "document")} Ready${s.name ? ` for ${who(s.name)}` : ""}`,
  document_archived: (s) => `Archived ${article(word(s.kind, "document"))} ${word(s.kind, "document")}${s.name ? ` for ${who(s.name)}` : ""}`,
  document_unarchived: (s) => `Unarchived ${article(word(s.kind, "document"))} ${word(s.kind, "document")}${s.name ? ` for ${who(s.name)}` : ""}`,
  checkin_logged: (s) => `Logged ${article(word(s.kind, "check-in"))} ${word(s.kind, "check-in")} check-in for ${who(s.name)}${onDate(s.date)}`,
  message_sent: (s) => (s.name ? `Sent a message to the family of ${who(s.name)}` : "Sent a message"),
  member_invited: (s) => {
    const level = word(s.role, "Viewer");
    const base = `Invited ${person(s.name)} as ${article(level)} ${level}`;
    return s.athlete ? `${base} for ${who(s.athlete)}` : base;
  },
  member_role_changed: (s) => `Changed ${person(s.name)}${fromTo(s.from, s.to)}`,
  member_removed: (s) => (s.athlete ? `Removed ${person(s.name)} from ${who(s.athlete)}` : `Removed ${person(s.name)}`),
  view_as_started: (s) => (s.role ? `Started viewing as ${person(s.name)}, ${article(word(s.role, ""))} ${word(s.role, "")}` : `Started viewing as ${person(s.name)}`),
  view_as_ended: (s) => `Stopped viewing as ${person(s.name)}`,
  member_title_changed: (s) => (s.to ? `Set the title for ${person(s.name)} to ${word(s.to, "a title")}` : `Cleared the title for ${person(s.name)}`),
  seat_linked: (s) => `Linked the board seat of ${person(s.name)} to the sign-in of ${person(s.person)}`,
  seat_unlinked: (s) => `Unlinked the board seat of ${person(s.name)} from its sign-in`,
  steward_set: (s) => `Set ${person(s.person)} as the steward for ${clip(s.name, NAME_MAX, "a donor")}`,
  steward_cleared: (s) => `Cleared the steward for ${clip(s.name, NAME_MAX, "a donor")}`,
  settings_changed: (s) => `Changed ${clip(s.setting, 80, "the settings")}`,
};

// The only way to make an ActivitySummary. Takes an action and the small
// subject its template accepts; returns the sentence, never over
// SUMMARY_MAX characters and never blank.
export function activitySummary<A extends ActivityAction>(action: A, subject: ActivitySubjects[A]): ActivitySummary {
  const build = TEMPLATES[action] as (s: ActivitySubjects[A]) => string;
  const sentence = build(subject).replace(/\s+/g, " ").trim() || "Did something";
  const fitted = sentence.length > SUMMARY_MAX ? `${sentence.slice(0, SUMMARY_MAX - 3).trimEnd()}...` : sentence;
  return fitted as ActivitySummary;
}

// ── Writing a row ────────────────────────────────────────────────────

export interface ActivityEntry {
  orgId: string;
  actorId: string;
  action: ActivityAction;
  subjectType: ActivitySubjectType;
  subjectId?: string | null;
  athleteId?: string | null;
  summary: ActivitySummary;
}

export type ActivityLogResult = { ok: true; id: string | null } | { ok: false; error: string };

// Appends one row. Never throws: a logging failure is reported in the
// result and warned about, and the caller's own write stands. The
// database sets created_at and, for an ordinary session, actor_id from
// the session (migration 0044), so neither is trusted from here.
export async function logActivity(client: Client, entry: ActivityEntry): Promise<ActivityLogResult> {
  const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
  if (!summary || summary.length > SUMMARY_MAX) {
    console.warn(`activity_log: ${entry.action} skipped, the summary was blank or too long`);
    return { ok: false, error: "The summary was blank or too long." };
  }
  if (!ACTIVITY_ACTIONS.includes(entry.action) || !ACTIVITY_SUBJECT_TYPES.includes(entry.subjectType)) {
    console.warn(`activity_log: ${String(entry.action)} skipped, not a listed action or subject type`);
    return { ok: false, error: "Not a listed action or subject type." };
  }
  try {
    const { data, error } = await client
      .from("activity_log")
      .insert({
        org_id: entry.orgId,
        athlete_id: entry.athleteId ?? null,
        actor_id: entry.actorId,
        action: entry.action,
        subject_type: entry.subjectType,
        subject_id: entry.subjectId ?? null,
        summary,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn(`activity_log: ${entry.action} was not recorded: ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: ((data as { id?: string } | null)?.id as string | undefined) ?? null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`activity_log: ${entry.action} was not recorded: ${message}`);
    return { ok: false, error: message };
  }
}

// ── Reading it back ──────────────────────────────────────────────────

export interface ActivityRow {
  id: string;
  action: ActivityAction;
  subjectType: ActivitySubjectType;
  subjectId: string | null;
  athleteId: string | null;
  summary: string;
  createdAt: string;
  actorId: string | null;
  // Null when the actor's account is gone (actor_id set null) or the
  // reader cannot see their users row.
  actorName: string | null;
}

type Person = { full_name: string | null; email: string | null };

interface ActivityDbRow {
  id: string;
  action: ActivityAction;
  subject_type: ActivitySubjectType;
  subject_id: string | null;
  athlete_id: string | null;
  summary: string;
  created_at: string;
  actor_id: string | null;
  users: Person | Person[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toRow(r: ActivityDbRow): ActivityRow {
  const actor = r.actor_id ? unwrap(r.users) : null;
  return {
    id: r.id,
    action: r.action,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    athleteId: r.athlete_id,
    summary: r.summary,
    createdAt: r.created_at,
    actorId: r.actor_id,
    actorName: actor?.full_name?.trim() || actor?.email?.trim() || null,
  };
}

// One athlete's log, newest first. The profile section shows the last
// five; the athlete's Activity screen shows them all.
export async function loadAthleteActivity(client: Client, orgId: string, athleteId: string, limit?: number): Promise<ActivityRow[]> {
  const query = client
    .from("activity_log")
    .select("id, action, subject_type, subject_id, athlete_id, summary, created_at, actor_id, users(full_name, email)")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: false });
  const { data } = limit ? await query.limit(limit) : await query;
  return ((data ?? []) as ActivityDbRow[]).map(toRow);
}

// How many rows the org-wide read pulls before searching in memory. The
// search runs over the summary and the actor's name, which the database
// cannot do in one query without a join it has no index for; at this
// size the read is one round trip and the filter is instant.
export const ORG_ACTIVITY_SCAN = 500;

export interface OrgActivityOptions {
  // Matches the summary or the actor's name, case-insensitively.
  q?: string | null;
  // Rows to hand back after the search, and where to start.
  limit?: number;
  offset?: number;
}

export interface OrgActivity {
  rows: ActivityRow[];
  // True when more rows match than were handed back.
  hasMore: boolean;
  // How many rows matched in all (within the scan).
  total: number;
}

// The org's log, newest first, searched in memory over the summary and
// the actor's name, paged by limit and offset.
export async function loadOrgActivity(client: Client, orgId: string, opts: OrgActivityOptions = {}): Promise<OrgActivity> {
  const { data } = await client
    .from("activity_log")
    .select("id, action, subject_type, subject_id, athlete_id, summary, created_at, actor_id, users(full_name, email)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(ORG_ACTIVITY_SCAN);
  const all = ((data ?? []) as ActivityDbRow[]).map(toRow);
  const matched = searchActivity(all, opts.q);
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.limit && opts.limit > 0 ? opts.limit : matched.length;
  const rows = matched.slice(offset, offset + limit);
  return { rows, hasMore: offset + rows.length < matched.length, total: matched.length };
}

// The search itself, on its own so the law can run it without a client.
export function searchActivity(rows: ActivityRow[], q: string | null | undefined): ActivityRow[] {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.summary.toLowerCase().includes(needle) || (r.actorName ?? "").toLowerCase().includes(needle));
}
