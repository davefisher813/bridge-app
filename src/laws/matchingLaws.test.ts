// THE MATCHING LAWS, AS TESTS. Every rule here is a line in
// docs/MATCHING_CONTRACT.md, and every number comes from
// src/lib/fit/contract.ts so a changed number changes the app and the
// test together. See README.md in this folder.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreFit } from "../lib/fit/score";
import { scoreAthletic } from "../lib/fit/athletic";
import { scoreFinancial } from "../lib/fit/financial";
import { selectScoringMetrics } from "../lib/fit/metrics";
import { BANDS, GOAL_SHIFT, GRADE_WEIGHT, NET_COST_BANDS, POSITIONAL_NEED_BOOST, PRESETS, blendWeights, gradeToScore } from "../lib/fit/contract";
import { scoreToTag } from "../lib/fit/bands";
import type { Athlete, School } from "../lib/fit/types";

const rhp = (extra: Partial<Athlete> = {}): Athlete => ({ id: "a", orgId: "o", recruitType: "hs", name: "T", sport: "baseball", position: "RHP", gpa: 3.4, gpaVerified: true, detail: { kind: "hs", gradYear: 2027 }, ...extra });
const mif = (extra: Partial<Athlete> = {}): Athlete => ({ id: "a", orgId: "o", recruitType: "hs", name: "T", sport: "baseball", position: "SS", gpa: 3.4, gpaVerified: true, detail: { kind: "hs", gradYear: 2027 }, ...extra });
const d2 = (extra: Partial<School> = {}): School => ({
  id: "s",
  name: "Fixture State University",
  division: "D2",
  state: "CT",
  sportsSponsored: ["baseball"],
  academics: { gpaMin: 2.5, gpaAvg: 3.2 },
  financials: { athleticScholarship: "partial", avgAthleticAid: 9000, avgMeritAid: 6000, avgNeedAid: 4000, outstateTotal: 38000, instateTotal: 24000 },
  ...extra,
});

describe("LAW: the primary number under its floor is a conflict, anything else below target is not", () => {
  // Verified this law bites: removed the primaryFloor() call from
  // athletic.ts, ran this file, watched the first case fail (veto was
  // false), restored it.
  it("a pitcher under the tier's FB floor is vetoed", () => {
    const r = scoreAthletic(rhp({ measurables: { fbVelo: 80 } }), d2()); // d2_naia floor is 82
    expect(r.veto).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/under the 82 mph floor/);
  });
  it("a pitcher over the floor but under the ideal is a low score, not a conflict", () => {
    const r = scoreAthletic(rhp({ measurables: { fbVelo: 83 } }), d2()); // ideal 86
    expect(r.veto).toBe(false);
    expect(r.score).toBeLessThan(100);
  });
  it("a position player over the 60 max is vetoed; an arm below target alone is not", () => {
    expect(scoreAthletic(mif({ measurables: { sixty: 7.6 } }), d2()).veto).toBe(true); // max 7.3
    const r = scoreAthletic(mif({ measurables: { sixty: 7.0, armVelo: 60 } }), d2());
    expect(r.veto).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/Arm strength 60/);
  });
});

describe("LAW: staff grades blend in by position group and never replace a floor", () => {
  it("a catcher's grades carry half the athletic score", () => {
    expect(GRADE_WEIGHT.catcher).toBe(0.5);
    const c = (grades?: Record<string, number>): Athlete => mif({ position: "C", measurables: { popTime: 2.0, sixty: 7.0, armVelo: 80, exitVelo: 85 }, grades });
    const without = scoreAthletic(c(), d2()).score;
    const with80 = scoreAthletic(c({ frame: 80, athleticism: 80, skill: 80, iq: 80, competitiveness: 80 }), d2()).score;
    expect(with80).toBeCloseTo(without * 0.5 + 100 * 0.5, 0);
  });
  it("20 scores 0, 50 scores 50, 80 scores 100", () => {
    expect(gradeToScore(20)).toBe(0);
    expect(gradeToScore(50)).toBe(50);
    expect(gradeToScore(80)).toBe(100);
  });
  it("grades alone give a low-confidence score when nothing is logged", () => {
    const r = scoreAthletic(mif({ grades: { skill: 65 } }), d2());
    expect(r.confidence).toBe("low");
    expect(r.veto).toBe(false);
  });
});

describe("LAW: the scoring entry is the best verified number, else the most recent, and its source sets confidence", () => {
  it("a Premier number beats a better self-reported one", () => {
    const s = selectScoringMetrics([
      { id: "1", metric: "fbVelo", value: 86, measuredOn: "2026-08-15", source: "premier" },
      { id: "2", metric: "fbVelo", value: 88, measuredOn: "2026-09-01", source: "self" },
    ]);
    expect(s.measurables.fbVelo).toBe(86);
    expect(s.confidence.fbVelo).toBe("high");
    expect(s.scoredEntryId.fbVelo).toBe("1");
  });
  it("within the best tier the best value wins, and lower is better for a time", () => {
    const s = selectScoringMetrics([
      { id: "1", metric: "sixty", value: 6.9, measuredOn: "2026-07-20", source: "pbr" },
      { id: "2", metric: "sixty", value: 6.8, measuredOn: "2026-05-01", source: "perfect_game" },
      { id: "3", metric: "sixty", value: 6.6, measuredOn: "2026-09-14", source: "coach" },
    ]);
    expect(s.measurables.sixty).toBe(6.8);
  });
  it("self-reported only: the most recent, at low confidence", () => {
    const s = selectScoringMetrics([
      { id: "1", metric: "exitVelo", value: 95, measuredOn: "2026-05-01", source: "self" },
      { id: "2", metric: "exitVelo", value: 90, measuredOn: "2026-09-01", source: "self" },
    ]);
    expect(s.measurables.exitVelo).toBe(90);
    expect(s.confidence.exitVelo).toBe("low");
  });
  it("the athletic dimension reports the source's confidence", () => {
    const r = scoreAthletic(rhp({ measurables: { fbVelo: 86 }, measurableConfidence: { fbVelo: "low" } }), d2());
    expect(r.confidence).toBe("low");
  });
});

describe("LAW: offers, visits and messages are shown, never scored", () => {
  // Verified this law bites: put the old "score = Math.max(score, 88)"
  // offer floor back into score.ts, ran this file, watched it fail,
  // removed it again.
  it("the same athlete and school score the same with and without an offer, and the offer is echoed", () => {
    const a = rhp({ measurables: { fbVelo: 84 } });
    const plain = scoreFit(a, d2());
    const offered = scoreFit(a, d2(), { signals: { offer: { offerType: "scholarship", scholarshipPercent: 35 }, visitCount: 3, commCount: 9 } });
    expect(offered.score).toBe(plain.score);
    expect(offered.signals?.offer?.offerType).toBe("scholarship");
  });
});

describe("LAW: an unknown dimension is left out of the blend and the result says so", () => {
  it("no metrics and no grades: scored on academic and financial only, flagged partial", () => {
    const r = scoreFit(rhp({ familyBudgetCents: 1500000 }), d2());
    expect(r.athletic.confidence).toBe("unknown");
    expect(r.partial).toBe(true);
    expect(r.counted).toEqual(["academic", "financial"]);
    expect(r.warnings[0]).toMatch(/Scored on academic and financial only/);
    const w = blendWeights("money_first", "balanced", false);
    const expected = (r.academic.score * w.academic + r.financial.score * w.financial) / (w.academic + w.financial);
    expect(r.score).toBe(Math.round(expected));
  });
  it("with metrics on file nothing is partial", () => {
    const r = scoreFit(rhp({ measurables: { fbVelo: 86 }, familyBudgetCents: 1500000 }), d2());
    expect(r.partial).toBe(false);
  });
});

describe("LAW: the blend is the org's preset shifted by the athlete's goal, and money leads by default", () => {
  it("every preset sums to one and Money First weighs financial highest", () => {
    for (const p of Object.values(PRESETS)) {
      const w = p.weights;
      expect(w.academic + w.athletic + w.financial).toBeCloseTo(1, 6);
    }
    expect(PRESETS.money_first.weights.financial).toBeGreaterThan(PRESETS.money_first.weights.academic);
    expect(PRESETS.money_first.weights.financial).toBeGreaterThan(PRESETS.money_first.weights.athletic);
    // Each named preset leads with what it is named for.
    expect(PRESETS.academics_first.weights.academic).toBeGreaterThan(PRESETS.academics_first.weights.athletic);
    expect(PRESETS.academics_first.weights.academic).toBeGreaterThan(PRESETS.academics_first.weights.financial);
    expect(PRESETS.baseball_first.weights.athletic).toBeGreaterThan(PRESETS.baseball_first.weights.academic);
  });
  it("the presets the app offers are the ones the database accepts", () => {
    const sql = readFileSync(join(process.cwd(), "migrations", "0030_academics_first_preset.sql"), "utf8");
    for (const key of Object.keys(PRESETS)) expect(sql).toContain(`'${key}'`);
  });
  it("Education First moves the shift from athletic to academic and leaves financial alone", () => {
    const b = blendWeights("balanced", "balanced", false);
    const e = blendWeights("balanced", "education", false);
    expect(e.academic).toBeCloseTo(b.academic + GOAL_SHIFT, 6);
    expect(e.athletic).toBeCloseTo(b.athletic - GOAL_SHIFT, 6);
    expect(e.financial).toBe(b.financial);
  });
  it("a transfer gives eligibility a quarter and the rest fill three quarters", () => {
    const t = blendWeights("money_first", "balanced", true);
    expect(t.eligibility).toBe(0.25);
    expect(t.academic + t.athletic + t.financial + t.eligibility).toBeCloseTo(1, 6);
  });
  it("the same athlete scores differently under two presets", () => {
    const a = rhp({ measurables: { fbVelo: 82 }, familyBudgetCents: 500000 });
    const money = scoreFit(a, d2(), { preset: "money_first" }).score;
    const ball = scoreFit(a, d2(), { preset: "baseball_first" }).score;
    expect(money).not.toBe(ball);
  });
});

describe("LAW: financial fit is net cost against the family budget, and never a veto", () => {
  it("under budget scores in the Safety band with every aid line as a reason", () => {
    const r = scoreFinancial(rhp({ familyBudgetCents: 2000000, homeState: "CT" }), d2());
    expect(r.veto).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(NET_COST_BANDS.underBudget);
    const text = r.reasons.join(" ");
    expect(text).toMatch(/Athletic aid/);
    expect(text).toMatch(/Merit aid/);
    expect(text).toMatch(/Need-based aid/);
    expect(text).toMatch(/in state/);
  });
  it("far over budget scores the bottom band and says by how much", () => {
    const r = scoreFinancial(rhp({ familyBudgetCents: 500000, homeState: "NY" }), d2());
    expect(r.score).toBe(NET_COST_BANDS.further);
    expect(r.warnings.join(" ")).toMatch(/over budget/);
    expect(r.veto).toBe(false);
  });
  it("with no budget the school-only model runs at low confidence", () => {
    const r = scoreFinancial(rhp(), d2());
    expect(r.confidence).toBe("low");
    expect(r.warnings.join(" ")).toMatch(/No family budget/);
  });
  it("D3 never counts athletic aid, with or without a budget", () => {
    const r = scoreFinancial(rhp({ familyBudgetCents: 2000000 }), d2({ division: "D3", financials: { athleticScholarship: "full", avgAthleticAid: 9000, avgMeritAid: 12000, outstateTotal: 50000 } }));
    expect(r.reasons.join(" ")).not.toMatch(/Athletic aid/);
    expect(r.reasons.join(" ")).toMatch(/not allowed by NCAA rules/);
  });
});

describe("LAW: a school's tier is its Program Tier when set, and positional need is a boost, never past a veto", () => {
  it("the same D1 school benchmarks harder as Elite D1", () => {
    const a = rhp({ measurables: { fbVelo: 88 } });
    const mid = scoreAthletic(a, d2({ division: "D1", programTier: "mid_d1" })).score;
    const elite = scoreAthletic(a, d2({ division: "D1", programTier: "elite_d1" })).score;
    expect(elite).toBeLessThan(mid);
  });
  it("a matching position of need adds the boost and a reason", () => {
    const a = mif({ measurables: { sixty: 6.9, exitVelo: 92, armVelo: 84 }, familyBudgetCents: 2000000, homeState: "CT" });
    const plain = scoreFit(a, d2());
    const needed = scoreFit(a, d2(), { positionalNeed: [{ position: "SS", gradYear: 2027 }] });
    expect(needed.score).toBe(Math.min(100, plain.score + POSITIONAL_NEED_BOOST));
    expect(needed.reasons[0]).toMatch(/needs a SS for 2027/);
    const wrongYear = scoreFit(a, d2(), { positionalNeed: [{ position: "SS", gradYear: 2028 }] });
    expect(wrongYear.score).toBe(plain.score);
  });
  it("a vetoed school gets no boost", () => {
    const a = mif({ measurables: { sixty: 7.8 } });
    const r = scoreFit(a, d2(), { positionalNeed: [{ position: "SS" }] });
    expect(r.tag).toBe("Conflict");
    expect(r.reasons.join(" ")).not.toMatch(/needs a/);
  });
});

describe("LAW: one band everywhere", () => {
  it("80 Safety, 55 Fit, 35 Reach", () => {
    expect(scoreToTag(BANDS.safety)).toBe("Safety");
    expect(scoreToTag(BANDS.safety - 1)).toBe("Fit");
    expect(scoreToTag(BANDS.fit)).toBe("Fit");
    expect(scoreToTag(BANDS.fit - 1)).toBe("Reach");
    expect(scoreToTag(BANDS.reach)).toBe("Reach");
    expect(scoreToTag(BANDS.reach - 1)).toBe("Conflict");
  });
});
