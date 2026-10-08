// The five states a stored document is in, and the only moves between
// them. Pure: the server uses it to refuse a move before it writes, the
// database trigger in migration 0048 repeats the same table, and a law
// test compares the two so they cannot drift.
//
//   Uploaded > Processing > Needs Review > Ready > Archived
//
// Uploaded is the moment between "the file is confirmed stored" and
// "something decided what to do with it". Processing is only the existing
// reader running on a file someone tagged with one of the six old types.
// Every upload ends in Needs Review: no AI judges a file finished in this
// piece. Ready is always a person's tap. Archived hides a document from
// the default lists and never removes it.

export const LIFECYCLE_STATES = ["uploaded", "processing", "needs_review", "ready", "archived"] as const;
export type Lifecycle = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  needs_review: "Needs Review",
  ready: "Ready",
  archived: "Archived",
};

// Who makes a move. "system" is the server finishing what an upload
// started (the person is still the actor in the activity log). "staff" is
// a person tapping a button.
export type Mover = "system" | "staff";

export const TRANSITIONS: ReadonlyArray<{ from: Lifecycle; to: Lifecycle; by: Mover; action: LifecycleAction }> = [
  { from: "uploaded", to: "processing", by: "system", action: "document_reading" },
  { from: "uploaded", to: "needs_review", by: "system", action: "document_needs_review" },
  { from: "processing", to: "needs_review", by: "system", action: "document_needs_review" },
  { from: "needs_review", to: "ready", by: "staff", action: "document_ready" },
  { from: "needs_review", to: "archived", by: "staff", action: "document_archived" },
  { from: "ready", to: "archived", by: "staff", action: "document_archived" },
  { from: "archived", to: "needs_review", by: "staff", action: "document_unarchived" },
];

// The activity-log actions the moves write (migration 0048 adds them).
export type LifecycleAction = "document_reading" | "document_needs_review" | "document_ready" | "document_archived" | "document_unarchived";

export function transitionFor(from: Lifecycle, to: Lifecycle) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

export function canMove(from: Lifecycle, to: Lifecycle, by: Mover): boolean {
  const t = transitionFor(from, to);
  return !!t && (t.by === by || (by === "staff" && from === "processing"));
}

// A reading that has run longer than this has not finished: the server
// that started it is gone. Staff may move the row on to Needs Review.
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

export function isStaleProcessing(lifecycle: Lifecycle, changedAt: string | Date | null, now: Date = new Date()): boolean {
  if (lifecycle !== "processing" || !changedAt) return false;
  return now.getTime() - new Date(changedAt).getTime() > STALE_PROCESSING_MS;
}

export function isLifecycle(value: unknown): value is Lifecycle {
  return typeof value === "string" && (LIFECYCLE_STATES as readonly string[]).includes(value);
}

// Shown on a row when the reader ended without a result a person can use.
export function didNotLookLike(typeLabel: string): string {
  return `Did not look like ${typeLabel}`;
}

// How the old internal status maps onto the new lifecycle, for the
// migration and for the law that checks the SQL against this table.
export const LEGACY_STATUS_TO_LIFECYCLE: Record<string, Lifecycle> = {
  processing: "needs_review",
  pending: "needs_review",
  applied: "needs_review",
  discarded: "archived",
  failed: "needs_review",
  filed: "needs_review",
};
