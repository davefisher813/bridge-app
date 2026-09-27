import { longDate } from "@/lib/copy/dates";

// Where an athlete is going, is, or ended up: the one fact that ends
// recruiting, worked out the same way on every screen.
//
// Dave, 2026-09-26: "when they commit, it doesn't say the school they're
// committed to anywhere. And when they're enrolled, it doesn't say it
// anywhere either." Then: "I should be able to say graduated or
// drafted." Every screen that shows one of these reads it from here.
//
// The school comes from, in order: the athlete's Committed target (the
// board, where commitments are recorded), then, once they are Enrolled
// or Graduated, the Current School on their record (an athlete already
// in college before this org tracked them has no target, only that). A
// Drafted athlete is placed with a team, not a school.
//
// The member Program screen cannot call this (a member reads no athlete
// rows); member_program() in migration 0035 is the same rule in SQL.

export type PlacementState = "Committed" | "Enrolled" | "Graduated" | "Drafted";

// Statuses that end recruiting for good: nothing left open on the board.
// Committed is not one of them; Mark Enrolled is still ahead of it.
export const CLOSED_STATUSES = ["Enrolled", "Graduated", "Drafted"] as const;

export function isClosedStatus(status: string): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}

// Placed: the athlete has somewhere to be. Recruiting is done for them
// and nothing scores. Dave, 2026-09-26: no score anywhere for a placed
// athlete.
export const PLACED_STATUSES = ["Committed", "Enrolled", "Graduated", "Drafted"] as const;

export function isPlacedStatus(status: string): boolean {
  return (PLACED_STATUSES as readonly string[]).includes(status);
}

// Scored: the athlete is actively recruiting. Only these two ever carry
// a stored fit (src/lib/data/fits.ts). Inactive is neither placed nor
// scored: nothing is being looked for, so nothing is measured.
export const SCORED_STATUSES = ["Active", "Transferring"] as const;

export function isScoredStatus(status: string): boolean {
  return (SCORED_STATUSES as readonly string[]).includes(status);
}

// Which placed athletes can reopen recruiting. Drafted is final.
export function canReopen(status: string): boolean {
  return status === "Committed" || status === "Enrolled" || status === "Graduated";
}

// Where reopening lands: a withdrawn commitment goes back to Active; a
// college athlete leaving a school is recruited again as a transfer.
export function reopenedStatus(status: string): "Active" | "Transferring" {
  return status === "Committed" ? "Active" : "Transferring";
}

export interface Placement {
  state: PlacementState;
  // The school, or for Drafted the team.
  name: string | null;
  targetId: string | null;
  draftRound?: number | null;
  draftYear?: number | null;
}

export interface PlacementTarget {
  id: string;
  status: string;
  schoolName: string | null;
}

export interface PlacementAthlete {
  status: string;
  currentSchool?: string | null;
  draftTeam?: string | null;
  draftRound?: number | null;
  draftYear?: number | null;
}

export function placementOf(athlete: PlacementAthlete, targets: PlacementTarget[]): Placement | null {
  const committed = targets.find((t) => t.status === "Committed") ?? null;
  const current = athlete.currentSchool?.trim() || null;

  if (athlete.status === "Drafted") {
    return { state: "Drafted", name: athlete.draftTeam?.trim() || null, targetId: null, draftRound: athlete.draftRound ?? null, draftYear: athlete.draftYear ?? null };
  }
  if (athlete.status === "Enrolled" || athlete.status === "Graduated") {
    return { state: athlete.status, name: committed?.schoolName ?? current, targetId: committed?.id ?? null };
  }
  // A leftover Committed target must never read a reopened athlete as
  // placed again.
  if (athlete.status === "Transferring") return null;
  if (committed || athlete.status === "Committed") {
    return { state: "Committed", name: committed?.schoolName ?? null, targetId: committed?.id ?? null };
  }
  return null;
}

// The status a screen filters and counts by: the placement when there is
// one (a Committed target places an athlete whose own status still says
// Active), else the athlete's own status. Today's tiles and the roster's
// status filter both read this, so they can never disagree.
export function effectiveStatus(athlete: PlacementAthlete, targets: PlacementTarget[]): string {
  return placementOf(athlete, targets)?.state ?? athlete.status;
}

// "Round 5, 2026", either half alone, or null.
export function draftDetail(p: Pick<Placement, "draftRound" | "draftYear">): string | null {
  const parts = [p.draftRound ? `Round ${p.draftRound}` : null, p.draftYear ? String(p.draftYear) : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// "Committed to X", "Enrolled at X", "Graduated from X", "Drafted by X,
// Round 5, 2026", or the state alone when nothing is on file, so a gap
// reads as a gap rather than as nothing.
export function placementLine(p: Placement): string {
  if (p.state === "Drafted") {
    const detail = draftDetail(p);
    return p.name ? `Drafted by ${p.name}${detail ? `, ${detail}` : ""}` : "Drafted, team not on file";
  }
  const word = { Committed: "Committed to", Enrolled: "Enrolled at", Graduated: "Graduated from" }[p.state];
  return p.name ? `${word} ${p.name}` : `${p.state}, school not on file`;
}

// Pulls Current School out of athletes.detail without a Zod parse, so a
// list screen can read it for every row cheaply. Only a transfer record
// carries one.
export function currentSchoolOf(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as { kind?: unknown; currentSchool?: unknown };
  return d.kind === "transfer" && typeof d.currentSchool === "string" && d.currentSchool.trim() ? d.currentSchool.trim() : null;
}

// "Recruiting ended: Committed to X." where a score would otherwise sit,
// on the board and school rows.
export function placedSentence(state: string, name: string | null, draft?: Pick<Placement, "draftRound" | "draftYear">): string {
  const known = (PLACED_STATUSES as readonly string[]).includes(state);
  const line = known ? placementLine({ state: state as PlacementState, name, targetId: null, draftRound: draft?.draftRound ?? null, draftYear: draft?.draftYear ?? null }) : state;
  return `Recruiting ended: ${line}.`;
}

// "Matches stopped scoring once Jose enrolled." for the Matches pages,
// and "while Jose is inactive." for an athlete who is simply not
// recruiting.
export function closedSentence(status: string, name: string): string {
  if (status === "Inactive") return `Matches stopped scoring while ${name} is inactive.`;
  const verb = status === "Drafted" ? "was drafted" : status === "Graduated" ? "graduated" : status === "Committed" ? "committed" : "enrolled";
  return `Matches stopped scoring once ${name} ${verb}.`;
}

// The line under the name on the profile row: when, or which round.
export function placementMeta(p: Placement, dates: { firstEnrollment?: string | null; graduatedOn?: string | null }): string | undefined {
  if (p.state === "Enrolled" && dates.firstEnrollment) return `Since ${longDate(dates.firstEnrollment)}`;
  if (p.state === "Graduated" && dates.graduatedOn) return `Graduated ${longDate(dates.graduatedOn)}`;
  if (p.state === "Drafted") return draftDetail(p) ?? undefined;
  return undefined;
}

// Which close-outs an athlete can still be marked with, in order. Drafted
// can follow any of the others (out of high school, out of college, or
// after graduating); Graduated only follows Enrolled, since it is
// graduating from the college they enrolled at.
export type Outcome = "enroll" | "graduate" | "draft";

export function nextOutcomes(status: string): Outcome[] {
  if (status === "Drafted") return [];
  if (status === "Graduated") return ["draft"];
  if (status === "Enrolled") return ["graduate", "draft"];
  // An alumnus who was never marked Enrolled (an Inactive athlete who
  // went on to college) can still be marked Graduated, naming the
  // school (Dave, 2026-09-27: "They should not have to be left as
  // inactive").
  return ["enroll", "graduate", "draft"];
}

// The athlete columns placementAthlete() reads. Select lists are written
// out literally (src/laws/schemaLaws.test.ts), so each caller lists
// status, detail, draft_team, draft_round and draft_year itself.
export function placementAthlete(row: { status: string; detail?: unknown; draft_team?: string | null; draft_round?: number | null; draft_year?: number | null }): PlacementAthlete {
  return { status: row.status, currentSchool: currentSchoolOf(row.detail), draftTeam: row.draft_team ?? null, draftRound: row.draft_round ?? null, draftYear: row.draft_year ?? null };
}
