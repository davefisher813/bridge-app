// Every number in docs/MATCHING_CONTRACT.md, in one place. The engine
// reads these; src/laws/matchingLaws.test.ts reads the same file, so a
// changed number changes the app and its tests together. Numbers marked
// (interpretation) in the contract are Dave's words read into a figure,
// and are the ones most likely to move.

import type { DimensionResult } from "./types";

export type Confidence = DimensionResult["confidence"];

// ── Metrics ──────────────────────────────────────────────────────────
// The measurables an athlete can log. `lowerIsBetter` decides what "best"
// means when several entries exist. `first` lists the position groups the
// metric is scored for, which is where it shows first on the log form;
// everything else sits under More.
export interface MetricSpec {
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  decimals: number;
  sports: string[];
  first: string[];
}

export const METRICS: MetricSpec[] = [
  { key: "fbVelo", label: "FB Velo", unit: "mph", lowerIsBetter: false, decimals: 0, sports: ["baseball", "softball"], first: ["rhp", "lhp"] },
  { key: "strikePct", label: "Strike %", unit: "%", lowerIsBetter: false, decimals: 0, sports: ["baseball", "softball"], first: ["rhp", "lhp"] },
  { key: "popTime", label: "Pop Time", unit: "s", lowerIsBetter: true, decimals: 2, sports: ["baseball", "softball"], first: ["catcher"] },
  { key: "sixty", label: "60 Time", unit: "s", lowerIsBetter: true, decimals: 2, sports: ["baseball", "softball"], first: ["catcher", "middle_inf", "corner"] },
  { key: "armVelo", label: "Arm", unit: "mph", lowerIsBetter: false, decimals: 0, sports: ["baseball", "softball"], first: ["catcher", "middle_inf", "corner"] },
  { key: "exitVelo", label: "Exit Velo", unit: "mph", lowerIsBetter: false, decimals: 0, sports: ["baseball", "softball"], first: ["catcher", "middle_inf", "corner"] },
  { key: "heightIn", label: "Height", unit: "in", lowerIsBetter: false, decimals: 0, sports: ["baseball", "softball", "basketball", "soccer", "volleyball", "football", "lacrosse"], first: ["bb_pg", "bb_sg", "bb_sf", "bb_pf", "bb_c", "bb_g"] },
  { key: "weightLb", label: "Weight", unit: "lb", lowerIsBetter: false, decimals: 0, sports: ["baseball", "softball", "basketball", "soccer", "volleyball", "football", "lacrosse"], first: [] },
  { key: "ppg", label: "Points per Game", unit: "", lowerIsBetter: false, decimals: 1, sports: ["basketball"], first: ["bb_pg", "bb_sg", "bb_sf", "bb_pf", "bb_c", "bb_g"] },
  { key: "rpg", label: "Rebounds per Game", unit: "", lowerIsBetter: false, decimals: 1, sports: ["basketball"], first: ["bb_pg", "bb_sg", "bb_sf", "bb_pf", "bb_c", "bb_g"] },
  { key: "apg", label: "Assists per Game", unit: "", lowerIsBetter: false, decimals: 1, sports: ["basketball"], first: ["bb_pg", "bb_sg", "bb_g"] },
  { key: "threePtPct", label: "3PT %", unit: "%", lowerIsBetter: false, decimals: 0, sports: ["basketball"], first: ["bb_pg", "bb_sg", "bb_g"] },
  { key: "goals", label: "Goals", unit: "", lowerIsBetter: false, decimals: 0, sports: ["soccer", "lacrosse"], first: ["sc_fw", "sc_mid"] },
  { key: "assists", label: "Assists", unit: "", lowerIsBetter: false, decimals: 0, sports: ["soccer", "lacrosse"], first: ["sc_mid"] },
  { key: "cleanSheets", label: "Clean Sheets", unit: "", lowerIsBetter: false, decimals: 0, sports: ["soccer"], first: ["sc_gk", "sc_def"] },
  { key: "savePct", label: "Save %", unit: "%", lowerIsBetter: false, decimals: 0, sports: ["soccer"], first: ["sc_gk"] },
];

export function metricSpec(key: string): MetricSpec | undefined {
  return METRICS.find((m) => m.key === key);
}

// ── Sources and trust ────────────────────────────────────────────────
// "Premier tech is the most reliable. PBR and Perfect Game still work
// but not nearly as reliable. Still valid enough." Lower tier number is
// more trusted. The scoring entry is the best value in the best tier.
export type MetricSource = "premier" | "pbr" | "perfect_game" | "event" | "coach" | "self";

export const SOURCES: { key: MetricSource; label: string; tier: 1 | 2 | 3 | 4; confidence: Confidence }[] = [
  { key: "premier", label: "Premier", tier: 1, confidence: "high" },
  { key: "pbr", label: "PBR", tier: 2, confidence: "high" },
  { key: "perfect_game", label: "Perfect Game", tier: 2, confidence: "high" },
  { key: "event", label: "Other Showcase or Event", tier: 2, confidence: "high" },
  { key: "coach", label: "Coach-Timed Practice", tier: 3, confidence: "medium" },
  { key: "self", label: "Self-Reported", tier: 4, confidence: "low" },
];

export function sourceSpec(key: string) {
  return SOURCES.find((s) => s.key === key) ?? SOURCES[SOURCES.length - 1];
}

// ── Staff grades ─────────────────────────────────────────────────────
// 20 to 80 scouting scale. 50 scores 50, 80 scores 100, 20 scores 0.
export const GRADE_KEYS = ["frame", "athleticism", "skill", "iq", "competitiveness"] as const;
export type GradeKey = (typeof GRADE_KEYS)[number];
export const GRADE_LABEL: Record<GradeKey, string> = {
  frame: "Frame",
  athleticism: "Athleticism",
  skill: "Skill",
  iq: "Baseball IQ",
  competitiveness: "Competitiveness",
};
export const GRADE_MIN = 20;
export const GRADE_MAX = 80;

// How much of the athletic score the grades carry, by position group
// (interpretation of "skill matters more" and "skill matters the most").
export const GRADE_WEIGHT: Record<string, number> = {
  catcher: 0.5,
  middle_inf: 0.4,
  corner: 0.25,
  rhp: 0.25,
  lhp: 0.25,
};
export const GRADE_WEIGHT_DEFAULT = 0.25;

export function gradeToScore(grade: number): number {
  const g = Math.max(GRADE_MIN, Math.min(GRADE_MAX, grade));
  return ((g - GRADE_MIN) / (GRADE_MAX - GRADE_MIN)) * 100;
}

// ── Athletic checks ──────────────────────────────────────────────────
// Within this share of the target scores half. 0.92 means within 8%.
export const NEAR_FACTOR = 0.92;

// Strike percentage for pitchers (interpretation, provisional: "difficult
// to measure").
export const STRIKE_PCT_TARGET = 63;

// Catcher pop time floor is the tier's target plus this many seconds.
export const POP_TIME_FLOOR_GRACE = 0.1;

// ── Bands ────────────────────────────────────────────────────────────
export const BANDS = { safety: 80, fit: 55, reach: 35 } as const;

// ── Blends ───────────────────────────────────────────────────────────
export type ScoringPreset = "money_first" | "balanced" | "baseball_first";
export type AthleteGoal = "education" | "balanced" | "development";

export interface Weights {
  academic: number;
  athletic: number;
  financial: number;
}

// "You need to value money a lot more. It's arguably the biggest driving
// factor." Bridge's default is first.
export const PRESETS: Record<ScoringPreset, { label: string; weights: Weights }> = {
  money_first: { label: "Money First", weights: { academic: 0.3, athletic: 0.3, financial: 0.4 } },
  balanced: { label: "Balanced", weights: { academic: 0.4, athletic: 0.4, financial: 0.2 } },
  baseball_first: { label: "Baseball First", weights: { academic: 0.3, athletic: 0.5, financial: 0.2 } },
};
export const DEFAULT_PRESET: ScoringPreset = "money_first";

// The athlete's goal shifts this much from athletic to academic
// (education) or the other way (development). Financial never moves.
export const GOAL_SHIFT = 0.1;
export const GOAL_LABEL: Record<AthleteGoal, string> = {
  education: "Education First",
  balanced: "Balanced",
  development: "Development First",
};

// For a transfer, eligibility takes this much and the three above fill
// the rest in proportion.
export const ELIGIBILITY_WEIGHT = 0.25;

export function blendWeights(preset: ScoringPreset, goal: AthleteGoal, isTransfer: boolean): Weights & { eligibility: number } {
  const base = PRESETS[preset]?.weights ?? PRESETS[DEFAULT_PRESET].weights;
  let academic = base.academic;
  let athletic = base.athletic;
  if (goal === "education") {
    academic += GOAL_SHIFT;
    athletic -= GOAL_SHIFT;
  } else if (goal === "development") {
    academic -= GOAL_SHIFT;
    athletic += GOAL_SHIFT;
  }
  const financial = base.financial;
  if (!isTransfer) return { academic, athletic, financial, eligibility: 0 };
  const scale = 1 - ELIGIBILITY_WEIGHT;
  return { academic: academic * scale, athletic: athletic * scale, financial: financial * scale, eligibility: ELIGIBILITY_WEIGHT };
}

// ── Money ────────────────────────────────────────────────────────────
// Merit aid the athlete would most qualify for, as a share of the
// school's average merit aid, by GPA (interpretation).
export const MERIT_GPA_FACTORS: { minGpa: number; factor: number }[] = [
  { minGpa: 3.7, factor: 1.0 },
  { minGpa: 3.4, factor: 0.7 },
  { minGpa: 3.0, factor: 0.4 },
];
// Need aid counted as "possible": half the school's average.
export const NEED_AID_FACTOR = 0.5;

// Net cost against the family budget (interpretation).
export const NET_COST_BANDS = {
  underBudget: 85, // plus up to this much more for the margin
  underBudgetBonusMax: 15,
  within25Over: 60,
  within50Over: 40,
  further: 20,
} as const;

// ── Positional need ──────────────────────────────────────────────────
export const POSITIONAL_NEED_BOOST = 10;

// ── Today ────────────────────────────────────────────────────────────
// A stored fit computed inside this many days, Safety or Fit, not on the
// board, is a "new strong match" on Today (interpretation).
export const STRONG_MATCH_DAYS = 7;

// ── School profiles ──────────────────────────────────────────────────
export const STALE_PROFILE_DAYS = { consider: 30, recommend: 90 } as const;

// ── Program tier ─────────────────────────────────────────────────────
export const PROGRAM_TIERS: { key: string; label: string }[] = [
  { key: "elite_d1", label: "Elite D1 / Top JUCO" },
  { key: "mid_d1", label: "Mid-Major D1" },
  { key: "low_d1", label: "Low D1 / High D2" },
  { key: "d2_naia", label: "D2 / D3 / NAIA" },
  { key: "juco", label: "JUCO" },
];
