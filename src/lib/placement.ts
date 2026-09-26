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

// Statuses that end recruiting for good: nothing left to score, nothing
// left open on the board.
export const CLOSED_STATUSES = ["Enrolled", "Graduated", "Drafted"] as const;

export function isClosedStatus(status: string): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
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
  if (committed || athlete.status === "Committed") {
    return { state: "Committed", name: committed?.schoolName ?? null, targetId: committed?.id ?? null };
  }
  return null;
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

// "Matches stopped scoring once Jose enrolled." for the Matches pages.
export function closedSentence(status: string, name: string): string {
  const verb = status === "Drafted" ? "was drafted" : status === "Graduated" ? "graduated" : "enrolled";
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
  return ["enroll", "draft"];
}

// The athlete columns placementAthlete() reads. Select lists are written
// out literally (src/laws/schemaLaws.test.ts), so each caller lists
// status, detail, draft_team, draft_round and draft_year itself.
export function placementAthlete(row: { status: string; detail?: unknown; draft_team?: string | null; draft_round?: number | null; draft_year?: number | null }): PlacementAthlete {
  return { status: row.status, currentSchool: currentSchoolOf(row.detail), draftTeam: row.draft_team ?? null, draftRound: row.draft_round ?? null, draftYear: row.draft_year ?? null };
}
