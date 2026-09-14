// Academic fit dimension. Replaces Bridge's calcAcademicFitTag
// (bffsa-site/index.html ~line 10956). Same inputs (GPA, course rigor,
// SAT/ACT, major availability, division defaults as a fallback), one
// continuous 0-100 score instead of a tag decided by four nested
// tag-reassignment branches (baseTag, then EX-11 shifts it up or down
// a level, then the combiner in calcCollegeFit can shift it again).

import type { Athlete, DimensionResult, School } from "./types";
import { clampScore } from "./bands";

// Ported from Bridge's inline divDefaults / divDef2 maps in
// calcAcademicFitTag. Used only when the school profile has no
// school-specific GPA data.
const DIVISION_GPA_DEFAULTS: Record<string, number> = {
  D1: 3.0,
  D2: 2.5,
  D3: 2.5,
  NAIA: 2.3,
  JUCO: 2.0,
  "JUCO D1": 2.3,
  "JUCO D2": 2.0,
  "JUCO D3": 2.0,
};

function courseRigorBoost(athlete: Athlete): { boost: number; note: string } {
  if (athlete.detail?.kind !== "hs") return { boost: 0, note: "" };
  const { apCount = 0, ibCount = 0, honorsCount = 0, dualCount = 0 } = athlete.detail;
  const rigorTotal = apCount + ibCount + honorsCount * 0.5 + dualCount * 0.7;
  if (rigorTotal <= 0) return { boost: 0, note: "" };
  // Per AP-equivalent class, +0.02, capped at +0.20 (ported as-is: this is
  // admin-tuned data, not a patch, per docs/ARCHITECTURE.md).
  const boost = Math.min(0.2, rigorTotal * 0.02);
  return { boost, note: `${rigorTotal.toFixed(1)} AP-equivalent courses (+${boost.toFixed(2)} rigor)` };
}

function testScoreShift(athlete: Athlete, school: School): { shift: number; note: string } {
  const satTotal = athlete.detail?.kind === "hs" ? athlete.detail.satTotal : undefined;
  const actComposite = athlete.detail?.kind === "hs" ? athlete.detail.actComposite : undefined;
  const parseRange = (s: string | undefined): { low: number; high: number } | null => {
    if (!s) return null;
    const m = s.match(/(\d+)\s*[-–to]+\s*(\d+)/);
    return m ? { low: parseInt(m[1], 10), high: parseInt(m[2], 10) } : null;
  };
  const satR = parseRange(school.academics?.satRange);
  const actR = parseRange(school.academics?.actRange);
  if (satTotal && satR) {
    if (satTotal >= satR.high) return { shift: 8, note: `SAT ${satTotal} at/above 75th %ile (${satR.high})` };
    if (satTotal >= satR.low) return { shift: 3, note: `SAT ${satTotal} within school range (${satR.low}-${satR.high})` };
    return { shift: -8, note: `SAT ${satTotal} below typical range (${satR.low}-${satR.high})` };
  }
  if (actComposite && actR) {
    if (actComposite >= actR.high) return { shift: 8, note: `ACT ${actComposite} at/above 75th %ile (${actR.high})` };
    if (actComposite >= actR.low) return { shift: 3, note: `ACT ${actComposite} within school range (${actR.low}-${actR.high})` };
    return { shift: -8, note: `ACT ${actComposite} below typical range (${actR.low}-${actR.high})` };
  }
  return { shift: 0, note: "" };
}

export function scoreAcademic(athlete: Athlete, school: School): DimensionResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // Major availability is advisory only: it informs the family, it never
  // moves the score. Same as Bridge's majorNote.
  const desiredMajor = athlete.detail?.desiredMajor;
  if (desiredMajor) {
    const ma = school.academics?.majorAvailability?.[desiredMajor];
    if (ma?.offered === false) warnings.push(`${desiredMajor} not offered at this school`);
    else if (ma?.offered === true) reasons.push(`${desiredMajor} is offered${ma.accreditationNotes ? ` (${ma.accreditationNotes})` : ""}`);
    else warnings.push(`Major availability for "${desiredMajor}" not verified yet`);
  }

  // GPA source: HS athletes use gpa + rigor boost; transfers use college
  // GPA (what a receiving school actually evaluates), falling back to gpa
  // if collegeGpa isn't on file yet.
  const detail = athlete.detail;
  const rawGpa = detail?.kind === "transfer" ? detail.collegeGpa ?? athlete.gpa : athlete.gpa;
  const { boost, note: rigorNote } = courseRigorBoost(athlete);
  const adjustedGpa = rawGpa ? Math.round((rawGpa + boost) * 100) / 100 : undefined;
  const verifiedNote = athlete.gpaVerified ? "" : " (unverified)";

  if (adjustedGpa === undefined) {
    return {
      score: 50,
      confidence: "unknown",
      veto: false,
      reasons,
      warnings: [...warnings, "No GPA on file: enter GPA for an accurate academic fit"],
    };
  }

  const gpaMin = school.academics?.gpaMin;
  const gpaAvg = school.academics?.gpaAvg;
  const hasSchoolData = gpaMin !== undefined || gpaAvg !== undefined;

  const div = (school.division || "").toUpperCase().trim();
  const fallbackMin = DIVISION_GPA_DEFAULTS[div];

  const gpaDisplay = `${rawGpa}${boost > 0 ? ` -> ${adjustedGpa} adjusted` : ""}${verifiedNote}`;
  const rigorSuffix = rigorNote ? ` (${rigorNote})` : "";

  if (!hasSchoolData) {
    if (fallbackMin === undefined) {
      return { score: 50, confidence: "unknown", veto: false, reasons, warnings: [...warnings, "No academic data for this school and no division default: verify manually"] };
    }
    if (adjustedGpa < fallbackMin) {
      return {
        score: clampScore(20 + (adjustedGpa - fallbackMin) * 30),
        confidence: "low",
        veto: true,
        reasons: [`GPA ${gpaDisplay} is below the typical ${div} minimum (${fallbackMin})${rigorSuffix}: using division defaults, no school-specific data`],
        warnings,
      };
    }
    const gap = adjustedGpa - fallbackMin;
    return {
      score: clampScore(55 + Math.min(gap, 1) * 30),
      confidence: "low",
      veto: false,
      reasons: [`GPA ${gpaDisplay} is above the typical ${div} floor (${fallbackMin})${rigorSuffix}: using division defaults, no school-specific data`],
      warnings,
    };
  }

  const min = gpaMin ?? fallbackMin ?? 0;
  if (adjustedGpa < min) {
    return {
      score: clampScore(15 + (adjustedGpa - min) * 30),
      confidence: "high",
      veto: true,
      reasons: [`GPA ${gpaDisplay} is below ${school.division}'s minimum of ${min}${rigorSuffix}`],
      warnings,
    };
  }

  const { shift, note: testNote } = testScoreShift(athlete, school);
  if (testNote) reasons.push(testNote);

  let score: number;
  if (gpaAvg && gpaAvg > 0) {
    // Map the GPA gap onto a 0-1 line from the floor to the school's
    // average admit, then place 55 at the floor and 85 at (or above) the
    // average, instead of Bridge's four hand-picked bands.
    const span = Math.max(gpaAvg - min, 0.1);
    const pos = (adjustedGpa - min) / span;
    score = 55 + Math.min(pos, 1.3) * 27;
    reasons.push(
      adjustedGpa >= gpaAvg
        ? `GPA ${gpaDisplay} meets or exceeds the average admitted student (${gpaAvg})${rigorSuffix}`
        : `GPA ${gpaDisplay} is above the minimum (${min}) but below the average admit (${gpaAvg})${rigorSuffix}`
    );
  } else {
    const gap = adjustedGpa - min;
    score = 55 + Math.min(gap, 1) * 30;
    reasons.push(`GPA ${gpaDisplay} is above the minimum (${min})${rigorSuffix}`);
  }

  return {
    score: clampScore(score + shift),
    confidence: "high",
    veto: false,
    reasons,
    warnings,
  };
}
