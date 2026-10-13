// Which grants need someone today, and why. Pure, so a law can hold it
// without a database.
//
// The first version flagged any grant with any date on or before today,
// whatever its status, and then printed the decision date whether or not
// that was the date that had passed (so a declined grant read "Decision
// was expected null"). A date only matters while the grant is at the
// stage that date belongs to:
//
//   - Declined and Closed are finished. Nothing on them is due.
//   - Awarded only owes its report.
//   - Before a decision: the application deadline, while nothing has
//     been submitted, then the date a decision was expected.

export type GrantStatus = "researching" | "applied" | "pending" | "awarded" | "declined" | "closed";

export interface GrantDates {
  status: GrantStatus;
  deadline_on: string | null;
  applied_on: string | null;
  decision_expected_on: string | null;
  report_due_on: string | null;
}

export type GrantAttention = { kind: "report"; on: string } | { kind: "deadline"; on: string } | { kind: "decision"; on: string };

export function grantAttention(g: GrantDates, today: string): GrantAttention | null {
  const passed = (d: string | null): d is string => !!d && d <= today;
  if (g.status === "declined" || g.status === "closed") return null;
  if (g.status === "awarded") return passed(g.report_due_on) ? { kind: "report", on: g.report_due_on } : null;
  if (!g.applied_on && passed(g.deadline_on)) return { kind: "deadline", on: g.deadline_on };
  if (g.status !== "researching" && passed(g.decision_expected_on)) return { kind: "decision", on: g.decision_expected_on };
  return null;
}
