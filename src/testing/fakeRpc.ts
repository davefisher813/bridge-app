// The three SECURITY DEFINER functions of migration 0031, mirrored over
// the fixture so a member screen renders in the harness the way it
// does against the database.
//
// This is a second implementation, and that is a risk the family
// screens never carried (they read rows, and rows fake the same way).
// It is bounded two ways: the SQL is asserted on its own seed by
// scripts/rls_test.sql, and this file is asserted on the fixture by
// the render laws, with the same rules written twice in plain words:
//
//   member_program: every live athlete of the org, its stage being
//     Drafted, Graduated or Enrolled when the athlete is, else Committed
//     if the athlete is Committed or any target is (never for a
//     Transferring athlete, whose leftover Committed target is history),
//     else Offers if any target is an Offer, else Targeting if any target
//     is not Not Interested, else No Targets. The name is the team for
//     Drafted, else the Committed target's school (again not for
//     Transferring), else (Enrolled or Graduated) a transfer record's
//     Current School. Round and year for Drafted only. Migrations 0035
//     and 0038.
//   member_program_schools: one athlete's targets as school, division
//     and status, committed first.
//   member_giving: the org's gifts, pledges, campaigns, budget lines,
//     boards and seats, with every name stripped except the caller's
//     own seat and the donors of gifts credited to it.
//
// Both refuse anyone who is not owner, staff or member of the org.
//
// A fourth, submit_assignment (migration 0046), WRITES, so it takes the
// write log and lives below with its rules in plain words:
//
//   submit_assignment: the caller is signed in and linked to the
//     assignment's athlete right now (a guardian row AND a live family
//     membership in the assignment's org, as private._family_athlete_ids()
//     reads it) and the athlete is not removed, else 42501 with one
//     message for a missing row and a row that is not theirs; the row is
//     assigned or needs_revision, else 23514; a note is 4,000 characters
//     or fewer; a file, when there is one, is at <org>/family/<request>/
//     <file>, is in the bucket and owned by the caller, is not filed
//     already, has a name (200 or fewer), a positive size within the
//     bucket's limit and a type the bucket accepts, else 23514. It files a
//     document (status filed, source parent, never read), sets the row
//     submitted with the trimmed note and the time (keeping an earlier
//     document when no new file comes), and logs the literal line for the
//     kind, signed as the caller. Returns the assignment's id. An upload
//     assignment with no file, and none attached earlier, is 23514.

// Two more write functions, start_view_as and end_view_as (migration
// 0047), live at the bottom with their rules in plain words. The fake
// also models what View As does to everything else: see FakeClientOptions
// .viewing in fakeSupabase.ts.
//
//   start_view_as(p_org, p_target) and start_view_as(p_target): signed in
//     (else 42501); a session of the caller's past its time and never
//     closed is closed first, as expired, with its line; the caller is an
//     owner of the org (else 42501; a leftover staff row is not an owner);
//     the target is not the caller (23514); the caller has no session
//     still open (55000); the target is a member of that org (42501, one
//     answer for a stranger and for someone outside the org). The
//     one-argument form finds the one org the caller owns that the target
//     belongs to (none is 42501, two is 23514). It writes a session of 30
//     minutes and a log line, a literal by the role viewed ("Started
//     viewing as an Admin", "a Viewer", "an Athlete"), signed by the real
//     caller, and returns the session id.
//   end_view_as(): signed in (else 42501); closes the caller's open
//     session as returned, or expired when its time had run out, and logs
//     "Stopped viewing as someone else" or "Viewing as someone else ended
//     after 30 minutes"; nothing open is not an error and writes nothing.

import type { Dataset, RecordedWrite } from "./fakeSupabase";

type Row = Record<string, unknown>;

function admitted(data: Dataset, orgId: string, userId: string | null): boolean {
  if (!userId) return false;
  return (data.org_members ?? []).some((m) => m.org_id === orgId && m.user_id === userId && ["owner", "staff", "member"].includes(String(m.role)));
}

const STAGE_ORDER: Record<string, number> = { Committed: 0, Offer: 1, Visit: 2, "In Contact": 3, Target: 4 };

export function fakeRpc(data: Dataset, userId: string | null, name: string, args: Record<string, unknown>): { data: unknown; error: { message: string } | null } {
  if (name === "member_program") {
    const orgId = String(args.p_org);
    if (!admitted(data, orgId, userId)) return { data: [], error: null };
    const targets = (data.recruiting_targets ?? []).filter((t) => t.org_id === orgId);
    const schools = new Map((data.schools ?? []).map((s) => [s.id, s]));
    const rows = (data.athletes ?? [])
      .filter((a) => a.org_id === orgId && !a.deleted_at)
      .map((a) => {
        const mine = targets.filter((t) => t.athlete_id === a.id);
        const transferring = a.status === "Transferring";
        const committed = transferring ? undefined : mine.find((t) => t.status === "Committed");
        const offers = mine.filter((t) => t.status === "Offer").length;
        const closed = ["Drafted", "Graduated", "Enrolled"].includes(String(a.status));
        const stage = closed ? String(a.status) : a.status === "Committed" || committed ? "Committed" : offers ? "Offers" : mine.some((t) => t.status !== "Not Interested") ? "Targeting" : "No Targets";
        const detail = (a.detail ?? {}) as Row;
        const drafted = a.status === "Drafted";
        const currentSchool =
          (a.status === "Enrolled" || a.status === "Graduated") && detail.kind === "transfer" && typeof detail.currentSchool === "string" && detail.currentSchool.trim() ? detail.currentSchool.trim() : null;
        const team = typeof a.draft_team === "string" && a.draft_team.trim() ? a.draft_team.trim() : null;
        return {
          athlete_id: a.id,
          name: a.name,
          sport: a.sport,
          position: a.position ?? null,
          grad_year: typeof detail.gradYear === "number" ? detail.gradYear : null,
          recruit_type: a.recruit_type,
          stage,
          offers,
          committed_school: drafted ? team : ((committed ? ((schools.get(committed.school_id) as Row | undefined)?.name as string | undefined) : undefined) ?? currentSchool),
          draft_round: drafted ? (a.draft_round ?? null) : null,
          draft_year: drafted ? (a.draft_year ?? null) : null,
        };
      })
      .sort((x, y) => String(x.name).localeCompare(String(y.name)));
    return { data: rows, error: null };
  }

  if (name === "member_program_schools") {
    const orgId = String(args.p_org);
    const athleteId = String(args.p_athlete);
    if (!admitted(data, orgId, userId)) return { data: [], error: null };
    const athlete = (data.athletes ?? []).find((a) => a.id === athleteId && a.org_id === orgId && !a.deleted_at);
    if (!athlete) return { data: [], error: null };
    const schools = new Map((data.schools ?? []).map((s) => [s.id, s]));
    const rows = (data.recruiting_targets ?? [])
      .filter((t) => t.org_id === orgId && t.athlete_id === athleteId)
      .map((t) => {
        const s = (schools.get(t.school_id) ?? {}) as Row;
        return { target_id: t.id, school_name: s.name ?? "", division: s.division ?? "", status: t.status };
      })
      .sort((x, y) => (STAGE_ORDER[String(x.status)] ?? 5) - (STAGE_ORDER[String(y.status)] ?? 5) || String(x.school_name).localeCompare(String(y.school_name)));
    return { data: rows, error: null };
  }

  if (name === "member_giving") {
    const orgId = String(args.p_org);
    if (!admitted(data, orgId, userId)) return { data: null, error: null };
    const seats = (data.board_members ?? []).filter((m) => m.org_id === orgId);
    const mySeat = seats.filter((m) => m.user_id === userId).sort((a, b) => (a.status === "active" ? -1 : 0) - (b.status === "active" ? -1 : 0))[0] ?? null;
    const myDonor = (mySeat?.donor_id as string | null | undefined) ?? null;
    const donors = new Map((data.donors ?? []).map((d) => [d.id, d]));
    const credited = (g: Row) => !!mySeat && (g.solicited_by === mySeat.id || (myDonor !== null && g.donor_id === myDonor));
    const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
    return {
      data: {
        my_seat_id: mySeat?.id ?? null,
        gifts: (data.gifts ?? [])
          .filter((g) => g.org_id === orgId)
          .map((g) => ({ ...pick(g, ["id", "amount", "received_on", "category", "method", "donor_id", "campaign_id", "pledge_id", "solicited_by"]), donor_name: credited(g) ? ((donors.get(g.donor_id) as Row | undefined)?.name ?? null) : null })),
        pledges: (data.pledges ?? []).filter((p) => p.org_id === orgId).map((p) => pick(p, ["id", "amount", "promised_on", "due_on", "status", "donor_id", "campaign_id", "solicited_by"])),
        campaigns: (data.campaigns ?? []).filter((c) => c.org_id === orgId).map((c) => pick(c, ["id", "name", "kind", "goal_amount", "ends_on"])),
        budget: (data.fundraising_budget ?? []).filter((b) => b.org_id === orgId).map((b) => pick(b, ["fiscal_year", "category", "amount"])),
        boards: (data.boards ?? []).filter((b) => b.org_id === orgId).map((b) => pick(b, ["id", "name", "kind", "sport", "give_get_amount", "min_seats", "max_seats"])),
        seats: seats.map((m) => ({
          ...pick(m, ["id", "board_id", "donor_id", "status", "term_start", "term_end", "commitment_amount"]),
          name: mySeat && m.id === mySeat.id ? m.name : null,
          role_title: mySeat && m.id === mySeat.id ? (m.role_title ?? null) : null,
        })),
      },
      error: null,
    };
  }

  return { data: null, error: { message: `fakeSupabase does not implement rpc: ${name}` } };
}


// The bucket's own limits (migrations 0017 and 0029), which the function
// reads off storage.buckets.
const BUCKET_MAX_BYTES = 10_485_760;
const BUCKET_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];

// What each kind's log line says, the literals in
// private.log_assignment_submitted (migration 0046).
const SUBMITTED_LINE: Record<string, string> = {
  upload: "Submitted the upload assignment",
  complete_info: "Submitted the information assignment",
  confirm: "Submitted the confirmation assignment",
};

// public.submit_assignment(...), migration 0046, with the same refusals
// and the same Postgres error codes: 42501 (insufficient_privilege) for
// signed out, or not linked to that assignment; 23514 (check_violation)
// for a row not open, a bad file or a note over the limit. On success the
// document row, the assignment update and the log line are written and
// recorded with via: "rpc:submit_assignment", so a law can tell them from
// a query the caller made.
export function fakeSubmitAssignment(
  data: Dataset,
  userId: string | null,
  args: Record<string, unknown>,
  recorded: RecordedWrite[],
  failOn: (table: string, op: string) => string | null,
): { data: string | null; error: { message: string; code: string } | null } {
  const refuse = (code: string, message: string) => ({ data: null, error: { code, message: `submit_assignment: ${message}` } });
  if (!userId) return refuse("42501", "sign in first");

  const id = typeof args.p_assignment === "string" ? args.p_assignment : null;
  const assignments = data.assignments ?? [];
  const a = id ? assignments.find((x) => x.id === id) : undefined;
  const athlete = a ? (data.athletes ?? []).find((t) => t.id === a.athlete_id) : undefined;
  const linked =
    !!a &&
    !!athlete &&
    (data.athlete_guardians ?? []).some((g) => g.athlete_id === a.athlete_id && g.user_id === userId && g.org_id === a.org_id) &&
    (data.org_members ?? []).some((m) => m.user_id === userId && m.org_id === a.org_id && m.role === "family");
  if (!a || !athlete || !linked || athlete.deleted_at) return refuse("42501", "not linked to that assignment");

  if (a.status !== "assigned" && a.status !== "needs_revision") return refuse("23514", "this assignment is not open for submission");
  const note = typeof args.p_note === "string" ? args.p_note : "";
  if (note.length > 4000) return refuse("23514", "a note is 4,000 characters or fewer");
  const cleanNote = note.trim() || null;

  const path = typeof args.p_storage_path === "string" ? args.p_storage_path : null;
  if (a.kind === "upload" && path === null && !a.document_id) return refuse("23514", "an upload assignment needs a file");
  const forced = failOn("assignments", "update");
  let docId: string | null = null;
  const documents = data.documents ?? (data.documents = []);

  if (path !== null) {
    const shape = new RegExp(`^${String(a.org_id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/family/[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$`);
    if (!shape.test(path) || /\/\.\.?$/.test(path)) return refuse("23514", "a file must be under this organization's family folder");
    const owned = (data.storage_objects ?? []).some((o) => o.bucket === "documents" && o.name === path && o.owner === userId);
    if (!owned) return refuse("23514", "that file was not uploaded by you");
    if (documents.some((d) => Array.isArray(d.storage_paths) && (d.storage_paths as unknown[]).includes(path))) return refuse("23514", "that file is already filed");
    const fileName = typeof args.p_file_name === "string" ? args.p_file_name.trim() : "";
    const size = typeof args.p_file_size === "number" ? args.p_file_size : 0;
    const mediaType = typeof args.p_media_type === "string" ? args.p_media_type.trim() : "";
    if (!fileName || fileName.length > 200 || size <= 0 || !mediaType) return refuse("23514", "a file needs a name, a size and a type");
    if (size > BUCKET_MAX_BYTES) return refuse("23514", "that file is over the size limit");
    if (!BUCKET_TYPES.includes(mediaType)) return refuse("23514", "that file type is not accepted");
    const hash = typeof args.p_content_hash === "string" && args.p_content_hash.trim() ? args.p_content_hash.trim() : null;
    if (forced) return { data: null, error: { code: "XX000", message: forced } };
    docId = `fake-documents-${documents.length + 1}`;
    const documentRow: Row = {
      id: docId,
      org_id: a.org_id,
      athlete_id: a.athlete_id,
      file_name: fileName,
      file_size: size,
      media_type: mediaType,
      source_role: "parent",
      status: "filed",
      storage_paths: [path],
      content_hash: hash,
      read_by: null,
      created_at: new Date().toISOString(),
    };
    documents.push(documentRow);
    recorded.push({ op: "insert", table: "documents", rows: [documentRow], filters: [], via: "rpc:submit_assignment" });
  } else if (forced) {
    return { data: null, error: { code: "XX000", message: forced } };
  }

  const patch: Row = { status: "submitted", family_note: cleanNote, submitted_at: new Date().toISOString(), document_id: docId ?? a.document_id ?? null, updated_at: new Date().toISOString() };
  Object.assign(a, patch);
  recorded.push({ op: "update", table: "assignments", rows: [patch], filters: [{ column: "id", value: a.id }], via: "rpc:submit_assignment" });

  const log = data.activity_log ?? (data.activity_log = []);
  const line: Row = {
    id: `fake-activity_log-${log.length + 1}`,
    org_id: a.org_id,
    athlete_id: a.athlete_id,
    actor_id: userId,
    action: "assignment_submitted",
    subject_type: "assignment",
    subject_id: a.id,
    summary: SUBMITTED_LINE[String(a.kind)] ?? "Submitted the general assignment",
    created_at: new Date().toISOString(),
  };
  log.push(line);
  recorded.push({ op: "insert", table: "activity_log", rows: [line], filters: [], via: "rpc:submit_assignment" });
  return { data: String(a.id), error: null };
}


// ── View As (migration 0047) ─────────────────────────────────────────

// A session is live for this long, and no longer.
export const VIEW_AS_MINUTES = 30;

// Whether a session row still applies: not ended and not past its time.
// (The database also requires the viewer to still be an owner of the org
// and the target still a member of it; the fake checks that too.)
export function viewAsIsLive(data: Dataset, s: Row, now = Date.now()): boolean {
  if (s.ended_at) return false;
  if (new Date(String(s.expires_at)).getTime() <= now) return false;
  const members = data.org_members ?? [];
  return (
    members.some((m) => m.user_id === s.viewer_id && m.org_id === s.org_id && m.role === "owner") &&
    members.some((m) => m.user_id === s.target_id && m.org_id === s.org_id)
  );
}

// The live session of a caller, if any: what private._view_target() reads.
export function liveViewAsSession(data: Dataset, viewerId: string | null): Row | null {
  if (!viewerId) return null;
  return (data.view_as_sessions ?? []).find((s) => s.viewer_id === viewerId && viewAsIsLive(data, s)) ?? null;
}

// Puts a live session for (viewer, target) into the dataset when there is
// none, in the one org the viewer owns that the target belongs to (the
// first, in fixture order, when there are two), and returns it. This is
// how a harness renders "the owner, viewing as the family login" without
// calling start_view_as first. Throws when the two share no org the
// viewer owns: a session the database would refuse to record.
export function ensureViewAsSession(data: Dataset, viewerId: string, targetId: string): Row {
  const existing = liveViewAsSession(data, viewerId);
  if (existing) {
    if (existing.target_id !== targetId) throw new Error(`fakeSupabase: ${viewerId} is already viewing ${String(existing.target_id)}, not ${targetId}`);
    return existing;
  }
  const members = data.org_members ?? [];
  const org = members.find((m) => m.user_id === viewerId && m.role === "owner" && members.some((t) => t.user_id === targetId && t.org_id === m.org_id))?.org_id;
  if (!org) throw new Error(`fakeSupabase: ${viewerId} owns no org that ${targetId} belongs to, so the database would refuse this View As`);
  const sessions = data.view_as_sessions ?? (data.view_as_sessions = []);
  const now = Date.now();
  const row: Row = {
    id: `fake-view_as_sessions-${sessions.length + 1}`,
    org_id: org,
    viewer_id: viewerId,
    target_id: targetId,
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + VIEW_AS_MINUTES * 60_000).toISOString(),
    ended_at: null,
    end_reason: null,
  };
  sessions.push(row);
  return row;
}

type ViewAsResult<T> = { data: T | null; error: { message: string; code: string } | null };

function logViewAs(data: Dataset, recorded: RecordedWrite[], via: string, s: Row, action: "view_as_started" | "view_as_ended", summary: string): void {
  const log = data.activity_log ?? (data.activity_log = []);
  const line: Row = {
    id: `fake-activity_log-${log.length + 1}`,
    org_id: s.org_id,
    athlete_id: null,
    actor_id: s.viewer_id,
    action,
    subject_type: "view_as",
    subject_id: s.id,
    summary,
    created_at: new Date().toISOString(),
  };
  log.push(line);
  recorded.push({ op: "insert", table: "activity_log", rows: [line], filters: [], via });
}

// private._close_view_as(session, expired): the update and its line.
function closeViewAs(data: Dataset, recorded: RecordedWrite[], via: string, s: Row, expired: boolean): void {
  if (s.ended_at) return;
  const patch: Row = { ended_at: new Date().toISOString(), end_reason: expired ? "expired" : "returned" };
  Object.assign(s, patch);
  recorded.push({ op: "update", table: "view_as_sessions", rows: [patch], filters: [{ column: "id", value: s.id }], via });
  logViewAs(data, recorded, via, s, "view_as_ended", expired ? "Viewing as someone else ended after 30 minutes" : "Stopped viewing as someone else");
}

// public.start_view_as(...), both forms. See the header for the rules.
export function fakeStartViewAs(
  data: Dataset,
  userId: string | null,
  args: Record<string, unknown>,
  recorded: RecordedWrite[],
  failOn: (table: string, op: string) => string | null,
): ViewAsResult<string> {
  const refuse = (code: string, message: string) => ({ data: null, error: { code, message: `start_view_as: ${message}` } });
  if (!userId) return refuse("42501", "sign in first");
  const via = "rpc:start_view_as";
  const sessions = data.view_as_sessions ?? (data.view_as_sessions = []);
  const members = data.org_members ?? [];
  const target = typeof args.p_target === "string" ? args.p_target : null;
  const notOwner = () => refuse("42501", "only an owner of the organization can view as someone in it");

  // Lazy expiry, before anything else is decided.
  for (const s of sessions) {
    if (s.viewer_id === userId && !s.ended_at && new Date(String(s.expires_at)).getTime() <= Date.now()) closeViewAs(data, recorded, via, s, true);
  }

  let org: string | null;
  if ("p_org" in args) {
    org = typeof args.p_org === "string" ? args.p_org : null;
    if (!org || !members.some((m) => m.user_id === userId && m.org_id === org && m.role === "owner")) return notOwner();
  } else {
    const shared = [...new Set(members.filter((o) => o.user_id === userId && o.role === "owner" && members.some((t) => t.user_id === target && t.org_id === o.org_id)).map((o) => String(o.org_id)))];
    if (shared.length === 0) return notOwner();
    if (shared.length > 1) return refuse("23514", "you share more than one organization with that person; name the organization");
    org = shared[0];
  }
  if (!target || target === userId) return refuse("23514", "choose someone other than yourself");
  if (sessions.some((s) => s.viewer_id === userId && !s.ended_at)) return refuse("55000", "you are already viewing as someone; return first");
  const targetRole = members.find((m) => m.org_id === org && m.user_id === target)?.role;
  if (!targetRole) return refuse("42501", "that person is not in this organization");

  const forced = failOn("view_as_sessions", "insert");
  if (forced) return { data: null, error: { code: "XX000", message: forced } };
  const now = Date.now();
  const row: Row = {
    id: `fake-view_as_sessions-${sessions.length + 1}`,
    org_id: org,
    viewer_id: userId,
    target_id: target,
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + VIEW_AS_MINUTES * 60_000).toISOString(),
    ended_at: null,
    end_reason: null,
  };
  sessions.push(row);
  recorded.push({ op: "insert", table: "view_as_sessions", rows: [row], filters: [], via });
  const summary = targetRole === "member" ? "Started viewing as a Viewer" : targetRole === "family" ? "Started viewing as an Athlete" : "Started viewing as an Admin";
  logViewAs(data, recorded, via, row, "view_as_started", summary);
  return { data: String(row.id), error: null };
}

// public.end_view_as(). Nothing open is not an error and writes nothing.
export function fakeEndViewAs(
  data: Dataset,
  userId: string | null,
  recorded: RecordedWrite[],
  failOn: (table: string, op: string) => string | null,
): ViewAsResult<null> {
  if (!userId) return { data: null, error: { code: "42501", message: "end_view_as: sign in first" } };
  const open = (data.view_as_sessions ?? []).find((s) => s.viewer_id === userId && !s.ended_at);
  if (!open) return { data: null, error: null };
  const forced = failOn("view_as_sessions", "update");
  if (forced) return { data: null, error: { code: "XX000", message: forced } };
  closeViewAs(data, recorded, "rpc:end_view_as", open, new Date(String(open.expires_at)).getTime() <= Date.now());
  return { data: null, error: null };
}
