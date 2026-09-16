// The NCAA's core-course GPA, calculated the way the NCAA actually
// calculates it. Not the transcript GPA, and not a curve.
//
// Every rule here was read out of an NCAA-published document on
// 2026-09-15 and is cited inline. See docs/BUSINESS_RULES.md for the
// full source list and the fetch trick for fs.ncaa.org.
//
// The thing to understand before touching this file: a student's
// transcript GPA and their NCAA core GPA are different numbers, usually
// by a lot, and the NCAA one is the only one that decides whether they
// can play. Three reasons they diverge:
//
//   1. Only NCAA-approved core courses count. PE, art, most electives
//      and anything off the school's approved list are excluded, and
//      those are exactly the classes that pull a transcript GPA up.
//   2. Plus and minus do not exist. An A- is a full 4.0 and a B+ is
//      a 3.0, so a transcript full of B+ grades is worth noticeably
//      less to the NCAA than to the high school.
//   3. Only the best grades in each required subject area are used.
//
// This module is pure: plain types in, plain types out, no I/O, no
// dates read from the environment. It lives under src/lib/fit/ and
// obeys the walled-off rule in CLAUDE.md.

// "A = 4 points, B = 3 points, C = 2 points, D = 1 point"
// Core_GPA_Calculation.pdf, NCAA Eligibility Center.
const GRADE_POINTS: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

// "NCAA legislation does not permit the use of pluses and minuses."
// Grading_Scales_and_How_to_Update.pdf. So B+, B and B- are each worth
// exactly three quality points, and the suffix is stripped before the
// letter is scored. This is deliberately not configurable.
// Only a single letter, once pluses and minuses are stripped, is a
// grade. Taking the first character instead would read "CR"
// (credit-only) as a C worth two quality points, and a credit-only
// course carries no quality points at all.
export function gradePoints(rawGrade: string): number | null {
  const letter = (rawGrade || "").trim().toUpperCase().replace(/[+\-\s]/g, "");
  if (letter.length !== 1) return null;
  return letter in GRADE_POINTS ? GRADE_POINTS[letter]! : null;
}

// "Weighting is permitted only for courses titled honors, AP/IB or
// advanced", with "a maximum of 1.00 quality point" added.
export const MAX_WEIGHT_BONUS = 1.0;

// Subject areas as the NCAA groups them on its own DI/DII worksheet.
export type SubjectArea = "english" | "math" | "science" | "social_science" | "other_academic";

export interface CoreCourse {
  title: string;
  subject: SubjectArea;
  // Credit earned, in NCAA units. A full-year course is 1.00, a
  // semester course 0.50. Determining_Amount_of_Credit_for_Core_Courses.
  credit: number;
  // The letter as the high school reported it. Pluses and minuses are
  // accepted here and ignored by gradePoints(), so the original stays
  // visible to a human reviewing the record.
  grade: string;
  // True only when the course is titled honors, AP, IB or advanced.
  // Not enough on its own to earn the bonus: see weightBonus().
  weighted?: boolean;
  // How many bonus quality points the high school's own scale awards
  // this course. Capped at MAX_WEIGHT_BONUS regardless of what a school
  // claims, because the NCAA caps it.
  schoolWeightBonus?: number;
  // Set when the course is on the school's NCAA-approved course list.
  // Undefined means nobody has checked, which is not the same as false
  // and is reported separately.
  ncaaApproved?: boolean;
  // Marks a repeat or a content duplicate of another course. "credit
  // will be awarded for only one of the two courses (the higher grade
  // may count)". 2026-27 Guide for the College-Bound Student-Athlete.
  duplicateOf?: string;
}

// Per-subject credit minimums for the division being evaluated. Passed
// in because this module does not know about divisions; that is
// initialEligibility.ts's job.
export type SubjectMinimums = Partial<Record<SubjectArea, number>>;

export interface CoreGpaOptions {
  // Without this the selection is subject-blind, which produced a 4.00
  // core GPA out of sixteen electives while four English credits sat on
  // the transcript unused. "Only your best grades from approved courses
  // IN THE REQUIRED SUBJECT AREAS will be used": the subject areas are
  // half the rule and were being ignored.
  subjectMinimums?: SubjectMinimums;
  // The high school has told the Eligibility Center it awards weighted
  // grades. Without this the bonus is not applied at all, however the
  // courses are titled: "the high school must notify the Eligibility
  // Center that it awards weighted grades in these classes."
  schoolReportsWeightedGrades?: boolean;
  // "Weighted grades that are used only for class rank and do not
  // factor into a student's overall grade-point average cannot be
  // used." True here means the weighting is rank-only, so it is barred.
  weightingIsClassRankOnly?: boolean;
}

export interface CountedCourse {
  course: CoreCourse;
  points: number; // grade points after the weight bonus
  qualityPoints: number; // points x credit
  bonusApplied: number;
}

export interface CoreGpaResult {
  // Null when there is nothing legitimate to compute from. The caller
  // must never substitute the transcript GPA for this. Rounded to three
  // decimals for display.
  gpa: number | null;
  // The unrounded value. Threshold comparisons use this, because
  // rounding first crosses the 2.3 and 2.0 lines in the optimistic
  // direction.
  exactGpa: number | null;
  totalQualityPoints: number;
  totalCredits: number;
  counted: CountedCourse[];
  // Courses excluded and why, so a coordinator can see what was
  // dropped rather than wondering where the number came from.
  excluded: Array<{ course: CoreCourse; reason: string }>;
  creditsBySubject: Record<SubjectArea, number>;
  warnings: string[];
}

function bonusFor(course: CoreCourse, opts: CoreGpaOptions): number {
  if (!course.weighted) return 0;
  if (!opts.schoolReportsWeightedGrades) return 0;
  if (opts.weightingIsClassRankOnly) return 0;
  const claimed = course.schoolWeightBonus ?? 0;
  return Math.max(0, Math.min(MAX_WEIGHT_BONUS, claimed));
}

// Resolves repeats and content duplicates down to the single best
// grade, per the Guide.
//
// This deliberately acts ONLY on courses the caller explicitly tagged
// with duplicateOf. The first version keyed on the course title alone,
// which is wrong in a way that silently destroys credit: a transcript
// routinely lists one year-long course as two same-titled semester rows
// ("Algebra 2" fall 0.50, "Algebra 2" spring 0.50), and collapsing
// those throws away half the credit and half the quality points. A
// repeated course and a two-semester course look identical from the
// title. So same-titled courses are reported for a human to resolve,
// not merged automatically.
function dedupe(courses: CoreCourse[], opts: CoreGpaOptions): { kept: CoreCourse[]; dropped: Array<{ course: CoreCourse; reason: string }>; warnings: string[] } {
  const best = new Map<string, CoreCourse>();
  const dropped: Array<{ course: CoreCourse; reason: string }> = [];
  const warnings: string[] = [];
  const untagged: CoreCourse[] = [];

  // Tagging is routinely one-sided: a coordinator marks the RETAKE as a
  // duplicate and leaves the original alone, which is the natural thing
  // to do. Keying only on the tagged row then left the failed original
  // counting and the retake beside it, so the F that was supposed to be
  // replaced still dragged the average down and nothing warned. Any
  // untagged row sharing a title and subject with a tagged one joins
  // that group.
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const taggedTitles = new Map<string, string>();
  for (const course of courses) {
    if (course.duplicateOf) taggedTitles.set(`${course.subject}::${norm(course.title)}`, norm(course.duplicateOf));
  }

  for (const course of courses) {
    const sibling = taggedTitles.get(`${course.subject}::${norm(course.title)}`);
    if (!course.duplicateOf && !sibling) {
      untagged.push(course);
      continue;
    }
    const key = course.duplicateOf ? norm(course.duplicateOf) : sibling!;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, course);
      continue;
    }
    const a = (gradePoints(existing.grade) ?? -1) + bonusFor(existing, opts);
    const b = (gradePoints(course.grade) ?? -1) + bonusFor(course, opts);
    if (b > a) {
      best.set(key, course);
      dropped.push({ course: existing, reason: `Repeated course: the higher grade (${course.grade}) is the one that counts` });
    } else {
      dropped.push({ course, reason: `Repeated course: the higher grade (${existing.grade}) is the one that counts` });
    }
  }

  const seen = new Map<string, number>();
  for (const course of untagged) {
    const key = `${course.subject}::${course.title.trim().toLowerCase().replace(/\s+/g, " ")}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const repeats = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k.split("::")[1]);
  if (repeats.length) {
    warnings.push(
      `Same course title appears more than once (${repeats.join(", ")}). That is either a repeated course, where only the higher grade counts, or a year-long course split across two terms, where both halves count. Both are being counted until someone says which it is.`
    );
  }

  return { kept: [...best.values(), ...untagged], dropped, warnings };
}

// Fractional credits accumulate float error: eighty 0.2-credit courses
// sum to 15.999999999999975, which fails a >= 16 check and pulls in an
// extra failing grade. Every credit total is rounded at each step.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const EMPTY_BY_SUBJECT = (): Record<SubjectArea, number> => ({ english: 0, math: 0, science: 0, social_science: 0, other_academic: 0 });

// "Only your best grades from approved courses in the required subject
// areas will be used", so where a student has more core credits than
// the division requires, the weakest are left out rather than dragging
// the average down. requiredCredits is the division's total (16 for
// both DI and DII today); the per-subject minimums are enforced
// separately in initialEligibility.ts, which is the thing that knows
// about divisions.
export function calculateCoreGpa(courses: CoreCourse[], requiredCredits: number, opts: CoreGpaOptions = {}): CoreGpaResult {
  const warnings: string[] = [];
  const excluded: Array<{ course: CoreCourse; reason: string }> = [];

  const eligible: CoreCourse[] = [];
  for (const course of courses) {
    if (course.ncaaApproved === false) {
      excluded.push({ course, reason: "Not on the school's NCAA-approved course list" });
      continue;
    }
    if (gradePoints(course.grade) === null) {
      // Pass/fail, withdrawn, in progress, credit-only. No quality
      // points exist for these, so they cannot enter an average.
      excluded.push({ course, reason: `Grade "${course.grade}" carries no quality points` });
      continue;
    }
    if (!(course.credit > 0)) {
      excluded.push({ course, reason: "No credit earned" });
      continue;
    }
    eligible.push(course);
  }

  const unchecked = eligible.filter((c) => c.ncaaApproved === undefined).length;
  if (unchecked > 0) {
    warnings.push(
      `${unchecked} course(s) have not been checked against the school's NCAA-approved list. This GPA is an estimate until they are.`
    );
  }
  if (courses.some((c) => c.weighted) && !opts.schoolReportsWeightedGrades) {
    warnings.push("Honors/AP courses are present but the school is not on record with the Eligibility Center as awarding weighted grades, so no bonus was applied.");
  }
  if (opts.weightingIsClassRankOnly) {
    warnings.push("The school's weighting is used for class rank only, which the NCAA does not accept, so no bonus was applied.");
  }

  const { kept, dropped, warnings: dupWarnings } = dedupe(eligible, opts);
  excluded.push(...dropped);
  warnings.push(...dupWarnings);

  const scored: CountedCourse[] = kept
    .map((course) => {
      const bonusApplied = bonusFor(course, opts);
      const points = (gradePoints(course.grade) ?? 0) + bonusApplied;
      return { course, points, bonusApplied, qualityPoints: points * course.credit };
    })
    .sort((a, b) => b.points - a.points || b.course.credit - a.course.credit);

  // Selection happens in two passes, because the NCAA's sixteen are not
  // simply the sixteen best grades. Each subject area has a credit
  // minimum that must be filled from that subject, and only what is left
  // over is a free choice. Ranking the whole pool by grade and taking
  // the top sixteen, which is what this did first, hands back a 4.00
  // built from electives while the English requirement goes unmet and
  // the English credits sit on the transcript unused.
  const counted: CountedCourse[] = [];
  const takenCredit = new Map<CoreCourse, number>();
  let totalCredits = 0;

  // A course can be counted in part. The NCAA counts sixteen units, so
  // when the last course needed would carry the total past the
  // requirement, only the fraction that fits is taken rather than the
  // whole thing. Without this, sixteen 0.67-credit courses total 16.08
  // and the boundary grade is over-weighted.
  const take = (entry: CountedCourse, maxCredit: number): number => {
    const remaining = round2(requiredCredits - totalCredits);
    if (remaining <= 0) return 0;
    const credit = Math.min(maxCredit, remaining);
    if (credit <= 0) return 0;
    const already = takenCredit.get(entry.course) ?? 0;
    takenCredit.set(entry.course, round2(already + credit));
    totalCredits = round2(totalCredits + credit);
    const existing = counted.find((c) => c.course === entry.course);
    if (existing) {
      existing.qualityPoints = round3(existing.qualityPoints + entry.points * credit);
    } else {
      counted.push({ course: entry.course, points: entry.points, bonusApplied: entry.bonusApplied, qualityPoints: round3(entry.points * credit) });
    }
    return credit;
  };

  const mins = opts.subjectMinimums ?? {};
  for (const [subject, min] of Object.entries(mins) as Array<[SubjectArea, number]>) {
    if (!(min > 0)) continue;
    let filled = 0;
    for (const entry of scored) {
      if (filled >= min) break;
      if (entry.course.subject !== subject) continue;
      const free = round2(entry.course.credit - (takenCredit.get(entry.course) ?? 0));
      if (free <= 0) continue;
      filled = round2(filled + take(entry, Math.min(free, round2(min - filled))));
    }
  }

  for (const entry of scored) {
    const free = round2(entry.course.credit - (takenCredit.get(entry.course) ?? 0));
    if (free <= 0) continue;
    if (totalCredits >= requiredCredits) {
      if (!takenCredit.has(entry.course)) {
        excluded.push({ course: entry.course, reason: "Beyond the required core credits; only the best grades are used" });
      }
      continue;
    }
    take(entry, free);
  }

  if (!counted.length) {
    return { gpa: null, exactGpa: null, totalQualityPoints: 0, totalCredits: 0, counted, excluded, creditsBySubject: EMPTY_BY_SUBJECT(), warnings };
  }

  const creditsBySubject = EMPTY_BY_SUBJECT();
  let totalQualityPoints = 0;
  for (const entry of counted) {
    totalQualityPoints += entry.qualityPoints;
    creditsBySubject[entry.course.subject] = round2(creditsBySubject[entry.course.subject] + (takenCredit.get(entry.course) ?? 0));
  }

  if (totalCredits < requiredCredits) {
    warnings.push(`Only ${totalCredits.toFixed(2)} of the ${requiredCredits} required core credits are on this transcript, so this is a running GPA, not a final one.`);
  }

  // "Divide the total number of quality points for all core courses by
  // the total number of core-course units completed."
  // exactGpa is what the thresholds are compared against. Rounding
  // first and comparing second lets 2.2996875 report as 2.3 and clear a
  // 2.3 bar it does not actually meet, and the same at the 2.0 line
  // between an academic redshirt and a nonqualifier. Round for display
  // only.
  const exactGpa = totalQualityPoints / totalCredits;
  const gpa = round3(exactGpa);
  return {
    gpa,
    exactGpa,
    totalQualityPoints: round3(totalQualityPoints),
    totalCredits: round2(totalCredits),
    counted,
    excluded,
    creditsBySubject,
    warnings,
  };
}
