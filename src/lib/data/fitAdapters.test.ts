import { describe, expect, it } from "vitest";
import {
  athleteRowToFitAthlete,
  communicationsToSignals,
  schoolRowToFitSchool,
  targetOfferToSignal,
  transferWindowRowToFit,
  type AthleteRow,
  type SchoolRow,
  type TransferWindowRow,
} from "./fitAdapters";

function makeAthleteRow(overrides: Partial<AthleteRow> = {}): AthleteRow {
  return {
    id: "a1",
    org_id: "o1",
    recruit_type: "hs",
    name: "Test Athlete",
    sport: "baseball",
    position: "SS",
    gpa: 3.5,
    gpa_verified: true,
    detail: { kind: "hs", gradYear: 2027 },
    measurables: { exitVelo: 92 },
    is_international: false,
    toefl_score: null,
    ielts_score: null,
    f1_visa_status: null,
    ncaa_eligibility_status: "Registered",
    ...overrides,
  };
}

function makeSchoolRow(overrides: Partial<SchoolRow> = {}): SchoolRow {
  return {
    id: "s1",
    name: "Test University",
    division: "D1",
    conference: "Test Conference",
    sports_sponsored: ["baseball"],
    academics: { gpaMin: 3.0, gpaAvg: 3.6 },
    financials: { athleticScholarship: "partial" },
    athletics: { playingTimeOutlook: "competitive" },
    conflicts: [],
    profile_date: "2026-01-01",
    ...overrides,
  };
}

describe("athleteRowToFitAthlete", () => {
  it("maps snake_case DB columns to the fit engine's camelCase Athlete shape", () => {
    const athlete = athleteRowToFitAthlete(makeAthleteRow());
    expect(athlete).toMatchObject({
      id: "a1",
      orgId: "o1",
      recruitType: "hs",
      gpaVerified: true,
      isInternational: false,
      ncaaEligibilityStatus: "Registered",
      detail: { kind: "hs", gradYear: 2027 },
    });
  });

  it("degrades a malformed detail blob to undefined instead of throwing", () => {
    const athlete = athleteRowToFitAthlete(makeAthleteRow({ detail: { kind: "hs", gradYear: "not a number" } }));
    expect(athlete.detail).toBeUndefined();
  });

  it("degrades malformed measurables to an empty object instead of throwing", () => {
    const athlete = athleteRowToFitAthlete(makeAthleteRow({ measurables: { exitVelo: "fast" } }));
    expect(athlete.measurables).toEqual({});
  });
});

describe("schoolRowToFitSchool", () => {
  it("maps snake_case DB columns to the fit engine's camelCase School shape", () => {
    const school = schoolRowToFitSchool(makeSchoolRow());
    expect(school).toMatchObject({
      id: "s1",
      sportsSponsored: ["baseball"],
      academics: { gpaMin: 3.0, gpaAvg: 3.6 },
      financials: { athleticScholarship: "partial" },
      athletics: { playingTimeOutlook: "competitive" },
    });
  });

  it("degrades a malformed jsonb field to an empty object instead of throwing", () => {
    const school = schoolRowToFitSchool(makeSchoolRow({ financials: { athleticScholarship: "not a valid value" } }));
    expect(school.financials).toEqual({});
  });
});

describe("transferWindowRowToFit", () => {
  it("maps snake_case DB columns to the fit engine's camelCase TransferWindow shape", () => {
    const row: TransferWindowRow = {
      sport: "baseball",
      division: "D1",
      season_year: "2026-27",
      window_label: "undergrad primary",
      opens_on: "2026-08-01",
      closes_on: "2026-08-15",
    };
    expect(transferWindowRowToFit(row)).toEqual({
      sport: "baseball",
      division: "D1",
      seasonYear: "2026-27",
      windowLabel: "undergrad primary",
      opensOn: "2026-08-01",
      closesOn: "2026-08-15",
    });
  });
});

describe("communicationsToSignals", () => {
  it("splits visit-kind rows from every other kind", () => {
    const signals = communicationsToSignals([
      { target_id: "t1", kind: "call" },
      { target_id: "t1", kind: "text" },
      { target_id: "t1", kind: "visit" },
      { target_id: "t1", kind: "email" },
      { target_id: "t1", kind: "visit" },
      { target_id: "t1", kind: "other" },
    ]);
    expect(signals).toEqual({ visitCount: 2, commCount: 4 });
  });

  it("returns zero counts for an empty log", () => {
    expect(communicationsToSignals([])).toEqual({ visitCount: 0, commCount: 0 });
  });
});

describe("targetOfferToSignal", () => {
  it("returns undefined when no offer is on file", () => {
    expect(targetOfferToSignal({ offer_type: null, offer_scholarship_percent: null })).toBeUndefined();
  });

  it("carries the scholarship percent through for a scholarship offer", () => {
    expect(targetOfferToSignal({ offer_type: "scholarship", offer_scholarship_percent: 75 })).toEqual({
      offerType: "scholarship",
      scholarshipPercent: 75,
    });
  });

  it("omits the percent for a non-scholarship offer", () => {
    expect(targetOfferToSignal({ offer_type: "verbal", offer_scholarship_percent: null })).toEqual({
      offerType: "verbal",
      scholarshipPercent: undefined,
    });
  });

  it("degrades an unrecognized offer_type to undefined instead of throwing", () => {
    expect(targetOfferToSignal({ offer_type: "not_a_real_type", offer_scholarship_percent: null })).toBeUndefined();
  });
});
