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

// The dates a window's season covers. A season is typed either as an
// academic year ("2026-27", which migration 0001 documents and the form
// suggests: July 1 2026 to June 30 2027) or as a calendar year ("2026").
// The window's own dates are folded in, so a window that opens a little
// before its season starts still counts. Comparing the season to the
// entry date's first four characters missed every "2026-27" row.
function seasonSpan(w: TransferWindow): { from: string; to: string } | null {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(w.seasonYear.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const from = m[2] ? `${start}-07-01` : `${start}-01-01`;
  const to = m[2] ? `${start + 1}-06-30` : `${start}-12-31`;
  return { from: w.opensOn < from ? w.opensOn : from, to: w.closesOn > to ? w.closesOn : to };
}

// Every window on file for this sport and division whose season covers
// the entry date. A grad transfer is judged against the grad windows
// when there are any, everyone else against the others, so a short grad
// window never stands in for the primary one (or the reverse).
function windowsForEntry(windows: TransferWindow[], sport: string, division: string, entryDate: string, grad: boolean): TransferWindow[] {
  const matches = windows.filter((w) => {
    if (w.sport.toLowerCase() !== sport.toLowerCase() || w.division.toLowerCase() !== division.toLowerCase()) return false;
    const span = seasonSpan(w);
    return span !== null && entryDate >= span.from && entryDate <= span.to;
  });
  const isGrad = (w: TransferWindow) => w.windowLabel.toLowerCase().includes("grad");
  const preferred = matches.filter((w) => isGrad(w) === grad);
  return preferred.length > 0 ? preferred : matches;
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
    const entryDate = detail.portalEntryDate.slice(0, 10);
    const candidates = windowsForEntry(transferWindows, athlete.sport, school.division, entryDate, athlete.recruitType === "transfer_grad");
    if (candidates.length > 0) {
      // A sport can have more than one window a season (football's
      // winter and spring). The entry is on time if any of them holds
      // it, and vetoed only when none does.
      const holding = candidates.find((w) => entryDate >= w.opensOn && entryDate <= w.closesOn);
      if (!holding) {
        const named = candidates.map((w) => `${w.windowLabel} (${w.opensOn} - ${w.closesOn})`).join(", ");
        return {
          score: 20,
          confidence: "high",
          veto: true,
          reasons,
          warnings: [`Portal entry date ${detail.portalEntryDate} falls outside every window on file for its season: ${named}`],
        };
      }
      reasons.push(`Portal entry date falls within the ${holding.windowLabel} window`);
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
