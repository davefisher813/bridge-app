import { describe, expect, it } from "vitest";
import { scoreFinancial } from "./financial";
import { scoreFit } from "./score";
import type { Athlete, School } from "./types";

// An applied award letter is the one financial input about the pair
// rather than the school's averages, so it replaces the estimate.

const athlete = (over: Partial<Athlete> = {}): Athlete => ({ id: "a", orgId: "o", recruitType: "hs", name: "Test Athlete", sport: "baseball", gpa: 3.5, familyBudgetCents: 2_000_000, ...over });
const school = (over: Partial<School> = {}): School => ({
  id: "s",
  name: "Test School",
  division: "D2",
  sportsSponsored: ["baseball"],
  financials: { outstateTotal: 50_000, athleticScholarship: "partial", avgAthleticAid: 5_000, avgMeritAid: 4_000 },
  ...over,
});

describe("an award letter's net cost replaces the estimate", () => {
  it("scores the letter's net cost against the budget at high confidence", () => {
    const estimate = scoreFinancial(athlete(), school());
    const letter = scoreFinancial(athlete(), school(), { netCost: 12_000, academicYear: "2027-28", totalCost: 50_000 });
    expect(letter.confidence).toBe("high");
    expect(letter.reasons[0]).toMatch(/award letter for 2027-28/);
    expect(letter.reasons[0]).toMatch(/\$12,000/);
    expect(letter.score).toBeGreaterThan(estimate.score);
    expect(letter.reasons.join(" ")).not.toMatch(/likely aid/);
  });

  it("a letter over budget scores like any other net cost over budget", () => {
    const r = scoreFinancial(athlete(), school(), { netCost: 45_000 });
    expect(r.score).toBeLessThanOrEqual(20);
    expect(r.warnings[0]).toMatch(/over budget/);
  });

  it("with no family budget the letter is shown but not judged", () => {
    const r = scoreFinancial(athlete({ familyBudgetCents: undefined }), school(), { netCost: 12_000 });
    expect(r.confidence).toBe("low");
    expect(r.reasons[0]).toMatch(/award letter/);
    expect(r.warnings[0]).toMatch(/No family budget/);
  });

  it("reaches the blend through scoreFit", () => {
    const r = scoreFit(athlete(), school(), { aid: { netCost: 12_000 } });
    expect(r.financial.reasons[0]).toMatch(/award letter/);
  });

  it("never vetoes", () => {
    const r = scoreFinancial(athlete(), school(), { netCost: 200_000 });
    expect(r.veto).toBe(false);
  });
});
