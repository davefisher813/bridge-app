// One score-to-tag mapping, used everywhere a 0-100 dimension or overall
// score needs to become a FitTag. Bridge's calc*FitTag functions each
// invented their own thresholds (0.75/0.4 for athletic, +0.5/+0.2 GPA gaps
// for academic, a 4/2/0 point scale for financial) and then the combiner
// re-derived a *fourth* scale (scoreMap: Conflict 10, Reach 30, Fit 60,
// Safety 85) just for sorting. One band, reused everywhere, is the fix.
import type { FitTag } from "./types";

export function scoreToTag(score: number): FitTag {
  if (score >= 80) return "Safety";
  if (score >= 55) return "Fit";
  if (score >= 35) return "Reach";
  return "Conflict";
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
