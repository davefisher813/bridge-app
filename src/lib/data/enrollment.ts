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
// moment they enroll: closed to Not Interested with a note saying why,
// so Today's Needs Follow-Up and the Targets board never keep showing a
// coach work on someone who has already left. The Committed target, if
// there is one, is the one fact that stays true and is left alone.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export interface EnrollmentResult {
  schoolName: string | null;
  closedCount: number;
}

export async function applyEnrollment(supabase: Client, orgId: string, athleteId: string, enrolledOn: string): Promise<EnrollmentResult> {
  const { data: athleteRow } = await supabase.from("athletes").select("name, first_full_time_enrollment").eq("id", athleteId).eq("org_id", orgId).maybeSingle();
  const athlete = athleteRow as { name: string; first_full_time_enrollment: string | null } | null;
  const athleteName = athlete?.name ?? "The athlete";
  const firstEnrollment = athlete?.first_full_time_enrollment ?? null;

  const { data: committedRow } = await supabase
    .from("recruiting_targets")
    .select("school_id, schools(name)")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .eq("status", "Committed")
    .maybeSingle();
  const committed = committedRow as { schools: { name: string } | { name: string }[] | null } | null;
  const schoolName = committed ? (unwrap(committed.schools)?.name ?? null) : null;

  const { data: openRows } = await supabase
    .from("recruiting_targets")
    .select("id, notes")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .neq("status", "Committed")
    .neq("status", "Not Interested");

  const note = schoolName
    ? `Closed automatically: ${athleteName} enrolled at ${schoolName} on ${longDate(enrolledOn)}.`
    : `Closed automatically: ${athleteName} was marked Enrolled on ${longDate(enrolledOn)}.`;

  const open = (openRows ?? []) as { id: string; notes: string | null }[];
  for (const t of open) {
    await supabase
      .from("recruiting_targets")
      .update({ status: "Not Interested", notes: t.notes ? `${t.notes}\n\n${note}` : note, updated_at: new Date().toISOString() })
      .eq("id", t.id)
      .eq("org_id", orgId);
  }

  const patch: Record<string, unknown> = { status: "Enrolled", updated_at: new Date().toISOString() };
  if (!firstEnrollment) patch.first_full_time_enrollment = enrolledOn;
  await supabase.from("athletes").update(patch).eq("id", athleteId).eq("org_id", orgId);

  return { schoolName, closedCount: open.length };
}

export function enrollmentNotice(schoolName: string | null, closedCount: number): string {
  const closedPart = closedCount > 0 ? ` ${closedCount} other ${closedCount === 1 ? "target" : "targets"} closed.` : "";
  return schoolName ? `Enrolled at ${schoolName}.${closedPart}` : `Enrolled.${closedPart}`;
}
