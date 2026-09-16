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

describe("a missing grading scale is reported, never guessed around", () => {
  it("drops numeric grades and names the school that needs a table", () => {
    const view = buildEligibilityView({
      courses: [course({ grade: "88" }), course({ grade: "91", subject: "math", title: "Algebra" })],
      scales: [],
      division: "D1",
      athlete,
      today: TODAY,
    });
    expect(view.eligibility.coreGpa).toBeNull();
    expect(view.schoolsMissingScale).toEqual(["Bridge HS"]);
    expect(view.skipped).toHaveLength(2);
    expect(view.skipped[0]?.reason).toMatch(/conversion table is not on file/i);
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
