// What a bulk action on the Targets board may do to one target. Pure, so
// the rule is one place and the laws can run it without a database.
//
// Bulk Change Status offers only the stages that need no facts of their
// own. Offer needs an offer type and a scholarship percent, and Committed
// closes out recruiting (syncCommitment: every other open target closes,
// the athlete becomes Committed, stored fits clear), so neither is set in
// bulk; both stay on the single target screen. For the same reason a
// target already on Offer or Committed is not moved here: an offer keeps
// its type and percent on the row, and a commitment is where an athlete
// was placed (Reopen Recruiting owns undoing it).

import { isScoredStatus } from "@/lib/placement";

export const BULK_STATUSES = ["Target", "In Contact", "Visit", "Not Interested"] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];

export function isBulkStatus(v: string): v is BulkStatus {
  return (BULK_STATUSES as readonly string[]).includes(v);
}

export interface BulkTargetFacts {
  status: string;
  athleteStatus: string;
}

// Null when the move is allowed, else the reason it is skipped.
export function statusSkipReason(t: BulkTargetFacts, to: BulkStatus): string | null {
  if (!isScoredStatus(t.athleteStatus)) return "The athlete is placed or inactive.";
  if (t.status === "Committed") return "A commitment is changed on its own screen.";
  if (t.status === "Offer") return "An offer is changed on its own screen.";
  if (t.status === to) return "Already there.";
  return null;
}

// Removing: a Committed target runs the commitment chain (the athlete
// reopens, or for a placed athlete is refused), so it is removed one at
// a time from its own screen.
export function removeSkipReason(t: BulkTargetFacts): string | null {
  if (t.status === "Committed") return "A commitment is removed on its own screen.";
  return null;
}

// "3 updated, 1 skipped." / "3 removed." / "None updated, 2 skipped."
export function bulkNotice(verb: string, done: number, skipped: number): string {
  const head = done === 0 ? `None ${verb}` : `${done} ${verb}`;
  return skipped > 0 ? `${head}, ${skipped} skipped.` : `${head}.`;
}
