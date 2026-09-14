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

import type { Athlete, DimensionResult, FitResult, RecruitingSignals, School, TransferWindow } from "./types";
import { scoreAcademic } from "./academic";
import { scoreAthletic } from "./athletic";
import { scoreFinancial } from "./financial";
import { scoreEligibility } from "./transfer";
import { clampScore, scoreToTag } from "./bands";
import { isD1D2 } from "./benchmarks";

export interface ScoreFitOptions {
  // True when the athlete is already placed at (or done recruiting) this
  // school - e.g. Committed, Graduated, or otherwise no longer being
  // actively evaluated. Bridge encoded this as a status-string check
  // inside calcAthleticFitTag only, so academic/financial never saw it.
  // Checking it once, centrally, before any dimension runs, is the fix.
  isPlaced?: boolean;
  transferWindows?: TransferWindow[];
  signals?: RecruitingSignals;
  today?: Date;
}

// Documented weighted blend. HS recruits split 40/40/20 across academic/
// athletic/financial. Transfers add eligibility and reweight to 30/30/
// 15/25 - eligibility gets real weight because a hard-to-clear transfer
// rule matters as much as fit does, but a veto on it still overrides the
// blend entirely, same as any other dimension.
const WEIGHTS_HS = { academic: 0.4, athletic: 0.4, financial: 0.2 } as const;
const WEIGHTS_TRANSFER = { academic: 0.3, athletic: 0.3, financial: 0.15, eligibility: 0.25 } as const;

function isVetoingDimension(d: DimensionResult): boolean {
  return d.veto;
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
    };
  }

  const academic = scoreAcademic(athlete, school);
  const athletic = scoreAthletic(athlete, school);
  const financial = scoreFinancial(athlete, school);
  const isTransfer = athlete.recruitType !== "hs";
  const eligibility = isTransfer ? scoreEligibility(athlete, school, opts.transferWindows, opts.today) : undefined;

  const vetoingDims = [academic, athletic, eligibility].filter((d): d is DimensionResult => !!d && isVetoingDimension(d));

  let score: number;
  if (vetoingDims.length > 0) {
    // A veto is a hard conflict: the blend never gets a chance to average
    // it away. Score reported is the worst vetoing dimension's, so the UI
    // can still show *how* conflicted, not just that it is.
    score = Math.min(...vetoingDims.map((d) => d.score));
  } else {
    const weights = isTransfer ? WEIGHTS_TRANSFER : WEIGHTS_HS;
    score =
      academic.score * weights.academic +
      athletic.score * weights.athletic +
      financial.score * weights.financial +
      (isTransfer && eligibility ? eligibility.score * (weights as typeof WEIGHTS_TRANSFER).eligibility : 0);
  }

  const reasons: string[] = [...academic.reasons, ...athletic.reasons, ...financial.reasons, ...(eligibility?.reasons ?? [])];
  const warnings: string[] = [...academic.warnings, ...athletic.warnings, ...financial.warnings, ...(eligibility?.warnings ?? [])];

  // Recruiting-signal nudges. Applied once, bounded, only when not
  // already vetoed - an offer doesn't erase a GPA below the school's
  // floor, it just isn't evaluated as a tiebreaker for a conflict that
  // already exists.
  if (vetoingDims.length === 0 && opts.signals) {
    const { offer, visitCount = 0, commCount = 0 } = opts.signals;
    if (offer) {
      if (offer.offerType === "scholarship" || offer.offerType === "written") {
        score = Math.max(score, 88);
        reasons.unshift(`${offer.offerType} offer on file${offer.scholarshipPercent ? ` (${offer.scholarshipPercent}%)` : ""}`);
      } else if (offer.offerType === "verbal" || offer.offerType === "preferred_walk_on") {
        score = Math.max(score, 60);
        reasons.unshift("Verbal offer on file");
      } else {
        reasons.push(`${offer.offerType} on file`);
      }
    }
    if (visitCount >= 1) {
      score = Math.min(100, score + 5);
      reasons.push(`${visitCount} visit${visitCount > 1 ? "s" : ""} completed`);
    } else if (commCount >= 5) {
      reasons.push(`${commCount} communications: sustained coach engagement`);
    }
  }

  // Cross-cutting warnings that apply regardless of recruit type or
  // dimension, ported from calcCollegeFit's FIT-5/FIT-11/FIT-12 blocks.
  if (school.profileDate) {
    const ageDays = (Date.now() - new Date(school.profileDate).getTime()) / 86400000;
    if (ageDays >= 90) warnings.push(`School profile is ${Math.round(ageDays)} days old: refresh recommended`);
    else if (ageDays >= 30) warnings.push(`School profile is ${Math.round(ageDays)} days old: consider refreshing`);
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
  };
}
