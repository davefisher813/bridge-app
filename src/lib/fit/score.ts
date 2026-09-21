// The coherent combiner. Replaces Bridge's calcCollegeFit
// (bffsa-site/index.html ~line 10469), which combined tags through five
// sequential override layers in a fixed order (worst-of academic/
// athletic, then a financial nudge, then an offer boost, then a coach-
// engagement boost, then a playing-time-outlook downgrade, each capable
// of undoing the one before it) plus a separate score lookup table used
// only for sorting.
//
// Here every dimension returns the same shape (score 0-100, confidence,
// veto, reasons, warnings). A veto is a hard conflict and always wins,
// full stop, no override order to reason about. Absent a veto, the
// dimensions blend with one documented set of weights. Recruiting
// signals (offers, visits, comms) are applied once, after the blend, as
// bounded nudges rather than a chain of tag reassignments.

import type { Athlete, DimensionResult, FitResult, PositionalNeed, RecruitingSignals, School, TransferWindow, KnownAid } from "./types";
import { scoreAcademic } from "./academic";
import { scoreAthletic, baseballPositionGroup } from "./athletic";
import { scoreFinancial } from "./financial";
import { scoreEligibility } from "./transfer";
import { clampScore, scoreToTag } from "./bands";
import { isD1D2 } from "./benchmarks";
import { DEFAULT_PRESET, POSITIONAL_NEED_BOOST, STALE_PROFILE_DAYS, blendWeights, type AthleteGoal, type ScoringPreset } from "./contract";

export interface ScoreFitOptions {
  // True when the athlete is already placed at (or done recruiting) this
  // school - e.g. Committed, Graduated, or otherwise no longer being
  // actively evaluated. Bridge encoded this as a status-string check
  // inside calcAthleticFitTag only, so academic/financial never saw it.
  // Checking it once, centrally, before any dimension runs, is the fix.
  isPlaced?: boolean;
  transferWindows?: TransferWindow[];
  // Shown on the row, never scored. docs/MATCHING_CONTRACT.md section 3.
  signals?: RecruitingSignals;
  today?: Date;
  // The org's preset. The athlete's goal comes off the athlete.
  preset?: ScoringPreset;
  // The org's private positions of need at this school.
  positionalNeed?: PositionalNeed[];
  // An applied award letter for this athlete at this school. Replaces
  // the aid estimate in the financial dimension.
  aid?: KnownAid;
}

// The blend is the org's preset shifted by the athlete's goal
// (src/lib/fit/contract.ts). A dimension with unknown confidence is left
// out and the rest renormalized, so a number nobody typed never drags a
// school to the middle. A veto still overrides everything.

function isVetoingDimension(d: DimensionResult): boolean {
  return d.veto;
}

function needMatches(athlete: Athlete, need: PositionalNeed[] | undefined): PositionalNeed | null {
  if (!need || need.length === 0) return null;
  const group = baseballPositionGroup(athlete.position);
  const pos = (athlete.position || "").toUpperCase();
  const gradYear = athlete.detail?.kind === "hs" ? athlete.detail.gradYear : undefined;
  for (const n of need) {
    const np = (n.position || "").toUpperCase();
    const sameGroup = np === pos || (group !== null && baseballPositionGroup(np) === group);
    if (!sameGroup) continue;
    if (n.gradYear && gradYear && n.gradYear !== gradYear) continue;
    return n;
  }
  return null;
}

export function scoreFit(athlete: Athlete, school: School, opts: ScoreFitOptions = {}): FitResult {
  if (opts.isPlaced) {
    return {
      tag: "Fit",
      score: 60,
      academic: { score: 60, confidence: "unknown", veto: false, reasons: [], warnings: [] },
      athletic: { score: 60, confidence: "unknown", veto: false, reasons: [], warnings: [] },
      financial: { score: 60, confidence: "unknown", veto: false, reasons: [], warnings: [] },
      reasons: ["Placed athlete: fit not evaluated further"],
      warnings: [],
      partial: false,
      counted: [],
      signals: opts.signals,
    };
  }

  const academic = scoreAcademic(athlete, school);
  const athletic = scoreAthletic(athlete, school);
  const financial = scoreFinancial(athlete, school, opts.aid);
  const isTransfer = athlete.recruitType !== "hs";
  const eligibility = isTransfer ? scoreEligibility(athlete, school, opts.transferWindows, opts.today) : undefined;

  const vetoingDims = [academic, athletic, eligibility].filter((d): d is DimensionResult => !!d && isVetoingDimension(d));

  const weights = blendWeights(opts.preset ?? DEFAULT_PRESET, (athlete.goal ?? "balanced") as AthleteGoal, isTransfer);
  const dims: Array<{ name: string; result: DimensionResult; weight: number }> = [
    { name: "academic", result: academic, weight: weights.academic },
    { name: "athletic", result: athletic, weight: weights.athletic },
    { name: "financial", result: financial, weight: weights.financial },
  ];
  if (isTransfer && eligibility) dims.push({ name: "eligibility", result: eligibility, weight: weights.eligibility });

  const counted = dims.filter((d) => d.result.confidence !== "unknown");
  const partial = counted.length < dims.length;

  let score: number;
  if (vetoingDims.length > 0) {
    // A veto is a hard conflict: the blend never gets a chance to average
    // it away. Score reported is the worst vetoing dimension's, so the UI
    // can still show *how* conflicted, not just that it is.
    score = Math.min(...vetoingDims.map((d) => d.score));
  } else if (counted.length === 0) {
    score = 50;
  } else {
    const total = counted.reduce((sum, d) => sum + d.weight, 0);
    score = counted.reduce((sum, d) => sum + d.result.score * (d.weight / total), 0);
  }

  const reasons: string[] = [...academic.reasons, ...athletic.reasons, ...financial.reasons, ...(eligibility?.reasons ?? [])];
  const warnings: string[] = [...academic.warnings, ...athletic.warnings, ...financial.warnings, ...(eligibility?.warnings ?? [])];

  if (partial && vetoingDims.length === 0) {
    const left = dims.filter((d) => d.result.confidence === "unknown").map((d) => d.name);
    warnings.unshift(`Scored on ${counted.map((d) => d.name).join(" and ")} only: no ${left.join(" or ")} data yet`);
  }

  // An org's positions of need at this school: a matching athlete gets
  // the boost and a reason. Never past a veto.
  if (vetoingDims.length === 0) {
    const need = needMatches(athlete, opts.positionalNeed);
    if (need) {
      score = Math.min(100, score + POSITIONAL_NEED_BOOST);
      reasons.unshift(`This program needs a ${need.position}${need.gradYear ? ` for ${need.gradYear}` : ""}`);
    }
  }

  // Cross-cutting warnings that apply regardless of recruit type or
  // dimension, ported from calcCollegeFit's FIT-5/FIT-11/FIT-12 blocks.
  if (school.profileDate) {
    const ageDays = ((opts.today ?? new Date()).getTime() - new Date(school.profileDate).getTime()) / 86400000;
    if (ageDays >= STALE_PROFILE_DAYS.recommend) warnings.push(`School profile is ${Math.round(ageDays)} days old: refresh recommended`);
    else if (ageDays >= STALE_PROFILE_DAYS.consider) warnings.push(`School profile is ${Math.round(ageDays)} days old: consider refreshing`);
  }
  if (isD1D2(school.division)) {
    const status = (athlete.ncaaEligibilityStatus || "").toLowerCase();
    if (!status || status === "not registered" || status === "none") {
      warnings.push("NCAA Eligibility Center registration required for D1/D2 play: athlete not yet registered");
    } else if (status === "in progress" || status === "pending") {
      warnings.push("NCAA Eligibility Center: in progress");
    }
  }
  if (athlete.isInternational && !athlete.toeflScore && !athlete.ieltsScore) {
    warnings.push("International athlete: TOEFL/IELTS not yet on file, required for most US schools");
  }

  return {
    tag: scoreToTag(clampScore(score)),
    score: clampScore(score),
    academic,
    athletic,
    financial,
    eligibility,
    reasons,
    warnings,
    partial,
    counted: counted.map((d) => d.name),
    signals: opts.signals,
  };
}
