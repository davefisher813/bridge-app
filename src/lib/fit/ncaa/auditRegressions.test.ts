// Regressions for the 2026-09-16 audit. Every case here produced a
// wrong answer before the fix in the same commit, and most of them
// produced it silently and in the optimistic direction, which is the
// dangerous one: a screen that tells a family their kid is eligible when
// he is not.
//
// The existing suite stayed green through all of these, which is the
// second finding of that audit and the reason this file asserts on
// status and numbers rather than on the presence of warning strings.

import { describe, expect, it } from "vitest";
import { calculateCoreGpa, type CoreCourse } from "./coreGpa";
import { evaluateInitialEligibility, DIVISION_STANDARDS } from "./initialEligibility";
import { evaluateAgeClock } from "./ageClock";
import { coursesFromTranscript } from "./fromTranscript";

const c = (over: Partial<CoreCourse> = {}): CoreCourse => ({
  title: "Course",
  subject: "english",
  credit: 1,
  grade: "B",
  ncaaApproved: true,
  ...over,
});

// A full, distribution-correct D1 core: 4 English, 3 math, 2 science,
// 2 social science, 5 other academic.
function fullCore(grade: string): CoreCourse[] {
  const spec: Array<[CoreCourse["subject"], number]> = [
    ["english", 4],
    ["math", 3],
    ["science", 2],
    ["social_science", 2],
    ["other_academic", 5],
  ];
  const out: CoreCourse[] = [];
  for (const [subject, n] of spec) {
    for (let i = 0; i < n; i++) out.push(c({ title: `${subject} ${i}`, subject, grade }));
  }
  return out;
}

describe("the age clock and the August birthday band", () => {
  // A 19th birthday on 15 August 2027 is before the September 1 cutoff,
  // so the clock starts with the 2027 academic year. The old code looked
  // for the next August 1 falling on or after the birthday and found
  // August 2028, handing the athlete a full extra year that does not
  // exist. One day of difference in date of birth moved the answer by a
  // year.
  it("starts the clock in the birthday's own academic year for every month before September", () => {
    for (const [dob, expected] of [
      ["2008-01-05", "2027-08-01"],
      ["2008-03-15", "2027-08-01"],
      ["2008-07-31", "2027-08-01"],
      ["2008-08-01", "2027-08-01"],
      ["2008-08-15", "2027-08-01"],
      ["2008-08-31", "2027-08-01"],
    ] as const) {
      const r = evaluateAgeClock({ dateOfBirth: dob, division: "D1", today: "2026-09-15" });
      expect(`${dob} -> ${r.clockStart}`).toBe(`${dob} -> ${expected}`);
    }
  });

  it("still does not start on age for a birthday on or after September 1", () => {
    for (const dob of ["2008-09-01", "2008-09-02", "2008-12-25"]) {
      expect(evaluateAgeClock({ dateOfBirth: dob, division: "D1", today: "2026-09-15" }).clockStart).toBeNull();
    }
  });

  it("does not roll a leap-year birthday into March", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-02-29", division: "D1", today: "2026-09-15" });
    expect(r.reasons.join(" ")).toMatch(/Turns 19 on 2027-02-28/);
  });

  it("does not report an unexpired window as expired", () => {
    // clockEnd is 2032-08-01; two days earlier is not "already expired".
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", intendedEnrollment: "2032-07-30", today: "2026-09-15" });
    expect(r.clockEnd).toBe("2032-08-01");
    expect(r.yearsRemainingAtEnrollment).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).not.toMatch(/already expired/i);
  });

  it("recognises the DI and DII spellings", () => {
    expect(evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "DI", today: "2026-09-15" }).applies).toBe(true);
    expect(evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "DII", today: "2026-09-15" }).applies).toBe(true);
    expect(evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "DIII", today: "2026-09-15" }).applies).toBe(false);
  });
});

describe("a status is never promised on credits the athlete has not earned", () => {
  // Two core credits used to return "Qualifier. Can receive aid,
  // practice and compete in year one", because the tier check looked
  // only at GPA and the credit column of the standards table was never
  // read.
  it("marks a verdict built on partial credits as a projection", () => {
    const r = evaluateInitialEligibility({ division: "D1", courses: [c({ title: "English 11" }), c({ title: "Algebra 2", subject: "math" })] });
    expect(r.coreGpa!.totalCredits).toBe(2);
    expect(r.projected).toBe(true);
    expect(r.yearOne).not.toMatch(/can receive aid, practice and compete/i);
    expect(r.yearOne).toMatch(/2 of 16 core credits/);
  });

  it("does not mark a complete core as a projection", () => {
    const r = evaluateInitialEligibility({ division: "D1", courses: fullCore("B") });
    expect(r.projected).toBe(false);
    expect(r.status).toBe("qualifier");
    expect(r.yearOne).toMatch(/compete in year one/i);
  });

  it("does not call a finished 3.5 student an EARLY academic qualifier", () => {
    const sixteen = fullCore("A").slice(0, 8).concat(fullCore("B").slice(8));
    const r = evaluateInitialEligibility({ division: "D1", courses: sixteen });
    expect(r.coreGpa!.totalCredits).toBe(16);
    expect(r.status).toBe("qualifier");
  });

  it("still awards early academic qualifier to someone genuinely early", () => {
    const fourteen = fullCore("A").slice(0, 14);
    const r = evaluateInitialEligibility({ division: "D1", courses: fourteen });
    expect(r.status).toBe("early_academic_qualifier");
    expect(r.projected).toBe(true);
  });
});

describe("a failed 10/7 changes the verdict, not just a warning", () => {
  // The old version put "This cannot be fixed after senior year begins"
  // in the warnings and left the verdict beside it reading "can compete
  // in year one".
  it("refuses a qualifier result when 10/7 provably failed", () => {
    const r = evaluateInitialEligibility({
      division: "D1",
      courses: fullCore("B"),
      preSeventhSemester: { totalCredits: 2, emsCredits: 0 },
    });
    expect(r.status).not.toBe("qualifier");
    expect(r.status).not.toBe("early_academic_qualifier");
    expect(r.yearOne).not.toMatch(/compete in year one/i);
  });

  it("leaves a met 10/7 alone", () => {
    const r = evaluateInitialEligibility({
      division: "D1",
      courses: fullCore("B"),
      preSeventhSemester: { totalCredits: 11, emsCredits: 8 },
    });
    expect(r.status).toBe("qualifier");
  });

  it("does not apply 10/7 to D2", () => {
    const r = evaluateInitialEligibility({
      division: "D2",
      courses: fullCore("B"),
      preSeventhSemester: { totalCredits: 0, emsCredits: 0 },
    });
    expect(r.status).toBe("qualifier");
  });
});

describe("the sixteen are chosen inside the required subject areas", () => {
  // Ranking the whole pool by grade and taking the top sixteen returned
  // a 4.00 built entirely from electives while four English credits and
  // three math credits sat on the transcript unused, and then warned
  // "english 0 of 4" about a student who had four English credits.
  it("does not build a 4.00 out of electives while ignoring English on the same transcript", () => {
    const courses = [
      ...Array.from({ length: 16 }, (_, i) => c({ title: `Elective ${i}`, subject: "other_academic", grade: "A" })),
      ...Array.from({ length: 4 }, (_, i) => c({ title: `English ${i}`, subject: "english", grade: "D" })),
      ...Array.from({ length: 3 }, (_, i) => c({ title: `Math ${i}`, subject: "math", grade: "D" })),
    ];
    const r = evaluateInitialEligibility({ division: "D1", courses });
    expect(r.coreGpa!.gpa).toBeLessThan(4);
    expect(r.coreGpa!.creditsBySubject.english).toBe(4);
    expect(r.coreGpa!.creditsBySubject.math).toBe(3);
  });

  it("fills a subject minimum with that subject's best grades", () => {
    const courses = [
      c({ title: "English A", subject: "english", grade: "A" }),
      c({ title: "English B", subject: "english", grade: "D" }),
      ...Array.from({ length: 20 }, (_, i) => c({ title: `Elective ${i}`, subject: "other_academic", grade: "A" })),
    ];
    const r = calculateCoreGpa(courses, 16, { subjectMinimums: { english: 1 } });
    const english = r.counted.filter((x) => x.course.subject === "english");
    expect(english).toHaveLength(1);
    expect(english[0]!.course.grade).toBe("A");
  });
});

describe("credit totals are exact", () => {
  it("does not overshoot the requirement with fractional credits", () => {
    const courses = Array.from({ length: 30 }, (_, i) => c({ title: `Course ${i}`, credit: 0.67, grade: i < 24 ? "A" : "F" }));
    const r = calculateCoreGpa(courses, 16);
    expect(r.totalCredits).toBe(16);
  });

  it("does not let float drift pull in an extra failing grade", () => {
    // Eighty 0.2-credit courses sum to 15.999999999999975 in floating
    // point, which fails a >= 16 check and used to admit an F.
    const courses = Array.from({ length: 90 }, (_, i) => c({ title: `Course ${i}`, credit: 0.2, grade: i < 80 ? "A" : "F" }));
    const r = calculateCoreGpa(courses, 16);
    expect(r.totalCredits).toBe(16);
    expect(r.gpa).toBe(4);
  });
});

describe("thresholds compare the unrounded GPA", () => {
  // 2.2996875 rounds to 2.3 for display. Comparing the rounded value
  // cleared a 2.3 bar the athlete does not meet, and did the same at the
  // 2.0 line between an academic redshirt (aid and practice) and a
  // nonqualifier (neither).
  it("does not let a value that rounds to 2.3 become a qualifier", () => {
    const courses = [
      ...Array.from({ length: 4 }, (_, i) => c({ title: `d${i}`, grade: "D" })),
      ...Array.from({ length: 8 }, (_, i) => c({ title: `c${i}`, grade: "C", subject: "math" })),
      ...Array.from({ length: 3 }, (_, i) => c({ title: `a${i}`, grade: "A", subject: "science" })),
      c({ title: "ap", grade: "A", subject: "social_science", weighted: true, schoolWeightBonus: 0.795 }),
    ];
    const r = calculateCoreGpa(courses, 16, { schoolReportsWeightedGrades: true });
    expect(r.gpa).toBe(2.3);
    expect(r.exactGpa!).toBeLessThan(2.3);
    const e = evaluateInitialEligibility({ division: "D1", courses, gpaOptions: { schoolReportsWeightedGrades: true } });
    expect(e.status).toBe("academic_redshirt");
  });
});

describe("a one-sided duplicate tag still resolves", () => {
  // A coordinator marks the RETAKE as a duplicate and leaves the
  // original alone, which is the natural thing to do. Keying only on the
  // tagged row left the failed original counting beside the retake.
  it("drops the original when only the retake is tagged", () => {
    const r = calculateCoreGpa(
      [c({ title: "Algebra 1", subject: "math", grade: "F" }), c({ title: "Algebra 1", subject: "math", grade: "A", duplicateOf: "algebra-1" })],
      16
    );
    expect(r.counted).toHaveLength(1);
    expect(r.counted[0]!.course.grade).toBe("A");
    expect(r.gpa).toBe(4);
  });

  it("leaves genuinely untagged same-titled rows alone", () => {
    const r = calculateCoreGpa(
      [c({ title: "Algebra 2", subject: "math", grade: "A", credit: 0.5 }), c({ title: "Algebra 2", subject: "math", grade: "A", credit: 0.5 })],
      16
    );
    expect(r.totalCredits).toBe(1);
  });
});

describe("a numeric grade outside the school's table is never silently dropped", () => {
  // Dropping the failures and keeping the passes raises the core GPA,
  // so silence here is the worst possible behaviour. The warning only
  // fired when NO scale was on file.
  it("warns when a grade falls below every band of the table on file", () => {
    const r = coursesFromTranscript(
      [
        { title: "English 11", subject: "english", credit: 1, grade: "95" },
        { title: "Chemistry", subject: "science", credit: 1, grade: "62" },
      ],
      { gradingScale: [{ letter: "A", min: 90, max: 100 }, { letter: "B", min: 80, max: 89 }], schoolName: "Test HS" }
    );
    expect(r.courses).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/fall outside every band/i);
    expect(r.warnings.join(" ")).toMatch(/higher than the real one/i);
  });
});

describe("division spellings that were silently unrecognised", () => {
  it("treats DI, DII and DIII as the divisions they are", () => {
    expect(evaluateInitialEligibility({ division: "DI", courses: fullCore("B") }).division).toBe("D1");
    expect(evaluateInitialEligibility({ division: "DII", courses: fullCore("B") }).division).toBe("D2");
    expect(evaluateInitialEligibility({ division: "DIII", courses: fullCore("B") }).status).toBe("not_applicable");
  });

  it("applies the right threshold to a D2 athlete between the two divisions' bars", () => {
    // 2.25 clears D2's 2.2 and misses D1's 2.3. There was no test
    // anywhere that a D2 athlete in this band is a qualifier.
    const courses = [...fullCore("B").slice(0, 4), ...fullCore("C").slice(4)];
    const gpa = calculateCoreGpa(courses, 16).exactGpa!;
    expect(gpa).toBeGreaterThan(DIVISION_STANDARDS.D2.qualifierGpa);
    expect(gpa).toBeLessThan(DIVISION_STANDARDS.D1.qualifierGpa);
    expect(evaluateInitialEligibility({ division: "D2", courses }).status).toBe("qualifier");
    expect(evaluateInitialEligibility({ division: "D1", courses }).status).toBe("academic_redshirt");
  });
});
