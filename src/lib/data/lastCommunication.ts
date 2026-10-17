// The date of the newest entry in a target's Communication Log. Derived
// every time from the log itself, never stored: a hand-kept second field
// would drift the first time somebody forgot it. Null when nothing is
// logged, and a screen shows nothing for null.
export function lastCommunication(rows: { occurred_on?: string | null }[]): string | null {
  let newest: string | null = null;
  for (const r of rows) {
    const d = r.occurred_on;
    if (d && (newest === null || d > newest)) newest = d;
  }
  return newest;
}
