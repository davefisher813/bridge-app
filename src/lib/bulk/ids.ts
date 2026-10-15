// The ids a bulk action was sent (BulkSelect submits them as repeated
// `ids` fields). Anything that is not a UUID is dropped, duplicates are
// folded, and one action never takes more than BULK_CAP rows: a bulk
// action is a deliberate hand-sized batch, not a bulk import.

export const BULK_CAP = 200;

// Actions that open and read each stored file (Suggest Who and What) take
// fewer at a time, to stay inside one request.
export const SUGGEST_CAP = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BulkIds = { ok: true; ids: string[] } | { ok: false; error: string };

export function parseBulkIds(formData: FormData): BulkIds {
  const ids = [...new Set(formData.getAll("ids").map((v) => String(v).trim()).filter((v) => UUID.test(v)))];
  if (ids.length === 0) return { ok: false, error: "Nothing was selected." };
  if (ids.length > BULK_CAP) return { ok: false, error: `Select ${BULK_CAP} or fewer at a time.` };
  return { ok: true, ids };
}

// "3 assignments", "1 document".
export function countOf(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}
