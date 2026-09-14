// Eligibility dimension - only computed for transfer_4to4, transfer_juco,
// and transfer_grad recruit types. Bridge never had this dimension; the
// original app only ever recruited high schoolers. Added per Dave's
// request to support the transfer portal (four-year, JUCO, and grad
// transfers), researched and verified against current NCAA transfer
// rules (see docs/BUSINESS_RULES.md for sourcing):
//
//   - transfer_juco (2-year -> 4-year, the "4-2-4 rule"): 2.5 cumulative
//     college GPA minimum, plus a full-time credit-hour completion
//     requirement (24 semester / 36 quarter hours per NCAA year).
//   - transfer_4to4: the one-time transfer exception grants immediate
//     eligibility for a first transfer, entered within the sport's
//     portal window, in academic good standing. A second transfer
//     generally needs an NCAA waiver, not covered by the exception.
//   - transfer_grad: requires a completed bachelor's degree and
//     remaining eligibility; uses short (~60 day), sport-specific grad
//     windows, separate from the undergrad primary window.
//   - Portal windows are NCAA-voted and change most years, so this file
//     never hardcodes a date. Without a matching TransferWindow row, a
//     timing check is reported as unverified, not guessed.

import type { Athlete, DimensionResult, School, TransferWindow } from "./types";
import { clampScore } from "./bands";

function findWindow(windows: TransferWindow[], sport: string, division: string, seasonYear: string, labelHint?: string): TransferWindow | undefined {
  const matches = windows.filter(
    (w) => w.sport.toLowerCase() === sport.toLowerCase() && w.division.toLowerCase() === division.toLowerCase() && w.seasonYear === seasonYear
  );
  if (labelHint) {
    const hinted = matches.find((w) => w.windowLabel.toLowerCase().includes(labelHint));
    if (hinted) return hinted;
  }
  return matches[0];
}

export function scoreEligibility(athlete: Athlete, school: School, transferWindows: TransferWindow[] = [], today: Date = new Date()): DimensionResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (athlete.detail?.kind !== "transfer") {
    return { score: 50, confidence: "unknown", veto: false, reasons, warnings: ["Athlete detail is not a transfer profile: eligibility not evaluated"] };
  }

  const detail = athlete.detail;

  if (detail.eligibilityYearsRemaining <= 0) {
    return { score: 10, confidence: "high", veto: true, reasons, warnings: ["No NCAA eligibility years remaining"] };
  }

  let score = 75;
  let confidence: DimensionResult["confidence"] = "medium";

  if (athlete.recruitType === "transfer_juco") {
    if (detail.collegeGpa === undefined) {
      warnings.push("No college GPA on file: JUCO transfers require a 2.5 cumulative GPA minimum");
      confidence = "low";
    } else if (detail.collegeGpa < 2.5) {
      return { score: 15, confidence: "high", veto: true, reasons, warnings: [`College GPA ${detail.collegeGpa} is below the 2.5 minimum required for a JUCO-to-4-year transfer`] };
    } else {
      reasons.push(`College GPA ${detail.collegeGpa} meets the 2.5 JUCO transfer minimum`);
      confidence = "high";
    }
    if (detail.creditHoursCompleted !== undefined && detail.creditHoursCompleted < 24) {
      warnings.push(`${detail.creditHoursCompleted} credit hours completed: below the 24 semester / 36 quarter hour full-time transfer requirement`);
      score -= 15;
    }
  }

  if (athlete.recruitType === "transfer_grad") {
    if (!detail.degreeCompleted) {
      return { score: 15, confidence: "high", veto: true, reasons, warnings: ["Graduate transfer eligibility requires a completed bachelor's degree"] };
    }
    reasons.push("Bachelor's degree completed: eligible for graduate transfer rules");
    confidence = "high";
  }

  if (athlete.recruitType === "transfer_4to4") {
    if (detail.transferCount >= 2) {
      warnings.push("Second transfer typically requires an NCAA waiver for immediate eligibility, not covered by the one-time transfer exception");
      score -= 10;
    } else {
      reasons.push("First transfer: covered by the one-time transfer exception");
    }
  }

  // Portal window timing. Only checked if the caller supplied real window
  // data; never fabricated.
  if (detail.portalEntryDate) {
    const seasonYear = detail.portalEntryDate.slice(0, 4);
    const labelHint = athlete.recruitType === "transfer_grad" ? "grad" : undefined;
    const window = findWindow(transferWindows, athlete.sport, school.division, seasonYear, labelHint);
    if (window) {
      const entry = new Date(detail.portalEntryDate);
      const opens = new Date(window.opensOn);
      const closes = new Date(window.closesOn);
      if (entry < opens || entry > closes) {
        return {
          score: 20,
          confidence: "high",
          veto: true,
          reasons,
          warnings: [`Portal entry date ${detail.portalEntryDate} falls outside the ${window.windowLabel} window (${window.opensOn} - ${window.closesOn})`],
        };
      }
      reasons.push(`Portal entry date falls within the ${window.windowLabel} window`);
      confidence = "high";
    } else {
      warnings.push("Transfer portal window not on file for this sport/division/season: verify entry-date timing with the NCAA or conference before assuming eligibility");
    }
  } else {
    warnings.push("No portal entry date on file: timing eligibility not verified");
  }

  if (detail.portalEntryDate && new Date(detail.portalEntryDate) > today) {
    warnings.push("Portal entry date is in the future: athlete has not yet entered the portal");
  }

  return { score: clampScore(score), confidence, veto: false, reasons, warnings };
}
