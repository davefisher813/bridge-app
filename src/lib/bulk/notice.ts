// The one sentence a bulk action ends with: how many it changed and how
// many it skipped and why. A bulk action never forces a row past a rule;
// it skips the row and says so.
//
//   "Approved 4 documents. Skipped 3: 2 waiting on their approver, 1 not in Needs Review."
//   "Nothing was changed. Skipped 3: 3 not in Needs Review."

import { countOf } from "./ids";

export interface BulkOutcome {
  // "Approved", "Archived": past tense, starts the sentence.
  verb: string;
  noun: string;
  applied: number;
  // Reason to count, in the order first met.
  skipped: ReadonlyMap<string, number>;
  // Closes the first clause: "Typed 3 documents as Transcript."
  tail?: string;
}

export class SkipTally {
  private readonly counts = new Map<string, number>();
  add(reason: string) {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }
  get total(): number {
    return [...this.counts.values()].reduce((a, b) => a + b, 0);
  }
  get map(): ReadonlyMap<string, number> {
    return this.counts;
  }
}

export function bulkNotice(o: BulkOutcome): { text: string; changed: boolean } {
  const skippedTotal = [...o.skipped.values()].reduce((a, b) => a + b, 0);
  const head = o.applied > 0 ? `${o.verb} ${countOf(o.applied, o.noun)}${o.tail ? ` ${o.tail}` : ""}.` : "Nothing was changed.";
  if (skippedTotal === 0) return { text: head, changed: o.applied > 0 };
  const why = [...o.skipped].map(([reason, n]) => `${n} ${reason}`).join(", ");
  return { text: `${head} Skipped ${skippedTotal}: ${why}.`, changed: o.applied > 0 };
}
