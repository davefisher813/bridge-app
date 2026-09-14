// Athletic fit dimension. Replaces Bridge's calcAthleticFitTag +
// _calcAthleticFitNonBaseball (bffsa-site/index.html ~line 11325 and
// ~11448), which were two separate functions with two separate scoring
// styles (tier-lookup for baseball/softball, tier-multiplier for
// everything else) glued together with an if-sport-is-baseball branch.
// Here both paths run through the same evaluateChecks() so a "veto" and
// a "score" mean the same thing regardless of sport.

import type { Athlete, DimensionResult, School } from "./types";
import { BASEBALL_SOFTBALL_POSITIONS, divisionToTier } from "./benchmarks";
import { clampScore } from "./bands";

function normalizeSport(s: string | undefined): string {
  const raw = (s || "").toLowerCase().trim();
  if (!raw) return "";
  if (raw.includes("baseball")) return "baseball";
  if (raw.includes("softball")) return "softball";
  if (raw.includes("basketball") || raw.includes("hoops")) return "basketball";
  if (raw.includes("football") || raw === "fb") return "football";
  if (raw.includes("soccer")) return "soccer";
  if (raw.includes("volleyball")) return "volleyball";
  if (raw.includes("lacrosse") || raw === "lax") return "lacrosse";
  return raw;
}

function baseballPositionGroup(position: string | undefined): string | null {
  const pos = (position || "").toUpperCase();
  if (/LHP/.test(pos)) return "lhp";
  if (/RHP|SP|RP|P\b/.test(pos)) return "rhp";
  if (/SS|2B|CF|MIF/.test(pos)) return "middle_inf";
  if (/1B|3B|LF|RF|DH|OF/.test(pos)) return "corner";
  if (/C\b|CATCH/.test(pos)) return "catcher";
  return null;
}

interface CheckResult {
  score: number; // 0 (conflict), 1 (near), or 2 (meets/exceeds)
  label: string;
  conflict: boolean;
}

function runCheck(actual: number | undefined, threshold: number, lowerIsBetter: boolean, label: string, unit: string, nearFactor = 0.92): CheckResult | null {
  if (actual === undefined || actual === null || Number.isNaN(actual)) return null;
  const pass = lowerIsBetter ? actual <= threshold : actual >= threshold;
  const near = lowerIsBetter ? actual <= threshold * (2 - nearFactor) : actual >= threshold * nearFactor;
  if (pass) return { score: 2, label: `${label} ${actual}${unit} meets target (${threshold.toFixed(1)}${unit})`, conflict: false };
  if (near) return { score: 1, label: `${label} ${actual}${unit} near target (${threshold.toFixed(1)}${unit})`, conflict: false };
  return { score: 0, label: `${label} ${actual}${unit} below target (${threshold.toFixed(1)}${unit})`, conflict: true };
}

// Non-baseball benchmarks, ported from _calcAthleticFitNonBaseball. Tier
// multiplier scales a base (mid_d1-equivalent) threshold per division tier,
// same as the original: elite_d1 stricter, juco more permissive.
const TIER_MULTIPLIER: Record<string, number> = { elite_d1: 1.1, mid_d1: 1.0, d2_naia: 0.92, juco: 0.85 };

type SportCheckSpec = { key: string; threshold: number; lowerIsBetter: boolean; label: string; unit: string };

function positionGroupFor(sport: string, position: string | undefined): string {
  const pos = (position || "").toUpperCase();
  if (sport === "basketball") {
    if (/PG|POINT/.test(pos)) return "bb_pg";
    if (/SG|SHOOT/.test(pos)) return "bb_sg";
    if (/SF/.test(pos)) return "bb_sf";
    if (/PF/.test(pos)) return "bb_pf";
    if (/^C\b|CENTER/.test(pos)) return "bb_c";
    if (/G\b|GUARD/.test(pos)) return "bb_g";
    return "bb_g";
  }
  if (sport === "soccer") {
    if (/GK|GOALIE|KEEPER/.test(pos)) return "sc_gk";
    if (/CB|DEF|FULLBACK|FB|LB|RB|D\b/.test(pos)) return "sc_def";
    if (/ST|FW|WING|FORWARD|F\b|W\b/.test(pos)) return "sc_fw";
    return "sc_mid";
  }
  if (sport === "football") {
    if (/QB/.test(pos)) return "fb_qb";
    if (/RB|HB/.test(pos)) return "fb_rb";
    if (/WR|TE/.test(pos)) return "fb_wr";
    if (/OL|OT|OG|OC/.test(pos)) return "fb_ol";
    if (/DL|DE|DT|NT/.test(pos)) return "fb_dl";
    if (/LB/.test(pos)) return "fb_lb";
    if (/CB|DB|S\b|FS|SS/.test(pos)) return "fb_db";
    return "fb_skill";
  }
  return "";
}

function nonBaseballSpecs(sport: string, posGroup: string, m: Record<string, number>): SportCheckSpec[] {
  const specs: SportCheckSpec[] = [];
  if (sport === "basketball") {
    const heightTargets: Record<string, number> = { bb_pg: 72, bb_sg: 74, bb_sf: 78, bb_pf: 80, bb_c: 81, bb_g: 73 };
    if (heightTargets[posGroup] && (m.heightIn ?? m.height) !== undefined) specs.push({ key: "heightIn", threshold: heightTargets[posGroup], lowerIsBetter: false, label: "Height", unit: '"' });
    specs.push({ key: "ppg", threshold: posGroup === "bb_pg" || posGroup === "bb_sg" || posGroup === "bb_g" ? 18 : 12, lowerIsBetter: false, label: "PPG", unit: "" });
    specs.push({ key: "rpg", threshold: posGroup === "bb_c" || posGroup === "bb_pf" ? 8 : 4, lowerIsBetter: false, label: "RPG", unit: "" });
    specs.push({ key: "apg", threshold: posGroup === "bb_pg" ? 5 : 2, lowerIsBetter: false, label: "APG", unit: "" });
    if (m.threePtPct !== undefined) specs.push({ key: "threePtPct", threshold: 33, lowerIsBetter: false, label: "3PT%", unit: "%" });
  } else if (sport === "soccer") {
    if (posGroup === "sc_gk") {
      specs.push({ key: "cleanSheets", threshold: 4, lowerIsBetter: false, label: "Clean sheets", unit: "" });
      specs.push({ key: "savePct", threshold: 70, lowerIsBetter: false, label: "Save %", unit: "%" });
    } else if (posGroup === "sc_fw") {
      specs.push({ key: "goals", threshold: 10, lowerIsBetter: false, label: "Goals", unit: "" });
    } else if (posGroup === "sc_mid") {
      specs.push({ key: "assists", threshold: 5, lowerIsBetter: false, label: "Assists", unit: "" });
      specs.push({ key: "goals", threshold: 5, lowerIsBetter: false, label: "Goals", unit: "" });
    } else if (posGroup === "sc_def") {
      specs.push({ key: "cleanSheets", threshold: 4, lowerIsBetter: false, label: "Clean sheets", unit: "" });
    }
  } else if (sport === "football") {
    const fortyTargets: Record<string, number> = { fb_qb: 4.8, fb_rb: 4.55, fb_wr: 4.55, fb_ol: 5.3, fb_dl: 5.0, fb_lb: 4.7, fb_db: 4.55, fb_skill: 4.7 };
    const benchTargets: Record<string, number> = { fb_ol: 300, fb_dl: 300, fb_lb: 250, fb_rb: 225, fb_wr: 185, fb_qb: 185, fb_db: 200, fb_skill: 200 };
    specs.push({ key: "fortyTime", threshold: fortyTargets[posGroup] ?? 4.7, lowerIsBetter: true, label: "40 time", unit: "s" });
    if (m.bench !== undefined) specs.push({ key: "bench", threshold: benchTargets[posGroup] ?? 225, lowerIsBetter: false, label: "Bench", unit: "lb" });
  } else if (sport === "volleyball") {
    if ((m.heightIn ?? m.height) !== undefined) specs.push({ key: "heightIn", threshold: 73, lowerIsBetter: false, label: "Height", unit: '"' });
    specs.push({ key: "verticalJump", threshold: 26, lowerIsBetter: false, label: "Vertical", unit: '"' });
  } else if (sport === "lacrosse") {
    specs.push({ key: "goals", threshold: 15, lowerIsBetter: false, label: "Goals", unit: "" });
    specs.push({ key: "assists", threshold: 10, lowerIsBetter: false, label: "Assists", unit: "" });
  }
  return specs;
}

export function scoreAthletic(athlete: Athlete, school: School): DimensionResult {
  const sport = normalizeSport(athlete.sport);

  if (sport && school.sportsSponsored.length > 0 && !school.sportsSponsored.map((s) => normalizeSport(s)).includes(sport)) {
    return { score: 0, confidence: "high", veto: true, reasons: [], warnings: [`School does not sponsor ${athlete.sport || "this sport"}`] };
  }

  const tier = divisionToTier(school.division);
  const m = athlete.measurables || {};
  const reasons: string[] = [];
  const warnings: string[] = [];
  let checks = 0;
  let rawScore = 0;
  let hasConflict = false;

  const record = (r: CheckResult | null) => {
    if (!r) return;
    checks++;
    rawScore += r.score;
    if (r.conflict) {
      hasConflict = true;
      warnings.push(r.label);
    } else if (r.score === 2) {
      reasons.push(r.label);
    } else {
      warnings.push(r.label);
    }
  };

  if (sport === "baseball" || sport === "softball") {
    const posGroup = baseballPositionGroup(athlete.position);
    if (!posGroup) {
      return { score: 50, confidence: "unknown", veto: false, reasons, warnings: ["Position not set: enter position to calculate athletic fit"] };
    }
    const posData = BASEBALL_SOFTBALL_POSITIONS.find((p) => p.id === posGroup);
    const tierBm = posData?.metrics.find((bm) => bm.tier === tier);
    if (!tierBm) {
      return { score: 50, confidence: "unknown", veto: false, reasons, warnings: ["No benchmarks for this position/division"] };
    }
    if (posGroup === "rhp" || posGroup === "lhp") {
      record(runCheck(m.fbVelo, tierBm.fbIdeal ?? 0, false, "FB velo", " mph", (tierBm.fbMin ?? 0) / (tierBm.fbIdeal || 1)));
    } else {
      record(runCheck(m.sixty, tierBm.sixtyMax ?? 0, true, "60 time", "s", (tierBm.sixtyIdeal ?? 0) / (tierBm.sixtyMax || 1)));
      if (tierBm.exitVelo) record(runCheck(m.exitVelo, tierBm.exitVelo, false, "Exit velo", " mph", 1 - 5 / tierBm.exitVelo));
      // Bridge's original fell back to exitVelo when infieldVelo was
      // missing (armV = m.infieldVelo||m.exitVelo) - that reused one
      // measurable as a stand-in for an unrelated one. Falling back to a
      // dedicated armVelo field instead of a different metric entirely.
      const armThresh = posGroup === "middle_inf" || posGroup === "corner" ? tierBm.armInf : tierBm.armOf ?? tierBm.armInf;
      if (armThresh) record(runCheck(m.infieldVelo ?? m.armVelo, armThresh, false, "Arm strength", " mph", 1 - 5 / armThresh));
      if (posGroup === "catcher" && tierBm.popTime) record(runCheck(m.popTime, tierBm.popTime, true, "Pop time", "s"));
    }
  } else {
    const posGroup = positionGroupFor(sport, athlete.position);
    const mult = TIER_MULTIPLIER[tier] ?? 1.0;
    const specs = nonBaseballSpecs(sport, posGroup, m);
    if (specs.length === 0) {
      return { score: 50, confidence: "unknown", veto: false, reasons, warnings: [`Athletic benchmarks for ${sport || "this sport"} are not yet modeled: academic and financial fit still apply`] };
    }
    for (const spec of specs) {
      const actual = m[spec.key];
      record(runCheck(actual, spec.threshold * mult, spec.lowerIsBetter, spec.label, spec.unit));
    }
  }

  if (checks === 0) {
    return { score: 50, confidence: "unknown", veto: false, reasons, warnings: ["No measurables on file: enter stats for an accurate athletic fit"] };
  }

  const pct = rawScore / (checks * 2);
  return {
    score: clampScore(pct * 100),
    confidence: checks >= 2 ? "high" : "medium",
    veto: hasConflict,
    reasons,
    warnings,
  };
}
