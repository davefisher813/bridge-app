import { describe, expect, it } from "vitest";
import { daysAhead, enumOr, isDatedString, isRealDate, normalizeDate, toBoolean, toGpa, toNumber, toYear } from "./lenient";
import { firstJsonObject, parseModelJson } from "./parseModelJson";
import { metricPlausible } from "./plausibility";
import { financialAidSchema, offerLetterSchema, testScoresSchema, transcriptSchema, triageResultSchema } from "./schemas";

// The shapes a model actually sends, each one a way a good document
// used to be thrown away at validation.

describe("numbers as a model prints them", () => {
  it("reads a quoted number, a thousands separator, a unit and a currency sign", () => {
    expect(toNumber("3.5")).toBe(3.5);
    expect(toNumber("1,250")).toBe(1250);
    expect(toNumber("86%")).toBe(86);
    expect(toNumber("$42,000")).toBe(42000);
    expect(toNumber("6.85s")).toBe(6.85);
    expect(toNumber("88 mph")).toBe(88);
  });
  it("reads the model's words for missing as null and leaves nonsense alone", () => {
    expect(toNumber("N/A")).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("three point five")).toBe("three point five");
  });
  it("reads a GPA printed against its scale", () => {
    expect(toGpa("3.5/4.0")).toBe(3.5);
    expect(toGpa("3.5 out of 4")).toBe(3.5);
    expect(toGpa(86.2)).toBe(86.2);
  });
  it("reads a graduation year however it is written", () => {
    expect(toYear("Class of 2027")).toBe(2027);
    expect(toYear("'27")).toBe(27 + 2000);
    expect(toYear("2027")).toBe(2027);
    expect(toYear("unknown")).toBeNull();
  });
  it("reads booleans as words", () => {
    expect(toBoolean("Yes")).toBe(true);
    expect(toBoolean("false")).toBe(false);
    expect(toBoolean(true)).toBe(true);
  });
});

describe("dates as documents print them", () => {
  it("normalises every common form to ISO", () => {
    expect(normalizeDate("2026-04-11")).toBe("2026-04-11");
    expect(normalizeDate("2026-4-1")).toBe("2026-04-01");
    expect(normalizeDate("04/11/2026")).toBe("2026-04-11");
    expect(normalizeDate("4/11/2026")).toBe("2026-04-11");
    expect(normalizeDate("April 11, 2026")).toBe("2026-04-11");
    expect(normalizeDate("Apr 11 2026")).toBe("2026-04-11");
    expect(normalizeDate("11 April 2026")).toBe("2026-04-11");
    expect(normalizeDate("August 2026")).toBe("2026-08");
    expect(normalizeDate("08/2026")).toBe("2026-08");
    expect(normalizeDate("2026")).toBe("2026");
    expect(normalizeDate("2026-04-11T00:00:00Z")).toBe("2026-04-11");
  });
  it("reads a slashed date day-first only when month-first is impossible", () => {
    expect(normalizeDate("25/04/2026")).toBe("2026-04-25");
    expect(normalizeDate("04/05/2026")).toBe("2026-04-05");
  });
  it("leaves a non-date for the schema to refuse and reads N/A as null", () => {
    expect(normalizeDate("Spring semester")).toBe("Spring semester");
    expect(normalizeDate("N/A")).toBeNull();
  });
  it("knows a calendar from a regex", () => {
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isDatedString("2026-13")).toBe(false);
    expect(isDatedString("2026-08")).toBe(true);
  });
  it("measures days ahead from a day, a month or a year", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    expect(daysAhead("2026-09-22", now)).toBe(1);
    expect(daysAhead("2026-10", now)).toBe(10);
    expect(daysAhead("2025", now)).toBeLessThan(0);
  });
});

describe("an enum with a safe default", () => {
  const offer = enumOr(["verbal", "written", "scholarship", "walk_on", "preferred_walk_on", "other"], "other");
  it("matches across case and punctuation", () => {
    expect(offer.parse("Walk-On")).toBe("walk_on");
    expect(offer.parse("Preferred Walk On")).toBe("preferred_walk_on");
    expect(offer.parse("SCHOLARSHIP")).toBe("scholarship");
  });
  it("takes the longest listed value the text starts with", () => {
    expect(offer.parse("walk-on offer")).toBe("walk_on");
    expect(offer.parse("preferred walk-on (PWO)")).toBe("preferred_walk_on");
  });
  it("falls back rather than failing", () => {
    expect(offer.parse("full ride")).toBe("other");
    expect(offer.parse(null)).toBe("other");
  });
});

describe("the JSON a model actually returns", () => {
  it("finds the object when prose follows it, braces and all", () => {
    const text = 'Here is the JSON:\n{"gpa": 3.5, "note": "a } inside a string"}\nLet me know if {anything} is unclear.';
    expect(parseModelJson(text)).toEqual({ gpa: 3.5, note: "a } inside a string" });
  });
  it("forgives a trailing comma", () => {
    expect(parseModelJson('{"a": 1, "b": [1, 2,],}')).toEqual({ a: 1, b: [1, 2] });
  });
  it("strips fences", () => {
    expect(parseModelJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
  it("still refuses text with no object in it", () => {
    expect(() => parseModelJson("I could not read this document.")).toThrow(/Could not parse JSON/);
    expect(firstJsonObject("no braces")).toBeNull();
  });
});

describe("schemas accept what a model sends and refuse what means nothing", () => {
  it("a transcript with quoted numbers, a slashed date, an unlisted course load and no school still parses", () => {
    const r = transcriptSchema.safeParse({
      studentName: "Davis, Xavier",
      school: "N/A",
      gradYear: "Class of 2027",
      gpa: "3.7/4.0",
      gpaScale: "4.0 scale",
      courseLoad: "Honors",
      apCount: "2",
      dateOfBirth: "03/15/2008",
      courses: [{ title: "English 9", subject: "English", credit: "1.0", grade: 92, weighted: "no", term: "" }],
      confidence: "0.9",
      warnings: "the header was cut off",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.school).toBeNull();
      expect(r.data.gradYear).toBe(2027);
      expect(r.data.gpa).toBe(3.7);
      expect(r.data.gpaScale).toBe("4.0");
      expect(r.data.courseLoad).toBe("Regular");
      expect(r.data.apCount).toBe(2);
      expect(r.data.dateOfBirth).toBe("2008-03-15");
      expect(r.data.courses[0]).toMatchObject({ subject: "english", credit: 1, grade: "92", weighted: false, term: null });
      expect(r.data.confidence).toBe(0.9);
      expect(r.data.warnings).toEqual(["the header was cut off"]);
    }
  });
  it("still refuses a GPA that is not a number and a date that is not a date", () => {
    expect(transcriptSchema.safeParse({ gpa: "three point five" }).success).toBe(false);
    expect(transcriptSchema.safeParse({ dateOfBirth: "Spring" }).success).toBe(false);
  });
  it("a test score report with a typed total and an American date parses", () => {
    const r = testScoresSchema.safeParse({ studentName: "X", tests: [{ type: "SAT Total", testDate: "04/11/2026", totalScore: "1,250", breakdown: { math: "640", ebrw: "610" } }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tests[0]).toMatchObject({ type: "SAT", testDate: "2026-04-11", totalScore: 1250, breakdown: { math: 640, ebrw: 610 } });
  });
  it("an offer letter with a hyphenated offer type and a percentage sign parses", () => {
    const r = offerLetterSchema.safeParse({ studentName: "X", college: "Sample State", offerType: "Preferred Walk-On", scholarshipPercent: "25%", offerDate: "June 2026", isOfficial: "yes" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ offerType: "preferred_walk_on", scholarshipPercent: 25, offerDate: "2026-06", isOfficial: true });
  });
  it("an award letter with dollar signs parses and a missing year is null", () => {
    const r = financialAidSchema.safeParse({ documentType: "Award Letter", college: "Sample State", awards: [{ type: "Grant", name: "Pell", amount: "$7,395" }], totalCostOfAttendance: "$42,000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ documentType: "award_letter", academicYear: null, awards: [{ type: "grant", amount: 7395 }], totalCostOfAttendance: 42000 });
  });
  it("a triage answer with a stray recommendation still parses to a safe one", () => {
    const r = triageResultSchema.safeParse({ readable: "yes", legibilityScore: "0.8", detectedType: "Transcript", pagesDetected: "2", recommendation: "ok", reason: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ readable: true, legibilityScore: 0.8, detectedType: "transcript", pagesDetected: 2, recommendation: "proceed", issues: [] });
  });
});

describe("a plausible reading", () => {
  it("catches the unit and column slips a sheet actually produces", () => {
    expect(metricPlausible("fbVelo", 8.8)).toBe(false);
    expect(metricPlausible("fbVelo", 88)).toBe(true);
    expect(metricPlausible("sixty", 68)).toBe(false);
    expect(metricPlausible("sixty", 6.8)).toBe(true);
    expect(metricPlausible("heightIn", 6)).toBe(false);
    expect(metricPlausible("heightIn", 73)).toBe(true);
    expect(metricPlausible("savePct", 140)).toBe(false);
  });
});
