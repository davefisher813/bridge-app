import { describe, expect, it } from "vitest";
import { buildEligibilityView, parseBands, type AthleteCourseRow, type GradingScaleRow } from "./ncaaAdapters";

const course = (over: Partial<AthleteCourseRow> = {}): AthleteCourseRow => ({
  id: crypto.randomUUID(),
  title: "English 11",
  subject: "english",
  credit: 1,
  grade: "B",
  term: "24-25",
  school_name: "Bridge HS",
  weighted: false,
  ncaa_approved: true,
  duplicate_of: null,
  ...over,
});

const scale = (over: Partial<GradingScaleRow> = {}): GradingScaleRow => ({
  school_name: "Bridge HS",
  bands: [
    { letter: "A", min: 93, max: 100 },
    { letter: "B", min: 83, max: 92 },
    { letter: "C", min: 73, max: 82 },
  ],
  reports_weighted_grades: false,
  weighting_is_class_rank_only: false,
  weight_bonus: 1,
  // A table this org entered, which is what these fixtures represent.
  // Override to "verified" to exercise the precedence rules.
  origin: "org",
  ...over,
});

const athlete = { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null };
const TODAY = "2026-09-15";

describe("numeric credits that arrive as strings", () => {
  // Supabase returns numeric(4,2) as a string often enough that treating
  // it as a number gives NaN credits and a NaN GPA, which renders as
  // "NaN" on screen rather than failing loudly.
  it("does not produce NaN when credit comes back as a string", () => {
    const view = buildEligibilityView({
      courses: [course({ credit: "1.00" }), course({ credit: "0.50", subject: "math", title: "Algebra" })],
      scales: [],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa?.gpa).toBe(3);
    expect(Number.isNaN(view.eligibility.coreGpa?.totalCredits ?? NaN)).toBe(false);
  });
});

describe("a missing grading scale falls back to the default, and says so", () => {
  // This used to drop every numeric grade and return no GPA at all.
  // Changed on Dave's call (2026-09): a number with the assumption
  // attached beats a blank screen. The assertions below are the terms of
  // that trade, and dropping any one of them is what would make it
  // dishonest rather than useful.
  it("converts on the ten-point default and names the school that still needs a table", () => {
    const view = buildEligibilityView({
      courses: [course({ grade: "88" }), course({ grade: "91", subject: "math", title: "Algebra" })],
      scales: [],
      division: "D1",
      athlete,
      today: TODAY,
    });
    // 88 is a B and 91 an A on the ten-point default.
    expect(view.eligibility.coreGpa?.gpa).toBe(3.5);
    expect(view.skipped).toHaveLength(0);
    // The real table is still the thing to go get.
    expect(view.schoolsMissingScale).toEqual(["Bridge HS"]);
    expect(view.scalesUsed).toEqual([{ school: "Bridge HS", origin: "assumed", sourceNote: null }]);
    expect(view.adapterWarnings.join(" ")).toMatch(/estimate/);
  });

  it("still refuses a grade the default cannot convert either", () => {
    // The fallback is a conversion table, not a licence to invent a
    // grade. A marker like W or CR has no numeric value on any scale.
    const view = buildEligibilityView({
      courses: [course({ grade: "W" })],
      scales: [],
      division: "D1",
      athlete,
      today: TODAY,
    });
    // Refused by the engine rather than the adapter, since the adapter
    // hands a non-numeric grade straight through and the calculator is
    // what knows a W carries no quality points. Either way it is never
    // scored, and it never lands in the GPA.
    expect(view.eligibility.coreGpa?.gpa ?? null).toBeNull();
    expect(view.eligibility.coreGpa?.excluded.map((e) => e.reason).join(" ")).toMatch(/no quality points/);
  });

  it("converts numeric grades once the school's own table is supplied", () => {
    const view = buildEligibilityView({
      courses: [course({ grade: "88" }), course({ grade: "95", subject: "math", title: "Algebra" })],
      scales: [scale()],
      division: "D1",
      athlete,
      today: TODAY,
    });
    // 88 is a B on this school's table (3 points), 95 an A (4 points).
    expect(view.eligibility.coreGpa?.gpa).toBe(3.5);
    expect(view.schoolsMissingScale).toEqual([]);
  });

  it("does not flag a missing scale for a school whose grades are already letters", () => {
    const view = buildEligibilityView({
      courses: [course({ grade: "B" })],
      scales: [],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.schoolsMissingScale).toEqual([]);
    expect(view.eligibility.coreGpa?.gpa).toBe(3);
  });
});

describe("a transfer student with two high schools on one transcript", () => {
  // The real case: Westminster prints one scale, Cardinal Hayes another,
  // and both appear on the same PDF. Converting everything against one
  // school's table would be wrong for half the courses.
  it("converts each school's grades against that school's own table", () => {
    const view = buildEligibilityView({
      courses: [
        course({ school_name: "School A", grade: "88" }),
        course({ school_name: "School B", grade: "88", subject: "math", title: "Algebra" }),
      ],
      scales: [
        scale({ school_name: "School A", bands: [{ letter: "A", min: 85, max: 100 }] }),
        scale({ school_name: "School B", bands: [{ letter: "C", min: 85, max: 100 }] }),
      ],
      division: "D1",
      athlete,
      today: TODAY,
    });
    // An 88 is an A at one school and a C at the other. (4 + 2) / 2 = 3.
    expect(view.eligibility.coreGpa?.gpa).toBe(3);
  });

  it("reports only the school that is actually missing a table", () => {
    const view = buildEligibilityView({
      courses: [
        course({ school_name: "School A", grade: "88" }),
        course({ school_name: "School B", grade: "88", subject: "math", title: "Algebra" }),
      ],
      scales: [scale({ school_name: "School A" })],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.schoolsMissingScale).toEqual(["School B"]);
  });
});

describe("the weighted bonus follows the school, conservatively", () => {
  const ap = course({ title: "AP Biology", subject: "science", grade: "A", weighted: true });

  it("applies when the one school on the transcript qualifies", () => {
    const view = buildEligibilityView({
      courses: [ap],
      scales: [scale({ reports_weighted_grades: true })],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa?.gpa).toBeGreaterThan(4);
  });

  it("withholds it when any school on the transcript does not qualify", () => {
    const view = buildEligibilityView({
      courses: [ap, course({ school_name: "Other HS", grade: "A", title: "English 9" })],
      scales: [scale({ reports_weighted_grades: true })],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa?.gpa).toBe(4);
  });

  it("uses the school's own bonus amount rather than the NCAA cap", () => {
    // The NCAA allows up to 1.00. A school that adds 0.5 must not have
    // its AP students' core GPA overstated by half a point.
    const view = buildEligibilityView({
      courses: [ap],
      scales: [scale({ reports_weighted_grades: true, weight_bonus: 0.5 })],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa?.gpa).toBe(4.5);
  });

  it("still clamps a school that claims more than the NCAA allows", () => {
    const view = buildEligibilityView({
      courses: [ap],
      scales: [scale({ reports_weighted_grades: true, weight_bonus: 3 })],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa?.gpa).toBe(5);
  });

  it("withholds it when the weighting is class-rank only", () => {
    const view = buildEligibilityView({
      courses: [ap],
      scales: [scale({ reports_weighted_grades: true, weighting_is_class_rank_only: true })],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa?.gpa).toBe(4);
  });
});

describe("the age clock rides along with the verdict", () => {
  it("flags eligibility burned before enrollment", () => {
    const view = buildEligibilityView({
      courses: [course()],
      scales: [],
      division: "D1",
      athlete: { dateOfBirth: "2008-03-15", firstFullTimeEnrollment: null, intendedEnrollment: "2029-08-15" },
      today: TODAY,
    });
    expect(view.ageClock.startedBy).toBe("age");
    expect(view.ageClock.yearsBurnedAtEnrollment).toBeGreaterThan(1.9);
  });

  it("asks for a date of birth rather than assuming one", () => {
    const view = buildEligibilityView({
      courses: [course()],
      scales: [],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.ageClock.clockStart).toBeNull();
    expect(view.ageClock.warnings.join(" ")).toMatch(/No date of birth on file/i);
  });

  it("does not run for a D3 target", () => {
    const view = buildEligibilityView({
      courses: [course()],
      scales: [],
      division: "D3",
      athlete: { dateOfBirth: "2008-03-15", firstFullTimeEnrollment: null, intendedEnrollment: "2029-08-15" },
      today: TODAY,
    });
    expect(view.ageClock.applies).toBe(false);
    expect(view.eligibility.status).toBe("not_applicable");
    expect(view.eligibility.coreGpa).toBeNull();
  });
});

describe("non-academic courses are stored but never counted", () => {
  it("keeps PE out of the core GPA and says why", () => {
    const view = buildEligibilityView({
      courses: [course({ grade: "C" }), course({ title: "Phys. Ed. 11", subject: "non_academic", grade: "A", credit: 0.5 })],
      scales: [],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa?.gpa).toBe(2);
    expect(view.skipped.some((s) => s.title === "Phys. Ed. 11")).toBe(true);
  });
});

describe("parseBands", () => {
  it("degrades a malformed bands blob to empty rather than throwing", () => {
    expect(parseBands("not json at all")).toEqual([]);
    expect(parseBands([{ letter: "B", min: 83, max: 86 }])).toHaveLength(1);
  });
});

describe("a transfer student's two schools convert through their own tables", () => {
  // The case per-course school exists for. Both schools print an 85.
  // One calls it a B, the other calls it a C. Converting the whole
  // transcript against one table gets half of it wrong, and the error is
  // invisible: the GPA looks perfectly ordinary either way.
  const strict = scale({
    school_name: "Strict Prep",
    bands: [
      { letter: "A", min: 93, max: 100 },
      { letter: "B", min: 86, max: 92 },
      { letter: "C", min: 78, max: 85 },
      { letter: "F", min: 0, max: 77 },
    ],
  });
  const lenient = scale({
    school_name: "Lenient High",
    bands: [
      { letter: "A", min: 90, max: 100 },
      { letter: "B", min: 80, max: 89 },
      { letter: "C", min: 70, max: 79 },
      { letter: "F", min: 0, max: 69 },
    ],
  });

  it("scores the same number differently at each school", () => {
    const view = buildEligibilityView({
      courses: [
        course({ id: "1", grade: "85", school_name: "Strict Prep", title: "English 11" }),
        course({ id: "2", grade: "85", school_name: "Lenient High", subject: "math", title: "Algebra 2" }),
      ],
      scales: [strict, lenient],
      division: "D1",
      athlete,
      today: TODAY,
    });

    const counted = view.eligibility.coreGpa!.counted;
    const byTitle = (t: string) => counted.find((c) => c.course.title === t)!;
    // 85 at Strict Prep is a C, worth two points.
    expect(byTitle("English 11").qualityPoints).toBe(2);
    // The same 85 at Lenient High is a B, worth three.
    expect(byTitle("Algebra 2").qualityPoints).toBe(3);
    expect(view.eligibility.coreGpa!.gpa).toBe(2.5);
  });

  it("is not what happens when both rows take one school", () => {
    // The pre-fix behaviour, kept as a comparison so the difference is
    // on the record rather than asserted in a comment.
    const view = buildEligibilityView({
      courses: [
        course({ id: "1", grade: "85", school_name: "Lenient High", title: "English 11" }),
        course({ id: "2", grade: "85", school_name: "Lenient High", subject: "math", title: "Algebra 2" }),
      ],
      scales: [strict, lenient],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa!.gpa).toBe(3);
  });

  it("falls back per school, so one missing table does not spoil the other", () => {
    const view = buildEligibilityView({
      courses: [
        course({ id: "1", grade: "85", school_name: "Strict Prep", title: "English 11" }),
        course({ id: "2", grade: "85", school_name: "Nowhere HS", subject: "math", title: "Algebra 2" }),
      ],
      scales: [strict],
      division: "D1",
      athlete,
      today: TODAY,
    });

    // Strict Prep still converts through its own table.
    const counted = view.eligibility.coreGpa!.counted;
    expect(counted.find((c) => c.course.title === "English 11")!.qualityPoints).toBe(2);
    // Only the school with nothing on file is flagged and attributed as
    // an assumption.
    expect(view.schoolsMissingScale).toEqual(["Nowhere HS"]);
    expect(view.scalesUsed.filter((s) => s.origin === "assumed").map((s) => s.school)).toEqual(["Nowhere HS"]);
    expect(view.scalesUsed.filter((s) => s.origin === "org").map((s) => s.school)).toEqual(["Strict Prep"]);
  });
});
