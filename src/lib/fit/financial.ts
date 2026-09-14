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

import type { Athlete, DimensionResult, School } from "./types";
import { isD1, isD3 } from "./benchmarks";
import { clampScore } from "./bands";

export function scoreFinancial(athlete: Athlete, school: School): DimensionResult {
  const f = school.financials;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!f) {
    return { score: 50, confidence: "unknown", veto: false, reasons, warnings: ["No financial data available for this school"] };
  }

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
