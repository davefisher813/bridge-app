// Reopen Recruiting: the reverse of the close-out in enrollment.ts.
//
// Dave, 2026-09-26: a kid who committed and then backed out, or who
// enrolled and is now in the portal, is being recruited again, and the
// schools that were closed for them should come back as they were.
//
// What comes back is exactly what the close-out took away: every target
// closed to Not Interested with a closed_from returns to that status (or
// In Contact when a row from before closed_from existed carries none).
// A hand-picked Not Interested has no closed_from and stays closed.
//
// The Committed target is the one thing that does not come back as it
// was. Leaving college makes it history, closed with a note, so neither
// placementOf() nor member_program() can read the athlete as placed
// again; withdrawing a commitment turns it back into the Offer or
// contact it was before the commitment.
//
// A college athlete reopening is a transfer from here on: their record
// becomes a transfer record (src/lib/fit/schema.ts needs the current
// school, eligibility years and transfer count), which replaces the high
// school detail. The NCAA clock (first_full_time_enrollment,
// graduated_on) is left alone.

import type { SupabaseClient } from "@supabase/supabase-js";
import { longDate } from "@/lib/copy/dates";
import { parseAthleteDetail } from "@/lib/fit/schema";
import { canReopen, currentSchoolOf, reopenedStatus } from "@/lib/placement";
import { recomputeFitsForAthlete } from "@/lib/data/fits";
import { restoreClosedTargets } from "@/lib/data/enrollment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export type TransferKind = "transfer_4to4" | "transfer_juco" | "transfer_grad";

// What the reopen screen asks for. Only read when the athlete leaves
// Enrolled or Graduated; a withdrawn commitment needs nothing.
export interface ReopenInput {
  transferKind?: TransferKind;
  currentSchool?: string;
  // The schools row the school they are leaving matched exactly, when
  // it did (Stage 4). Kept on the transfer detail.
  currentSchoolId?: string;
  currentDivision?: string;
  eligibilityYearsRemaining?: number;
  transferCount?: number;
  portalEntryDate?: string;
}

export interface ReopenResult {
  restoredCount: number;
  closedCommitted: boolean;
  status: "Active" | "Transferring";
}

interface AthleteRow {
  id: string;
  name: string;
  status: string;
  recruit_type: string;
  detail: unknown;
  graduated_on: string | null;
}

interface CommittedRow {
  id: string;
  offer_type: string | null;
  notes: string | null;
  school_id: string | null;
  schools: { name: string; division: string | null } | { name: string; division: string | null }[] | null;
}

function appended(notes: string | null, line: string): string {
  return notes ? `${notes}\n\n${line}` : line;
}

// Null when the athlete is missing or cannot reopen; the action decides
// where to send the person in that case.
export async function applyReopen(supabase: Client, orgId: string, athleteId: string, input: ReopenInput = {}): Promise<ReopenResult | null> {
  const { data: athleteRow } = await supabase.from("athletes").select("id, name, status, recruit_type, detail, graduated_on").eq("id", athleteId).eq("org_id", orgId).maybeSingle();
  const athlete = athleteRow as AthleteRow | null;
  if (!athlete || !canReopen(athlete.status)) return null;

  const now = new Date();
  const stamp = now.toISOString();
  const date = longDate(stamp.slice(0, 10));
  const next = reopenedStatus(athlete.status);

  const restoredCount = await restoreClosedTargets(supabase, orgId, athleteId, `Reopened: ${athlete.name} is recruiting again as of ${date}.`);

  const { data: committedRow } = await supabase
    .from("recruiting_targets")
    .select("id, offer_type, notes, school_id, schools(name, division)")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .eq("status", "Committed")
    .maybeSingle();
  const committed = committedRow as CommittedRow | null;
  const committedSchool = committed ? unwrap(committed.schools) : null;

  let closedCommitted = false;
  if (committed) {
    const patch =
      next === "Active"
        ? { status: committed.offer_type ? "Offer" : "In Contact", closed_from: null, notes: appended(committed.notes, `Reopened: commitment withdrawn on ${date}.`), updated_at: stamp }
        : {
            status: "Not Interested",
            closed_from: null,
            notes: appended(committed.notes, `Reopened: ${athlete.name} is transferring from ${committedSchool?.name ?? "their school"} as of ${date}.`),
            updated_at: stamp,
          };
    closedCommitted = next === "Transferring";
    await supabase.from("recruiting_targets").update(patch).eq("id", committed.id).eq("org_id", orgId);
  }

  const patch: Record<string, unknown> = { status: next, updated_at: stamp };
  if (next === "Transferring") {
    const prior = (athlete.detail && typeof athlete.detail === "object" ? athlete.detail : {}) as Record<string, unknown>;
    const transferKind: TransferKind = input.transferKind ?? (athlete.status === "Graduated" ? "transfer_grad" : "transfer_4to4");
    const currentSchool = input.currentSchool?.trim() || committedSchool?.name || currentSchoolOf(athlete.detail) || "";
    const currentDivision = input.currentDivision?.trim() || committedSchool?.division || (typeof prior.currentDivision === "string" ? prior.currentDivision : undefined) || undefined;
    // Which school row that is, when known: the one the form matched,
    // else the committed target's school when it is the one named, else
    // the id already on the record when the name has not changed. A
    // rebuilt detail that dropped it would lose it on every reopen.
    const sameName = (a: string | null | undefined) => !!a && a.trim().toLowerCase() === currentSchool.trim().toLowerCase();
    const currentSchoolId =
      input.currentSchoolId ||
      (committed?.school_id && sameName(committedSchool?.name) ? committed.school_id : undefined) ||
      (typeof prior.currentSchoolId === "string" && sameName(typeof prior.currentSchool === "string" ? prior.currentSchool : null) ? prior.currentSchoolId : undefined);
    patch.recruit_type = transferKind;
    patch.detail = parseAthleteDetail({
      kind: "transfer",
      currentSchool,
      currentDivision,
      collegeGpa: typeof prior.collegeGpa === "number" ? prior.collegeGpa : undefined,
      creditHoursCompleted: typeof prior.creditHoursCompleted === "number" ? prior.creditHoursCompleted : undefined,
      eligibilityYearsRemaining: input.eligibilityYearsRemaining ?? 0,
      portalEntryDate: input.portalEntryDate || undefined,
      transferCount: input.transferCount ?? 1,
      degreeCompleted: athlete.status === "Graduated" || transferKind === "transfer_grad",
      desiredMajor: typeof prior.desiredMajor === "string" && prior.desiredMajor ? prior.desiredMajor : undefined,
      currentSchoolId: currentSchoolId || undefined,
    });
  }
  await supabase.from("athletes").update(patch).eq("id", athleteId).eq("org_id", orgId);

  await recomputeFitsForAthlete(supabase, orgId, athleteId, now);

  return { restoredCount, closedCommitted, status: next };
}

// "Recruiting reopened. 2 targets restored."
export function reopenNotice(result: ReopenResult): string {
  const restored = result.restoredCount === 0 ? "" : ` ${result.restoredCount} ${result.restoredCount === 1 ? "target" : "targets"} restored.`;
  return `Recruiting reopened.${restored}`;
}
