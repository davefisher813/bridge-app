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
