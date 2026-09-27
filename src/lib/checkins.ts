// Check-ins: how long since an advisor last talked with an athlete, and
// who is due. Pure, no Next and no Supabase, so the reminders on Today,
// My Athletes and the check-in log all read the same rule.
//
// A check-in is staff only (migration 0039): the log and its notes are
// never read by a family login. This file knows nothing about who reads
// it; it only does the arithmetic.

// Two weeks without a check-in and the athlete is due. Dave's number.
export const CHECKIN_DUE_DAYS = 14;

// Mirrors athlete_checkin_kind in migrations/0039_advisors_messages_checkins.sql.
export const CHECKIN_KINDS = ["call", "meeting", "text", "other"] as const;
export type CheckinKind = (typeof CHECKIN_KINDS)[number];

export const CHECKIN_KIND_LABEL: Record<CheckinKind, string> = {
  call: "Call",
  meeting: "Meeting",
  text: "Text",
  other: "Other",
};

// Whole days, floored: the same rule as the communications page. A gap
// is a rough measure by nature and rounding it up would let 13 and a
// half days read as due. A date in the future reads as today. Null when
// there has never been a check-in.
export function daysSinceCheckin(lastOn: string | null | undefined, today: Date): number | null {
  if (!lastOn) return null;
  const then = new Date(lastOn.length === 10 ? `${lastOn}T00:00:00Z` : lastOn).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((today.getTime() - then) / 86_400_000));
}

// Never checked in, or not for CHECKIN_DUE_DAYS or more.
export function checkinDue(lastOn: string | null | undefined, today: Date): boolean {
  const days = daysSinceCheckin(lastOn, today);
  return days === null || days >= CHECKIN_DUE_DAYS;
}

// The most recent occurred_on per athlete, from the log as it comes back
// (any order). ISO dates compare as strings.
export function latestByAthlete(rows: { athlete_id: string; occurred_on: string | null }[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const r of rows) {
    if (!r.occurred_on) continue;
    const seen = latest.get(r.athlete_id);
    if (!seen || r.occurred_on > seen) latest.set(r.athlete_id, r.occurred_on);
  }
  return latest;
}

// Who needs a call most: never checked in first, then the longest gap,
// then by name so the order is stable. Returns a new array.
export function sortByNeed<T extends { days: number | null; name?: string | null }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.days === null && b.days !== null) return -1;
    if (b.days === null && a.days !== null) return 1;
    if (a.days !== null && b.days !== null && a.days !== b.days) return b.days - a.days;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}
