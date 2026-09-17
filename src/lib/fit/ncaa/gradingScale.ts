// A high school's numeric-to-letter conversion table, and the rules for
// deciding whether one can be trusted.
//
// This lived inside src/lib/actions/documents.ts, where only the Doc AI
// path could reach it. It moved here because a scale typed in by a
// coordinator needs exactly the same sanity check as one read off a
// scan, and because a check that lives in a Next.js server action cannot
// run in the test bench. It is pure, so it runs in both.
//
// Why the check exists at all: a single band covering 0 to 100 maps
// every grade at that school to one letter, which turns every athlete
// there into a 4.00 or a 0.00, and reads on screen as a confident
// verdict rather than as the nonsense it is.

import type { GradingBand } from "./fromTranscript";

export type { GradingBand };

// Where a scale came from. The NCAA converts using the school's own
// published table, so "which table, and who says so" is part of the
// answer, not metadata about it.
//
// "assumed" is the fallback: the common ten-point table, applied when
// nothing is on file so a number appears instead of a blank. It is a
// product decision, made deliberately (Dave, 2026-09: "we need a default
// if the school isnt on file its not that big of a deal"), and it is
// safe only because it is labelled as an assumption every single place
// the resulting GPA is shown. An assumed conversion never earns a
// weighted bonus and never presents as confirmed.
export type ScaleOrigin = "verified" | "org" | "assumed";

// The letters a scale needs to carry. The NCAA does not recognise plus
// or minus (B+, B and B- are all three quality points), so a school that
// publishes twelve bands collapses to these five without losing anything
// that affects a core GPA.
export const SCALE_LETTERS = ["A", "B", "C", "D", "F"] as const;
export type ScaleLetter = (typeof SCALE_LETTERS)[number];

// The widest a single band can be before it stops being a grade band and
// starts being a catch-all.
export const MAX_BAND_SPAN = 40;

// Above this, a number is not a grade on any scale a US high school
// prints. Cardinal Hayes reports a weighted 102, so the ceiling is not
// 100.
export const MAX_PLAUSIBLE_GRADE = 130;

// Rejects a table that cannot be a real high school grading scale.
// Returns null when the table is usable, or a sentence naming the
// problem, phrased to be shown to whoever supplied it.
export function gradingScaleProblem(bands: unknown[]): string | null {
  const parsed = bands as Array<{ letter?: unknown; min?: unknown; max?: unknown }>;
  const rows: Array<{ letter: string; min: number; max: number }> = [];
  for (const b of parsed) {
    const letter = typeof b.letter === "string" ? b.letter.trim().toUpperCase() : "";
    const min = typeof b.min === "number" ? b.min : NaN;
    const max = typeof b.max === "number" ? b.max : NaN;
    if (!letter || !Number.isFinite(min) || !Number.isFinite(max)) return "one of its rows is not a letter and a numeric range.";
    if (min > max) return `its ${letter} band runs from ${min} down to ${max}.`;
    if (min < 0 || max > MAX_PLAUSIBLE_GRADE) return `its ${letter} band falls outside any plausible grade range.`;
    if (!/^[A-F]/.test(letter)) return `"${letter}" is not a grade this can score.`;
    rows.push({ letter, min, max });
  }
  if (rows.length < 3) return "it has fewer than three grade bands.";

  const sorted = [...rows].sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.min <= sorted[i - 1]!.max) return `its ${sorted[i - 1]!.letter} and ${sorted[i]!.letter} bands overlap.`;
  }
  // The span check skips the lowest band. A failing band is open-ended
  // at the bottom by nature: every real table prints F as 0 to 64 or so,
  // which is 65 points wide. Applying the catch-all rule to it rejected
  // every complete grading table there is, which meant the Doc AI path
  // refused any transcript legend that printed an F row and said the
  // table "was not saved" without anyone understanding why.
  const above = sorted.slice(1);
  const widest = above.reduce((w, b) => Math.max(w, b.max - b.min), 0);
  if (widest > MAX_BAND_SPAN) return `one band spans more than ${MAX_BAND_SPAN} points, which is not a grade band.`;

  // Letters have to run the right way. A table where the A band sits
  // below the C band converts every good grade into a bad one, passes
  // every check above, and produces a core GPA that looks ordinary.
  const rank: Record<string, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };
  for (let i = 1; i < sorted.length; i++) {
    const lower = rank[sorted[i - 1]!.letter.charAt(0)];
    const upper = rank[sorted[i]!.letter.charAt(0)];
    if (lower === undefined || upper === undefined) continue;
    if (upper < lower) return `its ${sorted[i]!.letter} band sits above its ${sorted[i - 1]!.letter} band.`;
  }
  return null;
}

// Problems worth telling someone about that are not reasons to refuse
// the table. A gap between bands means grades landing in it convert to
// nothing, which the engine already reports per course, but saying it
// once at entry time is cheaper than finding out per athlete.
export function gradingScaleNotes(bands: GradingBand[]): string[] {
  const notes: string[] = [];
  if (!bands.length) return notes;
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.min - sorted[i - 1]!.max;
    if (gap > 1) {
      notes.push(
        `Grades between ${sorted[i - 1]!.max} and ${sorted[i]!.min} fall between the ${sorted[i - 1]!.letter} and ${sorted[i]!.letter} bands and will not convert.`,
      );
    }
  }
  const top = sorted[sorted.length - 1]!;
  if (top.max <= 100) {
    notes.push(`The top band stops at ${top.max}. Anything higher still counts as ${top.letter}, including a weighted grade over 100.`);
  }
  const bottom = sorted[0]!;
  if (bottom.min > 0) {
    notes.push(`The lowest band starts at ${bottom.min}. Grades below that will not convert.`);
  }
  return notes;
}

// Picks the table that governs, given every table on file for one
// school. A scale someone has confirmed with the school outranks one an
// org typed in, which outranks the assumed default, and an org only ever
// sees its own entries, so there is no order in which one org's typing
// can displace another's.
export function resolveScale<T extends { origin: ScaleOrigin }>(candidates: T[]): T | null {
  return (
    candidates.find((c) => c.origin === "verified") ??
    candidates.find((c) => c.origin === "org") ??
    candidates.find((c) => c.origin === "assumed") ??
    // A candidate whose origin is not one of the three is still a real
    // table somebody fetched out of a real row. Returning null for it
    // drops the school's own conversion and substitutes the assumed
    // ten-point default, which is a WORSE answer arrived at silently.
    // That is not hypothetical: the eligibility page cast its query
    // result to GradingScaleRow without an origin (no such column
    // exists, the app derives the label), so every scale in the product
    // resolved to null and every school read as assumed. Prefer the
    // row. The caller labels an unrecognised origin conservatively.
    candidates[0] ??
    null
  );
}

// The common US ten-point table. Two jobs, and they are different:
// the starting point the entry form prefills for someone to correct,
// and the fallback applied when a school has no table at all.
export const TEN_POINT_STARTING_POINT: GradingBand[] = [
  { letter: "A", min: 90, max: 100 },
  { letter: "B", min: 80, max: 89 },
  { letter: "C", min: 70, max: 79 },
  { letter: "D", min: 65, max: 69 },
  { letter: "F", min: 0, max: 64 },
];

// The sentence that has to travel with any GPA built on the fallback.
// Exported rather than written at each call site so it cannot be
// softened in one place and not another, and so the laws can assert it.
export const ASSUMED_SCALE_WARNING =
  "converted on the standard ten-point scale, because that school's own table is not on file. The NCAA uses the school's published table, so this core GPA is an estimate and can move once the real one is entered.";

export function assumedScaleWarning(school: string): string {
  return `${school ? `${school} grades were` : "Numeric grades were"} ${ASSUMED_SCALE_WARNING}`;
}
