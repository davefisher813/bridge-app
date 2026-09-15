// NCAA initial-eligibility status for a high school athlete: qualifier,
// academic redshirt, or nonqualifier, plus the D1 10/7 timing rule.
//
// Before this existed, scoreEligibility() returned "not evaluated" for
// anyone whose detail was not a transfer, which meant high school
// athletes never got an NCAA check at all. That is Bridge's entire
// population.
//
// Thresholds read from the NCAA high-school initial-eligibility
// presentation and the DI requirements fact sheet on 2026-09-15, cited
// in docs/BUSINESS_RULES.md. They move by convention vote; they are
// constants in one place here so a change is a one-line edit.

import { calculateCoreGpa, type CoreCourse, type CoreGpaOptions, type CoreGpaResult, type SubjectArea } from "./coreGpa";

export type EligibilityDivision = "D1" | "D2";

export type EligibilityStatus =
  | "early_academic_qualifier"
  | "qualifier"
  | "academic_redshirt" // D1 term
  | "partial_qualifier" // D2 term
  | "nonqualifier"
  | "not_applicable" // D3 and anything outside the NCAA
  | "insufficient_data";

export interface DivisionStandard {
  coreCredits: number;
  qualifierGpa: number;
  // D1 calls this the academic redshirt band. D2 calls its equivalent a
  // partial qualifier and does not publish the floor (see below), so
  // this is null there rather than a guess.
  secondTierGpa: number | null;
  secondTierStatus: "academic_redshirt" | "partial_qualifier";
  earlyQualifierGpa: number;
  earlyQualifierCredits: number;
  // Minimum credits per subject area, from the official DI/DII
  // worksheet. "additionalEms" is the extra English/math/science block
  // the worksheet lists separately from the three core subjects.
  subjectMinimums: Record<SubjectArea, number> & { additionalEms: number };
  // D1 only. Ten of the sixteen, seven of them in English, math or
  // science, before the seventh semester starts.
  tenSevenRule: boolean;
}

export const DIVISION_STANDARDS: Record<EligibilityDivision, DivisionStandard> = {
  D1: {
    coreCredits: 16,
    qualifierGpa: 2.3,
    secondTierGpa: 2.0,
    secondTierStatus: "academic_redshirt",
    earlyQualifierGpa: 3.0,
    earlyQualifierCredits: 14,
    subjectMinimums: { english: 4, math: 3, science: 2, social_science: 2, other_academic: 4, additionalEms: 1 },
    tenSevenRule: true,
  },
  D2: {
    coreCredits: 16,
    qualifierGpa: 2.2,
    // The NCAA does not publish a partial-qualifier GPA floor on any
    // page that could be retrieved on 2026-09-15. Null means the app
    // says "below the qualifier standard, check with the Eligibility
    // Center" instead of inventing a cutoff.
    secondTierGpa: null,
    secondTierStatus: "partial_qualifier",
    earlyQualifierGpa: 2.5,
    earlyQualifierCredits: 14,
    subjectMinimums: { english: 3, math: 2, science: 2, social_science: 2, other_academic: 4, additionalEms: 3 },
    tenSevenRule: false,
  },
};

export interface InitialEligibilityInput {
  division: string;
  courses: CoreCourse[];
  gpaOptions?: CoreGpaOptions;
  // Core credits completed before the start of the seventh semester,
  // and how many of those were English, math or science. Supplied by
  // the caller because only a transcript with dated terms can say.
  preSeventhSemester?: { totalCredits: number; emsCredits: number };
  graduated?: boolean;
}

export interface InitialEligibilityResult {
  status: EligibilityStatus;
  division: EligibilityDivision | null;
  coreGpa: CoreGpaResult | null;
  // What the athlete may do in year one, in plain words.
  yearOne: string;
  reasons: string[];
  warnings: string[];
}

function normalizeDivision(raw: string): EligibilityDivision | "D3" | null {
  const d = (raw || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (/\bD3\b|DIVISION 3|DIVISION III/.test(d)) return "D3";
  if (/\bD1\b|DIVISION 1|DIVISION I\b|FBS|FCS/.test(d)) return "D1";
  if (/\bD2\b|DIVISION 2|DIVISION II\b/.test(d)) return "D2";
  return null;
}

const YEAR_ONE: Record<string, string> = {
  early_academic_qualifier: "Can receive aid, practice and compete in year one.",
  qualifier: "Can receive aid, practice and compete in year one.",
  academic_redshirt: "Can receive aid and practice in the first term, but cannot compete in year one.",
  partial_qualifier: "Can receive aid and practice, but cannot compete in year one.",
  nonqualifier: "Cannot receive athletics aid, practice or compete in year one.",
};

export function evaluateInitialEligibility(input: InitialEligibilityInput): InitialEligibilityResult {
  const division = normalizeDivision(input.division);

  // D3 sets its own academic standards on each campus. The Eligibility
  // Center issues an NCAA ID and certifies athletics eligibility only
  // for international D3 athletes. There is no D3 core GPA to report,
  // so the app must not imply one.
  if (division === "D3") {
    return {
      status: "not_applicable",
      division: null,
      coreGpa: null,
      yearOne: "Division III sets its own academic standards on campus.",
      reasons: ["Division III has no NCAA core-course GPA or core-course requirement. Admission and eligibility are decided by the school."],
      warnings: [],
    };
  }

  if (division === null) {
    return {
      status: "not_applicable",
      division: null,
      coreGpa: null,
      yearOne: "Not an NCAA division.",
      reasons: [`"${input.division}" is not an NCAA division, so NCAA initial-eligibility rules do not apply.`],
      warnings: [],
    };
  }

  const std = DIVISION_STANDARDS[division];
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!input.courses.length) {
    return {
      status: "insufficient_data",
      division,
      coreGpa: null,
      yearOne: "Cannot be determined yet.",
      reasons: [],
      warnings: ["No course list on file. An NCAA core GPA cannot be calculated from a transcript GPA alone, so upload a transcript with its courses."],
    };
  }

  const coreGpa = calculateCoreGpa(input.courses, std.coreCredits, input.gpaOptions);
  warnings.push(...coreGpa.warnings);

  if (coreGpa.gpa === null) {
    return {
      status: "insufficient_data",
      division,
      coreGpa,
      yearOne: "Cannot be determined yet.",
      reasons: [],
      warnings: [...warnings, "None of the courses on file carry NCAA quality points."],
    };
  }

  // Subject-area shortfalls. Reported rather than used to force a
  // status, because a junior's transcript is legitimately incomplete.
  const shortfalls: string[] = [];
  for (const [subject, min] of Object.entries(std.subjectMinimums)) {
    if (subject === "additionalEms") continue;
    const have = coreGpa.creditsBySubject[subject as SubjectArea] ?? 0;
    if (have < min) shortfalls.push(`${subject.replace(/_/g, " ")} ${have} of ${min}`);
  }
  if (shortfalls.length) {
    warnings.push(`Short of the ${division} subject-area minimums: ${shortfalls.join(", ")}.`);
  }

  if (std.tenSevenRule) {
    const pre = input.preSeventhSemester;
    if (!pre) {
      warnings.push("The 10/7 rule has not been checked: ten core credits, seven in English, math or science, must be done before senior year starts. Term dates are needed to verify it.");
    } else if (pre.totalCredits < 10 || pre.emsCredits < 7) {
      warnings.push(`10/7 rule not met: ${pre.totalCredits} core credits (needs 10) and ${pre.emsCredits} in English/math/science (needs 7) before the seventh semester. This cannot be fixed after senior year begins.`);
    } else {
      reasons.push(`10/7 rule met: ${pre.totalCredits} core credits including ${pre.emsCredits} in English, math or science before senior year.`);
    }
  }

  const gpa = coreGpa.gpa;
  const complete = coreGpa.totalCredits >= std.coreCredits;

  if (!complete) {
    warnings.push("This is a projection. The status can still move either way until all 16 core credits are finished.");
  }

  if (gpa >= std.earlyQualifierGpa && coreGpa.totalCredits >= std.earlyQualifierCredits) {
    reasons.push(`Core GPA ${gpa.toFixed(3)} is at or above the ${division} early academic qualifier standard (${std.earlyQualifierGpa} with ${std.earlyQualifierCredits} credits).`);
    return { status: "early_academic_qualifier", division, coreGpa, yearOne: YEAR_ONE.early_academic_qualifier!, reasons, warnings };
  }

  if (gpa >= std.qualifierGpa) {
    reasons.push(`Core GPA ${gpa.toFixed(3)} meets the ${division} qualifier minimum of ${std.qualifierGpa}.`);
    return { status: "qualifier", division, coreGpa, yearOne: YEAR_ONE.qualifier!, reasons, warnings };
  }

  if (std.secondTierGpa !== null && gpa >= std.secondTierGpa) {
    reasons.push(`Core GPA ${gpa.toFixed(3)} is below the ${division} qualifier minimum of ${std.qualifierGpa} but at or above ${std.secondTierGpa}.`);
    return { status: std.secondTierStatus, division, coreGpa, yearOne: YEAR_ONE[std.secondTierStatus]!, reasons, warnings };
  }

  if (std.secondTierGpa === null) {
    // D2. Below the qualifier standard there is a partial-qualifier
    // tier, but the NCAA does not publish its GPA floor, so the honest
    // answer is that this needs the Eligibility Center, not a verdict.
    reasons.push(`Core GPA ${gpa.toFixed(3)} is below the ${division} qualifier minimum of ${std.qualifierGpa}.`);
    warnings.push("Division II has a partial-qualifier status below the qualifier standard, but the NCAA does not publish its GPA floor. Check this athlete with the Eligibility Center rather than assuming a nonqualifier result.");
    return { status: "insufficient_data", division, coreGpa, yearOne: "Cannot be determined without the Eligibility Center.", reasons, warnings };
  }

  reasons.push(`Core GPA ${gpa.toFixed(3)} is below the ${division} academic redshirt floor of ${std.secondTierGpa}.`);
  return { status: "nonqualifier", division, coreGpa, yearOne: YEAR_ONE.nonqualifier!, reasons, warnings };
}
