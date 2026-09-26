// Where an athlete is going, or already is: the one fact that ends
// recruiting, worked out the same way on every screen.
//
// Dave, 2026-09-26: "when they commit, it doesn't say the school they're
// committed to anywhere. And when they're enrolled, it doesn't say it
// anywhere either." Before this, the profile, the roster and the family
// page each read a different thing (athletes.status, a Committed target,
// nothing at all) and none of them read the Current School typed on the
// athlete's own record.
//
// The school comes from, in order: the athlete's Committed target (the
// board, where commitments are recorded), then, for an Enrolled athlete
// only, the Current School on their record (an athlete already in
// college before this org tracked them has no target, only that).

export type PlacementState = "Committed" | "Enrolled";

export interface Placement {
  state: PlacementState;
  school: string | null;
  targetId: string | null;
}

export interface PlacementTarget {
  id: string;
  status: string;
  schoolName: string | null;
}

export function placementOf(
  athlete: { status: string; currentSchool?: string | null },
  targets: PlacementTarget[],
): Placement | null {
  const committed = targets.find((t) => t.status === "Committed") ?? null;
  const current = athlete.currentSchool?.trim() || null;

  if (athlete.status === "Enrolled") {
    return {
      state: "Enrolled",
      school: committed?.schoolName ?? current,
      targetId: committed?.id ?? null,
    };
  }
  if (committed || athlete.status === "Committed") {
    return {
      state: "Committed",
      school: committed?.schoolName ?? null,
      targetId: committed?.id ?? null,
    };
  }
  return null;
}

// "Committed to X", "Enrolled at X", or the state alone when no school is
// on file, so a gap reads as a gap rather than as nothing.
export function placementLine(p: Placement): string {
  if (p.state === "Enrolled")
    return p.school
      ? `Enrolled at ${p.school}`
      : "Enrolled, school not on file";
  return p.school
    ? `Committed to ${p.school}`
    : "Committed, school not on file";
}

// Pulls Current School out of athletes.detail without a Zod parse, so a
// list screen can read it for every row cheaply. Only a transfer record
// carries one.
export function currentSchoolOf(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as { kind?: unknown; currentSchool?: unknown };
  return d.kind === "transfer" &&
    typeof d.currentSchool === "string" &&
    d.currentSchool.trim()
    ? d.currentSchool.trim()
    : null;
}
