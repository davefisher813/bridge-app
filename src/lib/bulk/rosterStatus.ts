// Which status changes a bulk action may make on the roster, decided in
// one place (pure, no Next or Supabase).
//
// Committed, Enrolled, Graduated and Drafted each have a flow that takes
// facts a list cannot (the school and the day, the team, the Targets
// board's commitment, Reopen Recruiting's transfer facts). A bulk action
// never bypasses them, so only the two statuses with no such facts are
// offered: Active and Inactive. The rule per athlete mirrors
// updateAthlete (src/lib/actions/athletes.ts).

import { isPlacedStatus } from "@/lib/placement";

export const BULK_STATUSES = ["Active", "Inactive"] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];

export function isBulkStatus(v: unknown): v is BulkStatus {
  return (BULK_STATUSES as readonly string[]).includes(String(v));
}

export type SkipReason = "already" | "placed" | "committed_target" | "transferring";

export type StatusDecision = { change: true } | { change: false; reason: SkipReason };

export function bulkStatusDecision(from: string, to: BulkStatus, hasCommittedTarget: boolean): StatusDecision {
  if (from === to) return { change: false, reason: "already" };
  // Committed, Enrolled, Graduated, Drafted: their own flows, and the
  // way back is Reopen Recruiting.
  if (isPlacedStatus(from)) return { change: false, reason: "placed" };
  // A Committed target places an athlete whose own status still says
  // Active; the Targets board owns that.
  if (hasCommittedTarget) return { change: false, reason: "committed_target" };
  // Transferring is a different kind of recruit, not a lesser Active.
  if (from === "Transferring" && to === "Active") return { change: false, reason: "transferring" };
  return { change: true };
}

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  already: "already at that status",
  placed: "placed, so they use their own page",
  committed_target: "committed to a school, so the Targets board owns it",
  transferring: "transferring",
};
