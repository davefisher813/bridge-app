// A figure a reading found, with what it is for. Only money gets a dollar
// sign and thousands separators: "$4 GPA" and "$2,026 Graduation year"
// were numbers that are not money (live test D1, 2026-10-16).

// Words that say a figure is a measure, a year or a count, not dollars.
const NOT_MONEY = /\b(gpa|grade|year|years|class of|weight|lbs?|pounds?|height|inch|inches|feet|ft|yards?|dash|mph|velocity|speed|age|score|scores|rating|rank|percent|percentage|%|minimum|min\.|credits?|courses?|games?|innings?|hours?|minutes?|seconds?|days?|weeks?|months?|count|number of|sat|act|jersey|distance|miles?|rpm|era|avg|average)\b|%/i;

export function isMoney(what: string | null | undefined): boolean {
  if (!what) return true; // an unlabeled figure keeps the old reading: money
  return !NOT_MONEY.test(what);
}

function plainNumber(n: number): string {
  // 2026 stays 2026, 3.75 stays 3.75; no thousands separators on a measure.
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function figureText(amount: number | null | undefined, what: string | null | undefined): string {
  const n = Number(amount ?? 0);
  const label = what ? ` ${what}` : "";
  return isMoney(what) ? `$${Math.round(n).toLocaleString("en-US")}${label}` : `${plainNumber(n)}${label}`;
}
