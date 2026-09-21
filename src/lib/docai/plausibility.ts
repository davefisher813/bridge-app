// The range a measured number can sit in and still be a reading rather
// than a misread. A fastball at 8.8 is a decimal point in the wrong
// place; a 60-yard dash at 68 is the wrong column; a height of 6 is
// feet, not inches. Each of those is a real way a model misreads a
// showcase sheet, and each would have gone into the log and scored.
//
// These are reading bounds, not the matching contract's tiers: they say
// what a number on a page can be for a youth athlete at all, wide
// enough that a genuine outlier is kept and narrow enough that a unit
// or column slip is caught. A value outside is dropped and named in the
// document's warnings, never silently corrected: the fix is a human
// reading the page, not the engine guessing which digit moved.

export interface PlausibleRange {
  min: number;
  max: number;
  // What a slip usually is, for the warning.
  hint: string;
}

export const METRIC_PLAUSIBLE: Record<string, PlausibleRange> = {
  fbVelo: { min: 40, max: 110, hint: "mph" },
  strikePct: { min: 0, max: 100, hint: "a percentage" },
  popTime: { min: 1.5, max: 3.5, hint: "seconds, around 2.0" },
  sixty: { min: 5.5, max: 10, hint: "seconds, around 7.0" },
  armVelo: { min: 40, max: 110, hint: "mph" },
  exitVelo: { min: 40, max: 120, hint: "mph" },
  heightIn: { min: 48, max: 90, hint: "inches, not feet" },
  weightLb: { min: 60, max: 400, hint: "pounds" },
  ppg: { min: 0, max: 60, hint: "points per game" },
  rpg: { min: 0, max: 40, hint: "rebounds per game" },
  apg: { min: 0, max: 30, hint: "assists per game" },
  threePtPct: { min: 0, max: 100, hint: "a percentage" },
  goals: { min: 0, max: 200, hint: "a season count" },
  assists: { min: 0, max: 200, hint: "a season count" },
  cleanSheets: { min: 0, max: 60, hint: "a season count" },
  savePct: { min: 0, max: 100, hint: "a percentage" },
};

export function metricPlausible(key: string, value: number): boolean {
  const r = METRIC_PLAUSIBLE[key];
  if (!r) return Number.isFinite(value) && value >= 0;
  return Number.isFinite(value) && value >= r.min && value <= r.max;
}

// Test totals and sections as the agencies score them.
export const TEST_TOTAL_RANGE: Record<string, [number, number]> = {
  SAT: [400, 1600],
  ACT: [1, 36],
  PSAT: [320, 1520],
  AP: [1, 5],
};
