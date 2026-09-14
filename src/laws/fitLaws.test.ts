import { describe, expect, it } from "vitest";
import { scoreFinancial } from "../lib/fit/financial";
import { scoreEligibility } from "../lib/fit/transfer";
import { scoreFit } from "../lib/fit/score";
import type { Athlete, School, TransferWindow } from "../lib/fit/types";

// THE LAWS, AS TESTS. See README.md in this folder.

describe("LAW: D3 never shows a scholarship-availability claim", () => {
  // Verified this law actually bites: temporarily changed the isD3 branch
  // in financial.ts to fall through to the standard scholarship-type
  // model, ran this file, watched it fail on the "full" case below
  // (reasons contained "Full athletic scholarships available" for a D3
  // school), reverted.
  const athlete: Athlete = { id: "a", orgId: "o", recruitType: "hs", name: "Test", sport: "baseball", gpa: 3.5 };

  it.each(["full", "partial", "none"] as const)(
    "never claims scholarship availability for D3 even when the school record has athleticScholarship=%s (dirty/wrong data)",
    (schType) => {
      const school: School = {
        id: "s",
        name: "Test D3 College",
        division: "D3",
        sportsSponsored: ["baseball"],
        financials: { athleticScholarship: schType, avgMeritAid: 15000, outstateTotal: 50000 },
      };
      const result = scoreFinancial(athlete, school);
      const allText = [...result.reasons, ...result.warnings].join(" ").toLowerCase();
      expect(allText).not.toMatch(/scholarships? (are |is )?available/);
      expect(allText).toMatch(/not allowed by ncaa rules/);
    }
  );

  it("D3 spelled with whitespace/case variants still triggers the ban, never the standard model", () => {
    const variants = ["d3", "NCAA D3", "Division III", " D3 "];
    for (const division of variants) {
      const school: School = { id: "s", name: "X", division, sportsSponsored: ["baseball"], financials: { athleticScholarship: "full" } };
      const result = scoreFinancial(athlete, school);
      expect(result.reasons.join(" ")).toMatch(/not allowed by NCAA rules/i);
    }
  });
});

describe("LAW: a transfer portal window is never fabricated", () => {
  // Verified this law actually bites: temporarily made findWindow() in
  // transfer.ts return a fake window {opensOn: entryDate, closesOn:
  // entryDate} when no real window matched, ran this file, watched the
  // "no window supplied" case below fail (confidence came back "high"
  // instead of a warning), reverted.
  const baseAthlete: Athlete = {
    id: "a",
    orgId: "o",
    recruitType: "transfer_4to4",
    name: "Test",
    sport: "baseball",
    detail: {
      kind: "transfer",
      currentSchool: "Old U",
      eligibilityYearsRemaining: 2,
      transferCount: 1,
      portalEntryDate: "2026-06-15",
    },
  };
  const school: School = { id: "s", name: "New U", division: "D1", sportsSponsored: ["baseball"] };

  it("with no TransferWindow rows supplied, timing is reported unverified, never assumed valid", () => {
    const result = scoreEligibility(baseAthlete, school, []);
    expect(result.veto).toBe(false);
    const allText = [...result.reasons, ...result.warnings].join(" ").toLowerCase();
    expect(allText).toMatch(/not on file|not verified/);
    expect(allText).not.toMatch(/falls within/);
  });

  it("with a real matching window, entry inside it is confirmed and entry outside it vetoes", () => {
    const windows: TransferWindow[] = [
      { sport: "baseball", division: "D1", seasonYear: "2026", windowLabel: "undergrad primary", opensOn: "2026-06-01", closesOn: "2026-06-30" },
    ];
    const inside = scoreEligibility(baseAthlete, school, windows);
    expect(inside.veto).toBe(false);
    expect(inside.reasons.join(" ")).toMatch(/falls within/);

    const outsideAthlete: Athlete = {
      ...baseAthlete,
      detail: { ...baseAthlete.detail!, kind: "transfer", portalEntryDate: "2026-07-15" } as Athlete["detail"],
    };
    const outside = scoreEligibility(outsideAthlete, school, windows);
    expect(outside.veto).toBe(true);
  });
});

describe("LAW: a veto always overrides the blend, no matter how high the other dimensions score", () => {
  it("an elite athletic profile at a school the athlete's sport isn't sponsored at is still a Conflict", () => {
    const athlete: Athlete = {
      id: "a",
      orgId: "o",
      recruitType: "hs",
      name: "Elite Athlete",
      sport: "lacrosse",
      gpa: 4.0,
      measurables: {},
    };
    const school: School = {
      id: "s",
      name: "Test University",
      division: "D1",
      sportsSponsored: ["baseball"],
      academics: { gpaMin: 2.0, gpaAvg: 3.0 },
      financials: { athleticScholarship: "full", avgAthleticAid: 60000, outstateTotal: 60000 },
    };
    const result = scoreFit(athlete, school, { signals: { offer: { offerType: "scholarship" } } });
    expect(result.tag).toBe("Conflict");
  });
});
