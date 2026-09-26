// The one place recruiting actually ends for an athlete.
//
// Dave, 2026-09-26, after trying to update an athlete's status and
// watching nothing else on the screen change: "their status should
// change and everything should shift based on that status... the
// schools that they're interested in, all that should no longer be
// relevant, it should be cleared out." athletes.status already had a
// "Committed" value with nothing reading it beyond a roster pill - this
// is what makes a status change actually do something.
//
// Whatever else was still open on this athlete - a school still In
// Contact, a visit still pending - stops being outstanding work the
// moment they enroll: closed to Not Interested with a note saying why
// and closed_from recording the status it had, so Reopen Recruiting
// (src/lib/data/reopen.ts) can put back exactly what this took away.
// Today's Needs Follow-Up and the Targets board never keep showing a
// coach work on someone who has already left. The Committed target, if
// there is one, is the one fact that stays true and is left alone.
//
// Every stored fit goes with the close-out: a placed athlete has no
// score anywhere (Dave, 2026-09-26).
//
// The NCAA age clock (src/lib/fit/ncaa/ageClock.ts) backfills from this
// date only if nothing has started it already: a transfer athlete's
// clock started at their ORIGINAL school, years earlier, and must never
// be overwritten by a later enrollment elsewhere.
//
// Called from both the dedicated Mark Enrolled screen and a plain Edit
// save that flips the status by hand, so neither path can silently do
// nothing the way athletes.status used to. See docs/DECISIONS.md,
// 2026-09-26.

import type { SupabaseClient } from "@supabase/supabase-js";
import { longDate } from "@/lib/copy/dates";
import { currentSchoolOf, placementLine } from "@/lib/placement";
import { clearFitsForAthlete } from "@/lib/data/fits";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export interface EnrollmentResult {
  schoolName: string | null;
  closedCount: number;
}

// How recruiting ended. Enrolled and Graduated are named by the school;
// Drafted by the team, round and year (Dave's pick, 2026-09-26).
export type CloseOut =
  | { status: "Enrolled"; on: string }
  | { status: "Graduated"; on: string }
  | { status: "Drafted"; team: string; round: number | null; year: number | null };

export interface CloseOutResult {
  // The school, or for Drafted the team.
  name: string | null;
  closedCount: number;
}

// Closes every open target with a note saying why, then sets the
// athlete's status and whatever that status records. The Committed
// target, if there is one, is history and is left alone, drafted or not.
export async function applyCloseOut(supabase: Client, orgId: string, athleteId: string, outcome: CloseOut): Promise<CloseOutResult> {
  const { data: athleteRow } = await supabase.from("athletes").select("name, first_full_time_enrollment, detail").eq("id", athleteId).eq("org_id", orgId).maybeSingle();
  const athlete = athleteRow as { name: string; first_full_time_enrollment: string | null; detail?: unknown } | null;
  const athleteName = athlete?.name ?? "The athlete";

  let name: string | null;
  if (outcome.status === "Drafted") {
    name = outcome.team;
  } else {
    const { data: committedRow } = await supabase.from("recruiting_targets").select("school_id, schools(name)").eq("org_id", orgId).eq("athlete_id", athleteId).eq("status", "Committed").maybeSingle();
    const committed = committedRow as { schools: { name: string } | { name: string }[] | null } | null;
    // The Committed target's school, else the Current School on the
    // athlete's own record (someone already in college with no target).
    name = (committed ? (unwrap(committed.schools)?.name ?? null) : null) ?? currentSchoolOf(athlete?.detail);
  }

  const closedCount = await closeOpenTargets(supabase, orgId, athleteId, closeOutNote(athleteName, name, outcome));

  const patch: Record<string, unknown> = { status: outcome.status, updated_at: new Date().toISOString() };
  // The NCAA clock only ever backfills, and only from a first enrollment.
  if (outcome.status === "Enrolled" && !athlete?.first_full_time_enrollment) patch.first_full_time_enrollment = outcome.on;
  if (outcome.status === "Graduated") patch.graduated_on = outcome.on;
  if (outcome.status === "Drafted") Object.assign(patch, { draft_team: outcome.team, draft_round: outcome.round, draft_year: outcome.year });
  await supabase.from("athletes").update(patch).eq("id", athleteId).eq("org_id", orgId);
  await clearFitsForAthlete(supabase, orgId, athleteId);

  return { name, closedCount };
}

// Every open target (not Committed, not already Not Interested) closes
// to Not Interested with the note and a closed_from, so a reopen can put
// it back exactly. One rule for a commitment, an enrollment, a
// graduation and a draft: Dave, 2026-09-26, "all statuses must change
// accordingly when something else impacts it."
export async function closeOpenTargets(supabase: Client, orgId: string, athleteId: string, note: string): Promise<number> {
  const { data: openRows } = await supabase.from("recruiting_targets").select("id, status, notes").eq("org_id", orgId).eq("athlete_id", athleteId).neq("status", "Committed").neq("status", "Not Interested");
  const open = (openRows ?? []) as { id: string; status: string; notes: string | null }[];
  for (const t of open) {
    await supabase
      .from("recruiting_targets")
      .update({ status: "Not Interested", closed_from: t.status, notes: t.notes ? `${t.notes}\n\n${note}` : note, updated_at: new Date().toISOString() })
      .eq("id", t.id)
      .eq("org_id", orgId);
  }
  return open.length;
}

// The reverse: every target a close-out took comes back as it was (In
// Contact when a row from before closed_from carries none). A
// hand-picked Not Interested has no closed_from and stays closed.
export async function restoreClosedTargets(supabase: Client, orgId: string, athleteId: string, note: string): Promise<number> {
  const { data: closedRows } = await supabase
    .from("recruiting_targets")
    .select("id, status, closed_from, notes")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .eq("status", "Not Interested")
    .not("closed_from", "is", null);
  const closed = (closedRows ?? []) as { id: string; closed_from: string | null; notes: string | null }[];
  for (const t of closed) {
    await supabase
      .from("recruiting_targets")
      .update({ status: t.closed_from ?? "In Contact", closed_from: null, notes: t.notes ? `${t.notes}\n\n${note}` : note, updated_at: new Date().toISOString() })
      .eq("id", t.id)
      .eq("org_id", orgId);
  }
  return closed.length;
}

function closeOutNote(athleteName: string, name: string | null, outcome: CloseOut): string {
  if (outcome.status === "Drafted") {
    const detail = [outcome.round ? `round ${outcome.round}` : null, outcome.year ? String(outcome.year) : null].filter(Boolean).join(", ");
    return `Closed automatically: ${athleteName} was drafted by ${name}${detail ? ` (${detail})` : ""}.`;
  }
  const verb = outcome.status === "Enrolled" ? "enrolled at" : "graduated from";
  return name
    ? `Closed automatically: ${athleteName} ${verb} ${name} on ${longDate(outcome.on)}.`
    : `Closed automatically: ${athleteName} was marked ${outcome.status} on ${longDate(outcome.on)}.`;
}

export async function applyEnrollment(supabase: Client, orgId: string, athleteId: string, enrolledOn: string): Promise<EnrollmentResult> {
  const { name, closedCount } = await applyCloseOut(supabase, orgId, athleteId, { status: "Enrolled", on: enrolledOn });
  return { schoolName: name, closedCount };
}

// "Enrolled at X. 2 other targets closed." and the same for the others.
export function closeOutNotice(p: { state: "Enrolled" | "Graduated" | "Drafted"; name: string | null; draftRound?: number | null; draftYear?: number | null }, closedCount: number): string {
  const closedPart = closedCount > 0 ? ` ${closedCount} other ${closedCount === 1 ? "target" : "targets"} closed.` : "";
  const line = p.name ? placementLine({ ...p, targetId: null }) : p.state;
  return `${line}.${closedPart}`;
}

export function enrollmentNotice(schoolName: string | null, closedCount: number): string {
  return closeOutNotice({ state: "Enrolled", name: schoolName }, closedCount);
}
