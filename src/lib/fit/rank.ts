// One ranking rule for every list of stored fits. docs/MATCHING_CONTRACT.md
// section 2, amended 2026-09-27: fully scored fits first, then partial
// ones, each by score, so a school scored on one dimension out of three
// never headlines over a school the engine could actually evaluate.
//
// This runs on the stored row (athlete_school_fits plus the joined
// school), which is the one shape every screen already holds. It is a
// pure function over plain types: no database, no React, no clock. The
// database order used to be `score desc` and nothing demoted a partial
// row; the fake client and Postgres also disagreed on ties. The name
// tiebreak here makes the order the same on both.

export type FitSort = "best" | "academic" | "athletic" | "financial" | "net_cost" | "az";

// The sort keys a screen may offer, in the order they are offered. The
// key is what `sort=` carries in the URL; the label is Title Case for
// the control.
export const FIT_SORTS: ReadonlyArray<{ key: FitSort; label: string }> = [
  { key: "best", label: "Best Fit" },
  { key: "academic", label: "Academic" },
  { key: "athletic", label: "Athletic" },
  { key: "financial", label: "Financial" },
  { key: "net_cost", label: "Net Cost" },
  { key: "az", label: "A to Z" },
];

// A URL value into a sort key. Anything unrecognised is Best Fit, so a
// typo in the address bar never throws and never leaves a list unsorted.
export function parseFitSort(value: string | string[] | null | undefined): FitSort {
  const v = Array.isArray(value) ? value[0] : value;
  return FIT_SORTS.some((s) => s.key === v) ? (v as FitSort) : "best";
}

interface StoredDimension {
  score: number;
  confidence?: "high" | "medium" | "low" | "unknown";
}

// The fields the ranking reads. A stored row carries all of them; a
// screen with a thinner select supplies what it has and the missing
// ones are treated as absent (net cost null, dimension unknown).
export interface RankableFit {
  score: number;
  partial: boolean;
  net_cost?: number | null;
  dimensions?: Record<string, unknown>;
  // The id is the last tiebreak, so two schools with one name still
  // land in one order whatever order the rows arrived in.
  school: { id?: string; name: string };
}

type Dimension = "academic" | "athletic" | "financial";

function dimension(row: RankableFit, name: Dimension): StoredDimension | null {
  const d = row.dimensions?.[name];
  if (!d || typeof d !== "object") return null;
  const s = (d as StoredDimension).score;
  if (typeof s !== "number" || !Number.isFinite(s)) return null;
  return d as StoredDimension;
}

// A dimension the engine left out of the blend has nothing to sort on,
// so it sorts last under its own key, whatever neutral number it holds.
function dimensionScore(row: RankableFit, name: Dimension): number | null {
  const d = dimension(row, name);
  if (!d || d.confidence === "unknown") return null;
  return d.score;
}

function netCost(row: RankableFit): number | null {
  const n = row.net_cost;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

const byName = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function compareName(a: RankableFit, b: RankableFit): number {
  const n = byName.compare(a.school?.name ?? "", b.school?.name ?? "");
  if (n !== 0) return n;
  const x = a.school?.id ?? "";
  const y = b.school?.id ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

// Full before partial, higher score first, then A to Z. Every other key
// falls back to this once its own comparison is a tie.
function compareBest(a: RankableFit, b: RankableFit): number {
  if (a.partial !== b.partial) return a.partial ? 1 : -1;
  if (a.score !== b.score) return b.score - a.score;
  return compareName(a, b);
}

// Higher first, and a row with nothing to sort on goes last.
function compareDesc(x: number | null, y: number | null): number {
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}

// Lower first, and a row with nothing to sort on goes last.
function compareAsc(x: number | null, y: number | null): number {
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

function comparatorFor(sort: FitSort): (a: RankableFit, b: RankableFit) => number {
  switch (sort) {
    case "best":
      return compareBest;
    case "academic":
    case "athletic":
    case "financial":
      return (a, b) => compareDesc(dimensionScore(a, sort), dimensionScore(b, sort)) || compareBest(a, b);
    case "net_cost":
      return (a, b) => compareAsc(netCost(a), netCost(b)) || compareBest(a, b);
    case "az":
      return (a, b) => compareName(a, b) || compareBest(a, b);
  }
}

// Returns a new array; never reorders the caller's.
export function rankFits<T extends RankableFit>(rows: readonly T[], sort: FitSort = "best"): T[] {
  const cmp = comparatorFor(sort);
  return [...rows].sort(cmp);
}

// "Partial · N of M scored". N is how many dimensions the engine
// counted; M is how many it had, 3 for a high school athlete and 4 for a
// transfer, which is why M comes from the row and is never a constant.
export function partialLabel(counted: number, total: number): string {
  return `Partial · ${counted} of ${total} scored`;
}

const DIMENSIONS = ["academic", "athletic", "financial", "eligibility"] as const;

// The label for a stored row: `dimensions.counted` names what was in
// the blend and the dimension keys present say how many there were.
export function partialLabelFor(row: Pick<RankableFit, "dimensions">): string {
  const d = row.dimensions ?? {};
  const counted = Array.isArray(d.counted) ? d.counted.length : 0;
  const total = DIMENSIONS.filter((k) => d[k] && typeof d[k] === "object").length;
  return partialLabel(counted, Math.max(total, counted));
}
