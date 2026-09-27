import { describe, expect, it } from "vitest";
import { FIT_SORTS, parseFitSort, partialLabel, partialLabelFor, rankFits, type RankableFit } from "./rank";
import { estimateNetCost } from "./financial";
import { scoreFit } from "./score";
import type { Athlete, School } from "./types";

// One ranking rule everywhere fits are listed (Phase 1 of Stage 5, Dave
// approved 2026-09-27): fully scored first, then partial, each by score.

type Row = RankableFit & { id: string };

const dim = (score: number, confidence: "high" | "medium" | "low" | "unknown" = "high") => ({ score, confidence, veto: false, reasons: [], warnings: [] });

function row(id: string, over: Partial<Row> & { name?: string } = {}): Row {
  const { name, ...rest } = over;
  return {
    id,
    score: 70,
    partial: false,
    net_cost: 20000,
    dimensions: { academic: dim(70), athletic: dim(70), financial: dim(70), counted: ["academic", "athletic", "financial"] },
    school: { id, name: name ?? `School ${id}` },
    ...rest,
  };
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("rankFits: Best Fit", () => {
  it("puts every fully scored row above every partial one, whatever the raw scores say", () => {
    const rows = [row("partialHigh", { partial: true, score: 95 }), row("fullLow", { score: 40 }), row("fullMid", { score: 60 }), row("partialLow", { partial: true, score: 30 })];
    expect(ids(rankFits(rows, "best"))).toEqual(["fullMid", "fullLow", "partialHigh", "partialLow"]);
  });

  it("orders by score within the full group and within the partial group", () => {
    const rows = [row("a", { score: 55 }), row("b", { score: 88 }), row("c", { partial: true, score: 20 }), row("d", { partial: true, score: 70 })];
    expect(ids(rankFits(rows))).toEqual(["b", "a", "d", "c"]);
  });

  it("breaks a tie by school name, case and accent insensitive, so the fake client and Postgres agree", () => {
    const rows = [row("z", { name: "zeta college" }), row("a", { name: "Alpha University" }), row("e", { name: "Émile College" })];
    expect(ids(rankFits(rows))).toEqual(["a", "e", "z"]);
  });

  it("is deterministic: the same rows in any order give one output, even two schools with one name", () => {
    const rows = [row("a", { score: 50, name: "B" }), row("d", { score: 50, name: "A", net_cost: 1 }), row("c", { partial: true, score: 99 }), row("b", { score: 50, name: "A" })];
    const forward = ids(rankFits(rows));
    const backward = ids(rankFits([...rows].reverse()));
    expect(forward).toEqual(["b", "d", "a", "c"]);
    expect(backward).toEqual(forward);
  });

  it("returns a new array and leaves the input alone", () => {
    const rows = [row("low", { score: 10 }), row("high", { score: 90 })];
    const out = rankFits(rows);
    expect(ids(out)).toEqual(["high", "low"]);
    expect(ids(rows)).toEqual(["low", "high"]);
  });
});

describe("rankFits: dimension sorts", () => {
  it("Academic sorts by the academic score, then falls back to Best Fit", () => {
    const rows = [row("a", { dimensions: { academic: dim(60), athletic: dim(99), financial: dim(99) } }), row("b", { dimensions: { academic: dim(90), athletic: dim(10), financial: dim(10) } }), row("c", { score: 80, dimensions: { academic: dim(60), athletic: dim(80), financial: dim(80) } })];
    expect(ids(rankFits(rows, "academic"))).toEqual(["b", "c", "a"]);
  });

  it("Athletic and Financial read their own dimension", () => {
    const rows = [row("a", { dimensions: { academic: dim(50), athletic: dim(30), financial: dim(90) } }), row("b", { dimensions: { academic: dim(50), athletic: dim(80), financial: dim(20) } })];
    expect(ids(rankFits(rows, "athletic"))).toEqual(["b", "a"]);
    expect(ids(rankFits(rows, "financial"))).toEqual(["a", "b"]);
  });

  it("a dimension the engine did not count sorts last under its own key", () => {
    const rows = [row("unknown", { partial: true, dimensions: { academic: dim(50, "unknown"), athletic: dim(90), financial: dim(90), counted: ["athletic", "financial"] } }), row("known", { dimensions: { academic: dim(20), athletic: dim(20), financial: dim(20) } })];
    expect(ids(rankFits(rows, "academic"))).toEqual(["known", "unknown"]);
    // Under Athletic the same row leads: that dimension was counted.
    expect(ids(rankFits(rows, "athletic"))).toEqual(["unknown", "known"]);
  });

  it("a row with no dimensions at all still sorts, last", () => {
    const rows = [row("bare", { dimensions: undefined }), row("full", { dimensions: { academic: dim(10), athletic: dim(10), financial: dim(10) } })];
    expect(ids(rankFits(rows, "academic"))).toEqual(["full", "bare"]);
  });
});

describe("rankFits: Net Cost and A to Z", () => {
  it("Net Cost is lowest first with null and missing last, those two then A to Z", () => {
    const rows = [row("none", { net_cost: null }), row("dear", { net_cost: 50000 }), row("cheap", { net_cost: 9000 }), row("missing", { net_cost: undefined })];
    expect(ids(rankFits(rows, "net_cost"))).toEqual(["cheap", "dear", "missing", "none"]);
  });

  it("Net Cost ties fall back to Best Fit, so a full row beats a partial one at the same cost", () => {
    const rows = [row("partial", { partial: true, score: 99, net_cost: 12000 }), row("full", { score: 40, net_cost: 12000 })];
    expect(ids(rankFits(rows, "net_cost"))).toEqual(["full", "partial"]);
  });

  it("A to Z is by school name and ignores score and partial", () => {
    const rows = [row("c", { name: "Charlie", score: 99 }), row("a", { name: "alpha", partial: true, score: 1 }), row("b", { name: "Bravo" })];
    expect(ids(rankFits(rows, "az"))).toEqual(["a", "b", "c"]);
  });

  it("A to Z puts a number-suffixed name in numeric order", () => {
    const rows = [row("ten", { name: "State 10" }), row("two", { name: "State 2" })];
    expect(ids(rankFits(rows, "az"))).toEqual(["two", "ten"]);
  });
});

describe("the sort vocabulary", () => {
  it("offers exactly the six keys the plan names, Best Fit first, in Title Case", () => {
    expect(FIT_SORTS.map((s) => s.key)).toEqual(["best", "academic", "athletic", "financial", "net_cost", "az"]);
    expect(FIT_SORTS.map((s) => s.label)).toEqual(["Best Fit", "Academic", "Athletic", "Financial", "Net Cost", "A to Z"]);
  });

  it("parses a URL value and falls back to Best Fit for anything else", () => {
    expect(parseFitSort("net_cost")).toBe("net_cost");
    expect(parseFitSort(["az"])).toBe("az");
    expect(parseFitSort("distance")).toBe("best");
    expect(parseFitSort(undefined)).toBe("best");
    expect(parseFitSort(null)).toBe("best");
  });
});

describe("partialLabel", () => {
  it("reads Partial · N of M scored", () => {
    expect(partialLabel(1, 3)).toBe("Partial · 1 of 3 scored");
    expect(partialLabel(3, 4)).toBe("Partial · 3 of 4 scored");
  });

  it("takes M from the row: 3 dimensions for a high school athlete, 4 for a transfer", () => {
    const hs = { dimensions: { academic: dim(50, "unknown"), athletic: dim(50, "unknown"), financial: dim(48, "low"), counted: ["financial"] } };
    const transfer = { dimensions: { academic: dim(80), athletic: dim(50, "unknown"), financial: dim(70), eligibility: dim(60), counted: ["academic", "financial", "eligibility"] } };
    expect(partialLabelFor(hs)).toBe("Partial · 1 of 3 scored");
    expect(partialLabelFor(transfer)).toBe("Partial · 3 of 4 scored");
  });

  it("never says more were scored than there were, even on a thin row", () => {
    expect(partialLabelFor({ dimensions: { counted: ["academic", "financial"] } })).toBe("Partial · 2 of 2 scored");
    expect(partialLabelFor({ dimensions: undefined })).toBe("Partial · 0 of 0 scored");
  });
});

describe("net cost on the result", () => {
  const athlete = (over: Partial<Athlete> = {}): Athlete => ({ id: "a", orgId: "o", recruitType: "hs", name: "Test Athlete", sport: "baseball", gpa: 3.5, homeState: "CT", familyBudgetCents: 2_000_000, ...over });
  const school = (over: Partial<School> = {}): School => ({
    id: "s",
    name: "Test School",
    division: "D2",
    state: "NY",
    sportsSponsored: ["baseball"],
    financials: { outstateTotal: 50_000, instateTotal: 30_000, athleticScholarship: "partial", avgAthleticAid: 5_000, avgMeritAid: 4_000 },
    ...over,
  });

  it("is cost of attendance less the likely aid, in whole dollars, and matches the reason the financial dimension gives", () => {
    const r = scoreFit(athlete(), school());
    expect(r.netCost).toBe(estimateNetCost(athlete(), school()));
    expect(typeof r.netCost).toBe("number");
    expect(Number.isInteger(r.netCost)).toBe(true);
    const money = `$${r.netCost!.toLocaleString("en-US")}`;
    expect(r.financial.reasons.join(" ")).toContain(`Net cost about ${money}`);
  });

  it("uses the in-state cost when the athlete lives in the school's state", () => {
    const away = estimateNetCost(athlete(), school())!;
    const home = estimateNetCost(athlete({ homeState: "NY" }), school())!;
    expect(away - home).toBe(20_000);
  });

  it("does not depend on a family budget", () => {
    expect(estimateNetCost(athlete({ familyBudgetCents: undefined }), school())).toBe(estimateNetCost(athlete(), school()));
    expect(scoreFit(athlete({ familyBudgetCents: undefined }), school()).netCost).toBe(estimateNetCost(athlete(), school()));
  });

  it("an applied award letter replaces the estimate", () => {
    expect(estimateNetCost(athlete(), school(), { netCost: 12_345.6 })).toBe(12_346);
    expect(scoreFit(athlete(), school(), { aid: { netCost: 12_345.6 } }).netCost).toBe(12_346);
  });

  it("is null when the school carries no cost, and never below zero", () => {
    expect(estimateNetCost(athlete(), school({ financials: undefined }))).toBeNull();
    expect(estimateNetCost(athlete(), school({ financials: { athleticScholarship: "full", avgAthleticAid: 40_000 } }))).toBeNull();
    expect(scoreFit(athlete(), school({ financials: undefined })).netCost).toBeUndefined();
    expect(estimateNetCost(athlete({ gpa: 4.0 }), school({ financials: { outstateTotal: 10_000, avgAthleticAid: 9_000, athleticScholarship: "full", avgMeritAid: 9_000, avgNeedAid: 9_000 } }))).toBe(0);
  });

  it("a placed athlete carries no net cost, because nothing was evaluated", () => {
    expect(scoreFit(athlete(), school(), { isPlaced: true }).netCost).toBeUndefined();
  });
});
