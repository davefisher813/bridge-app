// Financial fit dimension. Replaces Bridge's calcFinancialFitTag
// (bffsa-site/index.html ~line 11101). Financial never vetoes - it stays
// advisory, same as the original combiner comment ("financial is
// advisory") - but now that's an explicit veto:false instead of an
// implicit habit of the combining code.
//
// Verified NCAA facts encoded here (see docs/BUSINESS_RULES.md for
// sourcing, confirmed after an initial draft wrongly generalized the
// House settlement to all divisions):
//   - D3 categorically bans athletic scholarships. Unrelated to House.
//   - The House v. NCAA settlement (scholarship caps -> roster limits)
//     applies to Division I only, and only to schools that opt in.
//   - D2 keeps its own separate, still-capped scholarship rules,
//     untouched by the settlement.

import type { Athlete, DimensionResult, KnownAid, School } from "./types";
import { isD1, isD3 } from "./benchmarks";
import { clampScore } from "./bands";
import { MERIT_GPA_FACTORS, NEED_AID_FACTOR, NET_COST_BANDS } from "./contract";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// Cost of attendance for this athlete: in state when the athlete's home
// state matches the school's, out of state otherwise.
function costFor(athlete: Athlete, school: School): { cost: number; basis: string } | null {
  const f = school.financials;
  if (!f) return null;
  const home = (athlete.homeState || "").trim().toUpperCase();
  const there = (school.state || "").trim().toUpperCase();
  if (home && there && home === there && f.instateTotal) return { cost: f.instateTotal, basis: "in state" };
  if (f.outstateTotal) return { cost: f.outstateTotal, basis: "out of state" };
  if (f.instateTotal) return { cost: f.instateTotal, basis: "in state" };
  return null;
}

// "What they will most qualify for with academic scholarships and
// financial aid." Net cost after the aid this athlete could expect,
// against what the family can pay. docs/MATCHING_CONTRACT.md section 3.
function scoreAgainstBudget(athlete: Athlete, school: School, budget: number): DimensionResult | null {
  const f = school.financials;
  if (!f) return null;
  const c = costFor(athlete, school);
  if (!c) return null;
  const reasons: string[] = [];
  const warnings: string[] = [];
  let aid = 0;

  if (isD3(school.division)) {
    reasons.push("D3 school: athletic scholarships are not allowed by NCAA rules (unrelated to the House settlement)");
  } else if (f.athleticScholarship && f.athleticScholarship !== "none" && f.avgAthleticAid) {
    aid += f.avgAthleticAid;
    reasons.push(`Athletic aid: about ${money(f.avgAthleticAid)} a year on average here`);
  } else if (f.athleticScholarship === "none") {
    reasons.push("No athletic scholarships at this school (academic aid only)");
  }

  const gpa = athlete.gpa ?? 0;
  const factor = MERIT_GPA_FACTORS.find((m) => gpa >= m.minGpa)?.factor ?? 0;
  if (f.avgMeritAid && factor > 0) {
    const merit = f.avgMeritAid * factor;
    aid += merit;
    reasons.push(`Merit aid: about ${money(merit)} a year at a ${gpa.toFixed(2)} GPA`);
  } else if (f.avgMeritAid) {
    warnings.push(`Merit aid here averages ${money(f.avgMeritAid)}, and usually starts at a 3.0 GPA`);
  }
  if (f.avgNeedAid) {
    const need = f.avgNeedAid * NEED_AID_FACTOR;
    aid += need;
    reasons.push(`Need-based aid: possibly ${money(need)} a year, depending on the family's finances`);
  }

  const net = Math.max(0, c.cost - aid);
  reasons.push(`Net cost about ${money(net)} a year (${money(c.cost)} ${c.basis}, less ${money(aid)} in likely aid) against a ${money(budget)} budget`);

  const score = bandForNet(net, budget, warnings);
  const confidence: DimensionResult["confidence"] = f.avgMeritAid !== undefined || f.avgAthleticAid !== undefined || f.avgNeedAid !== undefined ? "high" : "medium";
  return { score: clampScore(score), confidence, veto: false, reasons, warnings };
}

// docs/MATCHING_CONTRACT.md: at or under budget scores 85 plus up to
// 15 for the margin; within a quarter over, 60; within half over, 40;
// further, 20. One place, used for an estimate and for an award letter
// alike.
function bandForNet(net: number, budget: number, warnings: string[]): number {
  if (net <= budget) {
    const margin = budget > 0 ? (budget - net) / budget : 1;
    return NET_COST_BANDS.underBudget + Math.min(1, margin) * NET_COST_BANDS.underBudgetBonusMax;
  }
  if (net <= budget * 1.25) {
    warnings.push(`About ${money(net - budget)} a year over budget`);
    return NET_COST_BANDS.within25Over;
  }
  if (net <= budget * 1.5) {
    warnings.push(`About ${money(net - budget)} a year over budget`);
    return NET_COST_BANDS.within50Over;
  }
  warnings.push(`About ${money(net - budget)} a year over budget: this school does not make sense financially without more aid`);
  return NET_COST_BANDS.further;
}

// An applied award letter: the actual net cost for this athlete at
// this school. Replaces the estimate entirely, because a number the
// school put in writing beats an average of what it gives other people.
function scoreKnownAid(athlete: Athlete, aid: KnownAid): DimensionResult {
  const label = `the award letter${aid.academicYear ? ` for ${aid.academicYear}` : ""}`;
  const net = Math.max(0, aid.netCost);
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (athlete.familyBudgetCents !== undefined && athlete.familyBudgetCents > 0) {
    const budget = athlete.familyBudgetCents / 100;
    reasons.push(`Net cost ${money(net)} a year from ${label}${aid.totalCost ? ` (${money(aid.totalCost)} before aid)` : ""} against a ${money(budget)} budget`);
    const score = bandForNet(net, budget, warnings);
    return { score: clampScore(score), confidence: "high", veto: false, reasons, warnings };
  }
  reasons.push(`Net cost ${money(net)} a year from ${label}`);
  warnings.push("No family budget on file: add one for a net-cost fit");
  return { score: 55, confidence: "low", veto: false, reasons, warnings };
}

export function scoreFinancial(athlete: Athlete, school: School, aid?: KnownAid): DimensionResult {
  if (aid && Number.isFinite(aid.netCost)) return scoreKnownAid(athlete, aid);
  return scoreFinancialEstimate(athlete, school);
}

function scoreFinancialEstimate(athlete: Athlete, school: School): DimensionResult {
  const f = school.financials;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!f) {
    return { score: 50, confidence: "unknown", veto: false, reasons, warnings: ["No financial data available for this school"] };
  }

  if (athlete.familyBudgetCents !== undefined && athlete.familyBudgetCents > 0) {
    const budgeted = scoreAgainstBudget(athlete, school, athlete.familyBudgetCents / 100);
    if (budgeted) return budgeted;
  }

  // No family budget on file: the school-only model, reported as low
  // confidence because it cannot say whether the school makes sense for
  // this family.
  const schoolOnly = scoreSchoolOnly(athlete, school);
  if (schoolOnly.confidence !== "unknown") {
    schoolOnly.confidence = "low";
    schoolOnly.warnings.push("No family budget on file: add one for a net-cost fit");
  }
  return schoolOnly;
}

function scoreSchoolOnly(athlete: Athlete, school: School): DimensionResult {
  const f = school.financials!;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const cost = f.outstateTotal || f.instateTotal || 0;

  if (isD3(school.division)) {
    reasons.push("D3 school: athletic scholarships are not allowed by NCAA rules (unrelated to the House settlement)");
    const totalAcademicAid = (f.avgMeritAid || 0) + (f.avgNeedAid || 0);
    let score = 50;
    let confidence: DimensionResult["confidence"] = "low";
    if (totalAcademicAid > 0 && cost > 0) {
      const coveragePct = totalAcademicAid / cost;
      score = 40 + Math.min(coveragePct, 1) * 50;
      confidence = "high";
      reasons.push(`Academic + need aid covers ~${Math.round(coveragePct * 100)}% of cost`);
    } else if (cost > 0) {
      score = 45;
      confidence = "low";
      warnings.push(`Cost of attendance: $${Math.round(cost / 1000)}k/yr, merit aid potential unknown: check the financial aid office`);
    } else {
      return { score: 50, confidence: "unknown", veto: false, reasons, warnings: ["No cost or aid data for this D3 school"] };
    }
    const gpa = athlete.gpa || 0;
    if (gpa >= 3.7) {
      score += 10;
      reasons.push("Strong GPA opens merit-aid possibilities at D3");
    } else if (gpa >= 3.4) {
      score += 5;
      reasons.push("Solid GPA may qualify for some merit aid");
    }
    return { score: clampScore(score), confidence, veto: false, reasons, warnings };
  }

  // D1/D2/NAIA/JUCO: scholarship-type model.
  const schType = f.athleticScholarship;
  const avgAid = f.avgAthleticAid || 0;
  let score = 50;
  let confidence: DimensionResult["confidence"] = "unknown";

  if (schType) {
    confidence = "medium";
    if (schType === "full") {
      score += 30;
      reasons.push("Full athletic scholarships available");
    } else if (schType === "partial") {
      score += 15;
      reasons.push("Partial athletic scholarships available");
    } else {
      score -= 10;
      reasons.push("No athletic scholarships (academic aid only)");
    }
  }

  if (avgAid > 0 && cost > 0) {
    confidence = "high";
    const aidPct = avgAid / cost;
    if (aidPct >= 0.5) {
      score += 20;
      reasons.push(`Average aid covers ${Math.round(aidPct * 100)}% of cost`);
    } else if (aidPct >= 0.25) {
      score += 8;
      reasons.push(`Average aid covers ${Math.round(aidPct * 100)}% of cost`);
    } else {
      score -= 10;
      warnings.push(`Average aid covers only ${Math.round(aidPct * 100)}% of cost`);
    }
  }

  if (cost > 0) reasons.push(`Cost of attendance: $${Math.round(cost / 1000)}k/yr`);

  // D1 post-House-settlement signal: roster caps replaced scholarship
  // caps for opted-in D1 programs, so open roster spots (not scholarship
  // slots) is the more current constraint to surface. D2 is unaffected
  // and stays on the scholarship-type model above alone.
  if (isD1(school.division) && f.rosterSpotsOpen !== undefined) {
    confidence = confidence === "unknown" ? "medium" : confidence;
    if (f.rosterSpotsOpen <= 0) {
      score -= 10;
      warnings.push("Roster reported full under post-House-settlement roster limits: confirm open spots with the coaching staff");
    } else if (f.rosterSpotsOpen <= 3) {
      warnings.push(`Only ${f.rosterSpotsOpen} roster spot(s) reported open under the new roster-limit rules`);
    }
  }

  if (!schType && !avgAid && !cost) {
    return { score: 50, confidence: "unknown", veto: false, reasons, warnings: ["No financial data returned for this school"] };
  }

  return { score: clampScore(score), confidence, veto: false, reasons, warnings };
}
