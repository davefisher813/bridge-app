// Tests for the NCAA modules. Every expected value here traces to a
// rule quoted in docs/BUSINESS_RULES.md with its source document.

import { describe, expect, it } from "vitest";
import { calculateCoreGpa, gradePoints, MAX_WEIGHT_BONUS, type CoreCourse } from "./coreGpa";
import { evaluateInitialEligibility, DIVISION_STANDARDS } from "./initialEligibility";
import { evaluateAgeClock } from "./ageClock";
import { coursesFromTranscript, letterFromScale } from "./fromTranscript";

const c = (over: Partial<CoreCourse> = {}): CoreCourse => ({
  title: "Course",
  subject: "english",
  credit: 1,
  grade: "B",
  ...over,
});

describe("the grade scale is the NCAA's, not a high school's", () => {
  it("uses A=4, B=3, C=2, D=1, F=0", () => {
    expect(gradePoints("A")).toBe(4);
    expect(gradePoints("B")).toBe(3);
    expect(gradePoints("C")).toBe(2);
    expect(gradePoints("D")).toBe(1);
    expect(gradePoints("F")).toBe(0);
  });

  // "NCAA legislation does not permit the use of pluses and minuses."
  // This is the rule most likely to be quietly reintroduced by someone
  // who thinks the scale looks wrong.
  it("gives plus and minus grades the same value as the bare letter", () => {
    expect(gradePoints("A-")).toBe(4);
    expect(gradePoints("A+")).toBe(4);
    expect(gradePoints("B+")).toBe(3);
    expect(gradePoints("B-")).toBe(3);
    expect(gradePoints("C+")).toBe(2);
  });

  it("returns null for grades that carry no quality points", () => {
    for (const g of ["P", "W", "I", "", "CR", "N/A"]) {
      expect(gradePoints(g)).toBeNull();
    }
  });
});

describe("quality points are credit-weighted", () => {
  it("an A in a full-year course is 4.00 quality points and in a half-credit course is 2.00", () => {
    const full = calculateCoreGpa([c({ grade: "A", credit: 1 })], 16);
    expect(full.totalQualityPoints).toBe(4);
    const half = calculateCoreGpa([c({ grade: "A", credit: 0.5 })], 16);
    expect(half.totalQualityPoints).toBe(2);
    // Both are still a 4.0 average; credit changes the weight, not the mean.
    expect(full.gpa).toBe(4);
    expect(half.gpa).toBe(4);
  });

  it("divides total quality points by total core units", () => {
    const r = calculateCoreGpa([c({ title: "English 9", grade: "A", credit: 1 }), c({ title: "Algebra 1", grade: "C", credit: 1, subject: "math" })], 16);
    expect(r.totalQualityPoints).toBe(6);
    expect(r.totalCredits).toBe(2);
    expect(r.gpa).toBe(3);
  });

  // A year-long course split into two same-titled semester rows is
  // indistinguishable from a repeat by title alone. Merging them would
  // silently destroy half the credit, so both halves count and a human
  // is asked.
  it("keeps both halves of a year-long course split across two terms", () => {
    const r = calculateCoreGpa(
      [c({ title: "Algebra 2", subject: "math", grade: "A", credit: 0.5 }), c({ title: "Algebra 2", subject: "math", grade: "A", credit: 0.5 })],
      16
    );
    expect(r.totalCredits).toBe(1);
    expect(r.totalQualityPoints).toBe(4);
    expect(r.warnings.join(" ")).toMatch(/appears more than once/i);
  });
});

describe("the weighted-grade bonus and its three conditions", () => {
  const ap = c({ grade: "A", weighted: true, schoolWeightBonus: 1 });

  it("applies the bonus when the school is on record and the weighting is real", () => {
    const r = calculateCoreGpa([ap], 16, { schoolReportsWeightedGrades: true });
    expect(r.gpa).toBe(5);
  });

  it("refuses the bonus when the school has not told the Eligibility Center", () => {
    const r = calculateCoreGpa([ap], 16, {});
    expect(r.gpa).toBe(4);
    expect(r.warnings.join(" ")).toMatch(/not on record/i);
  });

  it("refuses the bonus when the weighting is for class rank only", () => {
    const r = calculateCoreGpa([ap], 16, { schoolReportsWeightedGrades: true, weightingIsClassRankOnly: true });
    expect(r.gpa).toBe(4);
    expect(r.warnings.join(" ")).toMatch(/class rank only/i);
  });

  it("caps the bonus at 1.00 even when a school claims more", () => {
    const greedy = c({ grade: "A", weighted: true, schoolWeightBonus: 3 });
    const r = calculateCoreGpa([greedy], 16, { schoolReportsWeightedGrades: true });
    expect(r.gpa).toBe(4 + MAX_WEIGHT_BONUS);
  });

  it("gives no bonus to a course that is not titled honors, AP, IB or advanced", () => {
    const plain = c({ grade: "A", weighted: false, schoolWeightBonus: 1 });
    expect(calculateCoreGpa([plain], 16, { schoolReportsWeightedGrades: true }).gpa).toBe(4);
  });
});

describe("only approved core courses, only the best grades", () => {
  it("excludes a course that is not on the school's NCAA-approved list", () => {
    const r = calculateCoreGpa([c({ grade: "A", ncaaApproved: true }), c({ title: "Weight Training", grade: "A", ncaaApproved: false })], 16);
    expect(r.counted).toHaveLength(1);
    expect(r.excluded[0]?.reason).toMatch(/approved course list/i);
  });

  it("warns rather than pretending, when approval has not been checked", () => {
    const r = calculateCoreGpa([c({ grade: "A" })], 16);
    expect(r.warnings.join(" ")).toMatch(/not been checked against/i);
  });

  it("counts a course tagged as a repeat once, keeping the higher grade", () => {
    const r = calculateCoreGpa(
      [c({ title: "Algebra 1", grade: "D", duplicateOf: "algebra-1" }), c({ title: "Algebra 1 retake", grade: "B", duplicateOf: "algebra-1" })],
      16
    );
    expect(r.counted).toHaveLength(1);
    expect(r.counted[0]?.course.grade).toBe("B");
    expect(r.gpa).toBe(3);
  });

  it("drops the weakest extras once the required credits are filled", () => {
    const courses = [
      ...Array.from({ length: 16 }, () => c({ grade: "A", title: `A${Math.random()}` })),
      c({ title: "Extra F", grade: "F" }),
    ];
    const r = calculateCoreGpa(courses, 16);
    expect(r.gpa).toBe(4);
    expect(r.excluded.some((e) => e.reason.match(/only the best grades are used/i))).toBe(true);
  });
});

describe("the transcript GPA is not the NCAA GPA", () => {
  // The case that actually ruins a recruit's year: a solid-looking
  // transcript where the electives carry it and the core does not.
  it("a student whose electives carry their average is not a D1 qualifier", () => {
    const core: CoreCourse[] = [
      ...Array.from({ length: 4 }, (_, i) => c({ title: `English ${i}`, subject: "english", grade: "C", ncaaApproved: true })),
      ...Array.from({ length: 3 }, (_, i) => c({ title: `Math ${i}`, subject: "math", grade: "C", ncaaApproved: true })),
      ...Array.from({ length: 2 }, (_, i) => c({ title: `Science ${i}`, subject: "science", grade: "C", ncaaApproved: true })),
      ...Array.from({ length: 2 }, (_, i) => c({ title: `History ${i}`, subject: "social_science", grade: "B", ncaaApproved: true })),
      ...Array.from({ length: 5 }, (_, i) => c({ title: `Academic elective ${i}`, subject: "other_academic", grade: "C", ncaaApproved: true })),
    ];
    // Six A grades in classes that are not on the NCAA-approved list.
    // On the transcript they lift the average well above 2.3.
    const nonCore: CoreCourse[] = Array.from({ length: 6 }, (_, i) =>
      c({ title: `PE ${i}`, subject: "other_academic", grade: "A", ncaaApproved: false })
    );

    const everything = [...core, ...nonCore];
    const transcriptStyle = everything.reduce((sum, x) => sum + (x.grade === "A" ? 4 : x.grade === "B" ? 3 : 2), 0) / everything.length;
    expect(transcriptStyle).toBeGreaterThan(DIVISION_STANDARDS.D1.qualifierGpa);

    const result = evaluateInitialEligibility({ division: "D1", courses: everything });
    // Core only: 14 C and 2 B over 16 credits = (28 + 6) / 16 = 2.125
    expect(result.coreGpa?.gpa).toBe(2.125);
    expect(result.coreGpa!.gpa!).toBeLessThan(DIVISION_STANDARDS.D1.qualifierGpa);
    expect(result.status).toBe("academic_redshirt");
    expect(result.yearOne).toMatch(/cannot compete/i);
  });
});

describe("initial-eligibility status by division", () => {
  const sixteen = (grade: string): CoreCourse[] =>
    Array.from({ length: 16 }, (_, i) => c({ title: `Core ${i}`, grade, ncaaApproved: true, subject: i < 4 ? "english" : i < 7 ? "math" : i < 9 ? "science" : i < 11 ? "social_science" : "other_academic" }));

  it("D1 qualifier at 2.3 and above", () => {
    // 11 B and 5 C over 16 credits = (33 + 10) / 16 = 2.6875
    const mixed = [...sixteen("B").slice(0, 11), ...sixteen("C").slice(11)];
    const r = evaluateInitialEligibility({ division: "D1", courses: mixed });
    expect(r.coreGpa!.gpa).toBeGreaterThanOrEqual(2.3);
    expect(r.status).toBe("qualifier");
  });

  it("D1 academic redshirt between 2.0 and 2.3", () => {
    // 5 B and 11 C = (15 + 22) / 16 = 2.3125, so use 4 B / 12 C = 2.25
    const mixed = [...sixteen("B").slice(0, 4), ...sixteen("C").slice(4)];
    const r = evaluateInitialEligibility({ division: "D1", courses: mixed });
    expect(r.coreGpa!.gpa).toBe(2.25);
    expect(r.status).toBe("academic_redshirt");
  });

  it("D1 nonqualifier below 2.0", () => {
    const r = evaluateInitialEligibility({ division: "D1", courses: sixteen("D") });
    expect(r.status).toBe("nonqualifier");
    expect(r.yearOne).toMatch(/cannot receive athletics aid/i);
  });

  it("D1 early academic qualifier at 3.0 with 14 credits", () => {
    const r = evaluateInitialEligibility({ division: "D1", courses: sixteen("B").slice(0, 14) });
    expect(r.status).toBe("early_academic_qualifier");
  });

  // This used to assert two constants against themselves and never call
  // the function, so it would have passed even if the D2 branch read the
  // wrong field entirely.
  it("D2 qualifier uses 2.2, not D1's 2.3, and the difference is visible in a verdict", () => {
    expect(DIVISION_STANDARDS.D2.qualifierGpa).toBe(2.2);
    expect(DIVISION_STANDARDS.D1.qualifierGpa).toBe(2.3);
    // 2.25 sits between the two bars.
    const mixed = [...sixteen("B").slice(0, 4), ...sixteen("C").slice(4)];
    expect(evaluateInitialEligibility({ division: "D2", courses: mixed }).status).toBe("qualifier");
    expect(evaluateInitialEligibility({ division: "D1", courses: mixed }).status).toBe("academic_redshirt");
  });

  // The NCAA does not publish the D2 partial-qualifier floor, so the
  // app must not invent one.
  it("refuses to declare a D2 nonqualifier, because the partial-qualifier floor is unpublished", () => {
    expect(DIVISION_STANDARDS.D2.secondTierGpa).toBeNull();
    const r = evaluateInitialEligibility({ division: "D2", courses: sixteen("D") });
    expect(r.status).toBe("insufficient_data");
    expect(r.warnings.join(" ")).toMatch(/does not publish/i);
  });

  it("never produces a core GPA or a status for D3", () => {
    for (const div of ["D3", "NCAA D3", "Division III"]) {
      const r = evaluateInitialEligibility({ division: div, courses: sixteen("A") });
      expect(r.status).toBe("not_applicable");
      expect(r.coreGpa).toBeNull();
      expect(r.reasons.join(" ")).toMatch(/sets its own|no NCAA core-course GPA/i);
    }
  });

  it("says so rather than guessing when there is no course list", () => {
    const r = evaluateInitialEligibility({ division: "D1", courses: [] });
    expect(r.status).toBe("insufficient_data");
    expect(r.warnings.join(" ")).toMatch(/cannot be calculated from a transcript GPA alone/i);
  });

  // Asserting only on the warning text let the verdict beside it read
  // "can compete in year one" while the warning said the requirement was
  // missed and could not be fixed. The status is the thing the screen
  // renders, so the status is what this checks.
  it("flags a 10/7 failure, says it cannot be fixed later, and does not still call them a qualifier", () => {
    const r = evaluateInitialEligibility({ division: "D1", courses: sixteen("B"), preSeventhSemester: { totalCredits: 8, emsCredits: 5 } });
    expect(r.warnings.join(" ")).toMatch(/10\/7 rule not met/i);
    expect(r.warnings.join(" ")).toMatch(/cannot be fixed after senior year/i);
    expect(r.status).not.toBe("qualifier");
    expect(r.status).not.toBe("early_academic_qualifier");
    expect(r.yearOne).not.toMatch(/compete in year one/i);
  });

  it("does not apply the 10/7 rule to D2", () => {
    expect(DIVISION_STANDARDS.D2.tenSevenRule).toBe(false);
    const r = evaluateInitialEligibility({ division: "D2", courses: sixteen("B"), preSeventhSemester: { totalCredits: 2, emsCredits: 0 } });
    expect(r.warnings.join(" ")).not.toMatch(/10\/7/);
  });
});

describe("turning a real transcript's rows into scorable courses", () => {
  // Modelled on the Westminster transcript, which prints its own table:
  // 100-93 A, 92-90 A-, 89-87 B+, 86-83 B, and so on.
  const westminster = [
    { letter: "A", min: 93, max: 100 },
    { letter: "A-", min: 90, max: 92 },
    { letter: "B+", min: 87, max: 89 },
    { letter: "B", min: 83, max: 86 },
    { letter: "C+", min: 80, max: 82 },
  ];

  it("uses the school's printed table, and the plus/minus in it still scores as the bare letter", () => {
    const r = coursesFromTranscript(
      [
        { title: "Pre-Calculus", subject: "math", credit: 0.67, grade: "86" },
        { title: "Physics", subject: "science", credit: 0.67, grade: "88" },
      ],
      { gradingScale: westminster }
    );
    expect(r.courses.map((x) => x.grade)).toEqual(["B", "B+"]);
    // 86 becomes a B (3 points) and 88 a B+, which the NCAA also scores
    // as 3. The school's own table decides the letter; the NCAA decides
    // what the letter is worth.
    const gpa = calculateCoreGpa(r.courses, 16);
    expect(gpa.gpa).toBe(3);
  });

  it("refuses to score a numeric grade when the school's table is not on file", () => {
    const r = coursesFromTranscript([{ title: "Algebra 2", subject: "math", credit: 1, grade: "89" }], { schoolName: "Cardinal Hayes" });
    expect(r.courses).toHaveLength(0);
    expect(r.skipped[0]?.reason).toMatch(/conversion table is not on file/i);
    expect(r.warnings.join(" ")).toMatch(/Cardinal Hayes's numeric-to-letter table/i);
  });

  it("puts a weighted grade above the top band into the top band rather than dropping it", () => {
    // Cardinal Hayes weights H/R courses and prints grades like 102.
    expect(letterFromScale(102, westminster)).toBe("A");
  });

  it("drops PE and electives, which is where a transcript GPA gets its lift", () => {
    const r = coursesFromTranscript([
      { title: "English 11", subject: "english", credit: 1, grade: "B" },
      { title: "Phys. Ed. 11", subject: "non_academic", credit: 0.5, grade: "A" },
    ]);
    expect(r.courses).toHaveLength(1);
    expect(r.skipped[0]?.reason).toMatch(/not an academic subject/i);
  });

  it("leaves NCAA approval unchecked rather than assuming it", () => {
    const r = coursesFromTranscript([{ title: "English 11", subject: "english", credit: 1, grade: "B" }]);
    expect(r.courses[0]?.ncaaApproved).toBeUndefined();
    expect(calculateCoreGpa(r.courses, 16).warnings.join(" ")).toMatch(/not been checked/i);
  });
});

describe("the age-based eligibility clock", () => {
  it("starts the clock at the academic year after a 19th birthday that falls before September 1", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", intendedEnrollment: "2028-08-15", today: "2026-09-15" });
    expect(r.startedBy).toBe("age");
    expect(r.clockStart).toBe("2027-08-01");
    expect(r.clockEnd).toBe("2032-08-01");
  });

  it("does not start on age when the athlete turns 19 on or after September 1", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-10-01", division: "D1", today: "2026-09-15" });
    expect(r.startedBy).toBeNull();
    expect(r.clockStart).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/on or after September 1/i);
  });

  it("uses first enrollment when that comes before the age trigger", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", firstFullTimeEnrollment: "2026-08-20", today: "2026-09-15" });
    expect(r.startedBy).toBe("enrollment");
    expect(r.clockStart).toBe("2026-08-20");
  });

  // The whole reason this module exists.
  it("shows eligibility burned by a post-grad year before the athlete ever enrolls", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", intendedEnrollment: "2029-08-15", today: "2026-09-15" });
    // Clock starts 2027-08-01 and ends 2032-08-01. Enrolling 2029-08-15
    // is two years and two weeks in, so the tolerance is tight enough to
    // catch a real drift rather than accepting any value in a year-wide
    // window.
    expect(r.yearsBurnedAtEnrollment).toBeCloseTo(2.04, 1);
    expect(r.yearsRemainingAtEnrollment).toBeCloseTo(2.96, 1);
    expect(r.warnings.join(" ")).toMatch(/post-grad year, prep year or gap year/i);
  });

  it("does not apply to D3", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D3", today: "2026-09-15" });
    expect(r.applies).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/Divisions I and II only/i);
  });

  it("asks for a date of birth rather than assuming one", () => {
    const r = evaluateAgeClock({ dateOfBirth: "", division: "D1", today: "2026-09-15" });
    expect(r.applies).toBe(true);
    expect(r.clockStart).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/No date of birth on file/i);
  });

  it("notes the transition rule for anyone enrolling before fall 2027", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", intendedEnrollment: "2026-08-20", today: "2026-09-15" });
    expect(r.warnings.join(" ")).toMatch(/either the old rules or the age-based rules/i);
  });
});
