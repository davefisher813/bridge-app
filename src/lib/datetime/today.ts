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
