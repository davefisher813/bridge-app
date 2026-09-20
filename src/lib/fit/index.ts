// Public API of the fit engine. Everything outside src/lib/fit should
// import from here, not from the individual dimension files, so the
// internals (academic.ts, athletic.ts, etc.) stay free to change shape.

export type {
  Athlete,
  AthleteDetail,
  DimensionResult,
  FitResult,
  FitTag,
  RecruitingSignals,
  RecruitType,
  School,
  TransferWindow,
  PositionalNeed,
} from "./types";

export { scoreFit } from "./score";
export type { ScoreFitOptions } from "./score";

export { scoreAcademic } from "./academic";
export { scoreAthletic, baseballPositionGroup, positionGroupFor, positionGroupOf } from "./athletic";
export { scoreFinancial } from "./financial";
export { scoreEligibility } from "./transfer";

export { scoreToTag, clampScore } from "./bands";
export { selectScoringMetrics, combinedConfidence, metricsFor, formatMetricValue } from "./metrics";
export type { MetricEntry, ScoringMetrics } from "./metrics";
export * from "./contract";

export { athleteDetailSchema, parseAthleteDetail, safeParseAthleteDetail } from "./schema";

export {
  BASEBALL_SOFTBALL_POSITIONS,
  TIERS,
  divisionToTier,
  tierFor,
  isD1,
  isD1D2,
  isD3,
} from "./benchmarks";
export type { PositionBenchmark, PositionMetric } from "./benchmarks";
