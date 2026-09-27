// THE MATCHING LAWS, AS TESTS. Every rule here is a line in
// docs/MATCHING_CONTRACT.md, and every number comes from
// src/lib/fit/contract.ts so a changed number changes the app and the
// test together. See README.md in this folder.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scoreFit } from "../lib/fit/score";
import { scoreAthletic } from "../lib/fit/athletic";
import { scoreFinancial } from "../lib/fit/financial";
import { selectScoringMetrics } from "../lib/fit/metrics";
import { BANDS, GOAL_SHIFT, GRADE_WEIGHT, NET_COST_BANDS, POSITIONAL_NEED_BOOST, PRESETS, blendWeights, gradeToScore } from "../lib/fit/contract";
import { scoreToTag } from "../lib/fit/bands";
import type { Athlete, School } from "../lib/fit/types";
import { FIT_SORTS, parseFitSort, partialLabel, partialLabelFor, rankFits, type RankableFit } from "../lib/fit/rank";
import { buildFixture, IDS } from "../testing/fixture";

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

// Amended 2026-09-27 (docs/MATCHING_CONTRACT.md section 2, Dave approved
// the Stage 5 plan the same day): one ranking rule wherever stored fits
// are listed. Fully scored first, then partial, each by score; a name
// tiebreak so the fake client and Postgres agree. The label a partial
// row wears is "Partial · N of M scored" with M read off the row.
//
// Verified these laws bite: deleted the partial split in compareBest
// (rank.ts) and hardcoded M = 4 in partialLabelFor; the first two
// describes failed on the fixture's high school row; restored both.

type FixtureFit = RankableFit & { id: string; athlete_id: string; school_id: string; dimensions: Record<string, unknown> };
const fixtureFits = () => buildFixture().athlete_school_fits as unknown as FixtureFit[];

const fitRow = (name: string, score: number, partial: boolean, extra: Partial<RankableFit> = {}): RankableFit => ({
  score,
  partial,
  school: { id: name.toLowerCase(), name },
  dimensions: {
    academic: { score: 70, confidence: "high" },
    athletic: { score: 70, confidence: "high" },
    financial: { score: 70, confidence: "high" },
    counted: partial ? ["academic", "financial"] : ["academic", "athletic", "financial"],
  },
  net_cost: 20000,
  ...extra,
});

describe("LAW: a fully scored fit ranks above any partial one, and score orders within each", () => {
  const rows = [fitRow("Partial High", 99, true), fitRow("Full Low", 41, false), fitRow("Full High", 93, false), fitRow("Partial Low", 30, true)];
  const names = (xs: RankableFit[]) => xs.map((r) => r.school.name);

  it("Best Fit puts every full row before every partial row, each by score", () => {
    expect(names(rankFits(rows, "best"))).toEqual(["Full High", "Full Low", "Partial High", "Partial Low"]);
  });

  it("a tie on score is A to Z by name, then by id, so two clients give one order", () => {
    const a = fitRow("Beta", 60, false, { school: { id: "2", name: "Beta" } });
    const b = fitRow("Alpha", 60, false, { school: { id: "1", name: "Alpha" } });
    const c = fitRow("Alpha", 60, false, { school: { id: "0", name: "Alpha" } });
    expect(rankFits([a, b, c], "best").map((r) => r.school.id)).toEqual(["0", "1", "2"]);
    expect(rankFits([c, a, b], "best").map((r) => r.school.id)).toEqual(["0", "1", "2"]);
  });

  it("every other sort falls back to the same rule once its own key ties", () => {
    // Same academic score everywhere: Academic becomes Best Fit.
    expect(names(rankFits(rows, "academic"))).toEqual(["Full High", "Full Low", "Partial High", "Partial Low"]);
    expect(names(rankFits(rows, "athletic"))).toEqual(["Full High", "Full Low", "Partial High", "Partial Low"]);
    expect(names(rankFits(rows, "financial"))).toEqual(["Full High", "Full Low", "Partial High", "Partial Low"]);
    expect(names(rankFits(rows, "net_cost"))).toEqual(["Full High", "Full Low", "Partial High", "Partial Low"]);
  });

  it("a dimension sort orders by that dimension, with an unknown one last", () => {
    const strong = fitRow("Strong", 50, false, { dimensions: { academic: { score: 95, confidence: "high" } } });
    const weak = fitRow("Weak", 90, false, { dimensions: { academic: { score: 40, confidence: "high" } } });
    const unknown = fitRow("Unknown", 99, false, { dimensions: { academic: { score: 50, confidence: "unknown" } } });
    expect(names(rankFits([unknown, weak, strong], "academic"))).toEqual(["Strong", "Weak", "Unknown"]);
  });

  it("Net Cost is cheapest first with no cost on file last; A to Z is by name", () => {
    const cheap = fitRow("Zed", 40, false, { net_cost: 12000 });
    const dear = fitRow("Mid", 90, false, { net_cost: 40000 });
    const none = fitRow("Alpha", 99, false, { net_cost: null });
    expect(names(rankFits([none, dear, cheap], "net_cost"))).toEqual(["Zed", "Mid", "Alpha"]);
    expect(names(rankFits([none, dear, cheap], "az"))).toEqual(["Alpha", "Mid", "Zed"]);
  });

  it("returns a new array and leaves the caller's alone", () => {
    const input = [...rows];
    const out = rankFits(input, "best");
    expect(out).not.toBe(input);
    expect(names(input)).toEqual(names(rows));
  });

  it("the fixture carries the case: the full 41 beats the partial 48 for the no-GPA athlete", () => {
    const fits = fixtureFits().filter((f) => f.athlete_id === IDS.athleteNoGpa);
    const schools = new Map((buildFixture().schools as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    const rows: RankableFit[] = fits.map((f) => ({ ...f, school: { id: f.school_id, name: schools.get(f.school_id) ?? "" } }));
    expect(rows.some((r) => r.partial && r.score > Math.max(...rows.filter((x) => !x.partial).map((x) => x.score)))).toBe(true);
    expect(rankFits(rows, "best").map((r) => r.school.name)).toEqual(["Fixture State University", "Fixture College"]);
  });
});

describe("LAW: the sort keys a screen offers are six, in one order, and an unknown one is Best Fit", () => {
  it("Best Fit, Academic, Athletic, Financial, Net Cost, A to Z", () => {
    expect(FIT_SORTS.map((s) => s.key)).toEqual(["best", "academic", "athletic", "financial", "net_cost", "az"]);
    expect(FIT_SORTS.map((s) => s.label)).toEqual(["Best Fit", "Academic", "Athletic", "Financial", "Net Cost", "A to Z"]);
  });
  it("parseFitSort accepts each key and turns anything else into best", () => {
    for (const s of FIT_SORTS) expect(parseFitSort(s.key)).toBe(s.key);
    expect(parseFitSort("distance")).toBe("best");
    expect(parseFitSort(undefined)).toBe("best");
    expect(parseFitSort(["az", "best"])).toBe("az");
  });
});

describe("LAW: the partial label says N of 3 for a high school athlete and N of 4 for a transfer", () => {
  it("reads the denominator off the row, never a constant", () => {
    expect(partialLabel(1, 3)).toBe("Partial · 1 of 3 scored");
    expect(partialLabel(3, 4)).toBe("Partial · 3 of 4 scored");
  });
  it("the high school fixture row is 1 of 3", () => {
    const hs = fixtureFits().find((f) => f.id === "fit4")!;
    expect(hs.partial).toBe(true);
    expect(partialLabelFor(hs)).toBe("Partial · 1 of 3 scored");
  });
  it("a transfer row with eligibility is out of 4", () => {
    const transfer = fixtureFits().find((f) => f.id === "fit3")!;
    expect(transfer.dimensions.eligibility).toBeTruthy();
    const dims = { ...transfer.dimensions, counted: ["academic", "financial", "eligibility"] };
    expect(partialLabelFor({ dimensions: dims })).toBe("Partial · 3 of 4 scored");
  });
  it("the engine's own partial result labels the same way", () => {
    const r = scoreFit(rhp({ familyBudgetCents: 1500000 }), d2());
    expect(r.partial).toBe(true);
    expect(partialLabel(r.counted.length, 3)).toBe("Partial · 2 of 3 scored");
  });
});

describe("LAW: a Viewer never reads a stored fit", () => {
  // Migration 0031 gave the member (Viewer) role summaries, not rows,
  // and 0042 added net_cost to athlete_school_fits behind the same
  // read policy. No member screen or member data file may name the
  // table or the ranking helper. Verified to bite by writing the table
  // name into a comment in member.ts: failed, reverted.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(join(process.cwd(), "src", "app", "org", "[slug]", "member"));
  for (const f of readdirSync(join(process.cwd(), "src", "lib", "data"))) if (/^member.*\.ts$/.test(f)) files.push(join(process.cwd(), "src", "lib", "data", f));

  it("there are member files to check", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith("member.ts"))).toBe(true);
  });
  it("none of them names athlete_school_fits or rankFits", () => {
    const offenders = files.filter((f) => /athlete_school_fits|rankFits/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(process.cwd(), ""))).toEqual([]);
  });
});
