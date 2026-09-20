// One way to print a date on a screen. "May 1, 2026", never the ISO
// string a database column carries. The fundraising screens used to
// print the column as it came.
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "no date";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
