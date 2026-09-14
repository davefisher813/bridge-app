import { describe, expect, it } from "vitest";
import { scoreFit } from "./score";
import type { Athlete, School } from "./types";

describe("scoreFit smoke tests", () => {
  it("vetoes a HS athlete below a D1 school's GPA floor regardless of athletic score", () => {
    const athlete: Athlete = {
      id: "a1",
      orgId: "o1",
      recruitType: "hs",
      name: "Test Athlete",
      sport: "baseball",
      position: "SS",
      gpa: 2.0,
      gpaVerified: true,
      measurables: { sixty: 6.6, exitVelo: 102, infieldVelo: 92 },
      detail: { kind: "hs", gradYear: 2027 },
    };
    const school: School = {
      id: "s1",
      name: "Test University",
      division: "D1",
      sportsSponsored: ["baseball"],
      academics: { gpaMin: 3.0, gpaAvg: 3.4 },
    };
    const result = scoreFit(athlete, school);
    expect(result.tag).toBe("Conflict");
    expect(result.academic.veto).toBe(true);
  });

  it("never shows scholarship availability for a D3 school", () => {
    const athlete: Athlete = {
      id: "a2",
      orgId: "o1",
      recruitType: "hs",
      name: "Test Athlete 2",
      sport: "baseball",
      gpa: 3.8,
      detail: { kind: "hs" },
    };
    const school: School = {
      id: "s2",
      name: "Test D3 College",
      division: "D3",
      sportsSponsored: ["baseball"],
      financials: { avgMeritAid: 20000, avgNeedAid: 10000, outstateTotal: 55000 },
    };
    const result = scoreFit(athlete, school);
    expect(result.financial.reasons.join(" ")).toMatch(/not allowed by NCAA rules/);
    expect(result.financial.reasons.join(" ")).not.toMatch(/scholarship.*available/i);
  });

  it("vetoes a JUCO transfer below the 2.5 GPA minimum", () => {
    const athlete: Athlete = {
      id: "a3",
      orgId: "o1",
      recruitType: "transfer_juco",
      name: "Transfer Athlete",
      sport: "baseball",
      detail: {
        kind: "transfer",
        currentSchool: "Some JUCO",
        collegeGpa: 2.1,
        eligibilityYearsRemaining: 2,
        transferCount: 1,
      },
    };
    const school: School = { id: "s3", name: "Test University", division: "D1", sportsSponsored: ["baseball"] };
    const result = scoreFit(athlete, school);
    expect(result.eligibility?.veto).toBe(true);
    expect(result.tag).toBe("Conflict");
  });

  it("vetoes a graduate transfer without a completed degree", () => {
    const athlete: Athlete = {
      id: "a4",
      orgId: "o1",
      recruitType: "transfer_grad",
      name: "Grad Transfer",
      sport: "baseball",
      detail: {
        kind: "transfer",
        currentSchool: "Four Year U",
        eligibilityYearsRemaining: 1,
        transferCount: 1,
        degreeCompleted: false,
      },
    };
    const school: School = { id: "s4", name: "Test University", division: "D1", sportsSponsored: ["baseball"] };
    const result = scoreFit(athlete, school);
    expect(result.eligibility?.veto).toBe(true);
  });

  it("vetoes when the school does not sponsor the athlete's sport", () => {
    const athlete: Athlete = { id: "a5", orgId: "o1", recruitType: "hs", name: "Test", sport: "lacrosse" };
    const school: School = { id: "s5", name: "Test University", division: "D1", sportsSponsored: ["baseball", "soccer"] };
    const result = scoreFit(athlete, school);
    expect(result.athletic.veto).toBe(true);
    expect(result.tag).toBe("Conflict");
  });

  it("returns a placed-athlete short circuit without running the dimensions", () => {
    const athlete: Athlete = { id: "a6", orgId: "o1", recruitType: "hs", name: "Test", sport: "baseball", gpa: 1.0 };
    const school: School = { id: "s6", name: "Test University", division: "D1", sportsSponsored: ["baseball"] };
    const result = scoreFit(athlete, school, { isPlaced: true });
    expect(result.tag).toBe("Fit");
  });
});
