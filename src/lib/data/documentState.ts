// What a document's status means over time. Plain functions, outside the
// "use server" action file, so a page and a test can read them.

// How long a reading can genuinely take before "processing" means "was
// killed". The hosting function allows five minutes and the model calls
// are capped well inside that, so a document still marked as being read
// after this long will never finish on its own.
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

export function isStaleProcessing(createdAt: string, now = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > STALE_PROCESSING_MS;
}

// "3 minutes", "2 hours", "4 days": how long ago a reading started, in
// the unit a person would use.
export function ageOf(createdAt: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - new Date(createdAt).getTime()) / 60000));
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
