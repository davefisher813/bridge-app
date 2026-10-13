import { ORG_TIME_ZONE } from "@/lib/datetime/today";

// One way to print a date on a screen. "May 1, 2026", never the ISO
// string a database column carries. The fundraising screens used to
// print the column as it came.
//
// A calendar date (YYYY-MM-DD) prints as itself. A timestamp prints as
// the org's calendar day: a note written at 9pm in New York is already
// tomorrow in UTC, and slicing the timestamp to its first ten
// characters printed that UTC day. Pass the whole timestamp.
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "no date";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: dateOnly ? "UTC" : ORG_TIME_ZONE });
}
