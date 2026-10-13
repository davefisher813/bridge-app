// Today, as the organization's calendar day.
//
// `new Date().toISOString().slice(0, 10)` is today in UTC, which from
// about 8pm in New York is already tomorrow: a check-in logged that
// evening defaulted to the next day (QA, 2026-10-01). Every screen that
// needs "today" asks here instead. src/laws/dateLaws.test.ts refuses the
// UTC form anywhere in the app.
//
// There is no per-org time zone yet and both orgs are in the New York
// area. When one is not, ORG_TIME_ZONE becomes a column and this takes
// it as an argument, which it already does.

export const ORG_TIME_ZONE = "America/New_York";

export function todayIso(now: Date = new Date(), timeZone: string = ORG_TIME_ZONE): string {
  return now.toLocaleDateString("en-CA", { timeZone });
}

// Today with no arguments, for the screens that only ever want now.
export const orgToday = (): string => todayIso();

// Whole calendar days from one YYYY-MM-DD to another, negative when `to`
// is earlier. Calendar days, not elapsed hours: a window opening
// tomorrow is 1 day away at 11pm the night before, not 0.
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

// "today", "in 1 day", "in 12 days": how far off a date is, as a meta
// line says it.
export function inDaysText(days: number): string {
  if (days <= 0) return "today";
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}
