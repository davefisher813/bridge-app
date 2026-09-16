// Age-based eligibility: the five-year clock the NCAA adopted for
// Divisions I and II in mid-2026.
//
// Source: ncaa.org/eligibility-center/division-i-and-division-ii-age-based-eligibility-rules/,
// D1 Cabinet adoption 2026-06-23, D2 emergency legislation 2026-07.
// Read 2026-09-15; see docs/BUSINESS_RULES.md.
//
// Why this is in the product at all: the clock can start before an
// athlete has enrolled anywhere. It begins at whichever comes first,
// first full-time college enrollment, or the start of the academic year
// following a 19th birthday that falls before September 1. And it "does
// not pause because a student-athlete does not compete, transfers, sits
// out, changes teams or takes time away from participation."
//
// So a post-grad year, a prep year, a gap year, a late arrival from
// abroad, or an online-program athlete who finished high school late
// all burn eligibility while the athlete is not playing anywhere. That
// is a large share of the athletes Bridge works with, and it is the
// kind of thing a family finds out about far too late.
//
// Pure module: the caller passes `today`, nothing is read from the
// environment, so the same inputs always give the same answer.

export const ELIGIBILITY_YEARS = 5;

// "The start of the regular academic year immediately following the
// student-athlete's 19th birthday, if the student-athlete turns 19
// before Sept. 1".
//
// September 1 is stated in the rule and is exact. The "start of the
// regular academic year" is not a date the NCAA pins down here, and it
// genuinely varies by school. August 1 is used because NCAA
// legislation conventionally runs its academic year from August 1
// (adopted rules take effect 8/1), but it is an assumption, not a
// quoted date, and every result carries a warning saying the precise
// start depends on the school's own calendar. Months are zero-indexed.
const ACADEMIC_YEAR_START_MONTH = 7; // August
const ACADEMIC_YEAR_START_DAY = 1;
const AGE_CUTOFF_MONTH = 8; // September
const AGE_CUTOFF_DAY = 1;

export type AgeClockDivision = "D1" | "D2";

export interface AgeClockInput {
  dateOfBirth: string; // ISO date, as it appears on a transcript
  division: string;
  // When the athlete first enrolled full time at any college, if they
  // have. Undefined for a high schooler who has not enrolled yet.
  firstFullTimeEnrollment?: string;
  // When the athlete intends to enrol, for a recruit who has not yet.
  intendedEnrollment?: string;
  today: string; // ISO date, supplied by the caller
}

export interface AgeClockResult {
  applies: boolean;
  clockStart: string | null;
  clockEnd: string | null;
  // Years already spent when the athlete reaches their intended
  // enrollment date. Null when there is no intended date to measure to.
  yearsBurnedAtEnrollment: number | null;
  yearsRemainingAtEnrollment: number | null;
  startedBy: "enrollment" | "age" | null;
  reasons: string[];
  warnings: string[];
}

function parse(iso: string): Date | null {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The academic year a date belongs to, given the September 1 cutoff.
//
// This used to return the next August 1 falling on or AFTER the
// birthday, which is wrong for every birthday between August 1 and
// August 31: a 19th birthday on August 15 2027 would be pushed to the
// academic year starting August 2028, handing the athlete a full extra
// year of eligibility that does not exist. A one-day change in date of
// birth moved the answer by a year, in the optimistic direction.
//
// The rule has one cutoff, not two. A birthday before September 1 of
// year Y belongs to the academic year beginning in year Y, whether it
// falls in March or in August.
function academicYearStartFor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), ACADEMIC_YEAR_START_MONTH, ACADEMIC_YEAR_START_DAY));
}

// Date.UTC rolls February 29 over to March 1 when the target year is not
// a leap year, which shifted a leap-year athlete's clock by a day.
function addYears(d: Date, years: number): Date {
  const year = d.getUTCFullYear() + years;
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastOfMonth)));
}

function isD1OrD2(raw: string): AgeClockDivision | null {
  const d = (raw || "").toUpperCase().replace(/\s+/g, " ").trim();
  // Longest spellings first: "DI" is a prefix of "DII" and "DIII".
  if (/\bD3\b|\bDIII\b|DIVISION 3|DIVISION III/.test(d)) return null;
  if (/\bD2\b|\bDII\b|DIVISION 2|DIVISION II\b/.test(d)) return "D2";
  if (/\bD1\b|\bDI\b|DIVISION 1|DIVISION I\b|FBS|FCS/.test(d)) return "D1";
  return null;
}

// Measured as a fraction of THIS athlete's own five-year window rather
// than against an average 365.2425-day year. The two disagreed: a window
// ending 2032-08-01 reported "already expired" on 2032-07-30, because
// 1825 days divided by the average year rounds to exactly 5. The module
// contradicted itself inside one result object.
function yearsElapsed(start: Date, end: Date, at: Date): number {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return ELIGIBILITY_YEARS;
  const used = (at.getTime() - start.getTime()) / span;
  return Math.round(Math.max(0, used) * ELIGIBILITY_YEARS * 100) / 100;
}

export function evaluateAgeClock(input: AgeClockInput): AgeClockResult {
  const empty: AgeClockResult = {
    applies: false,
    clockStart: null,
    clockEnd: null,
    yearsBurnedAtEnrollment: null,
    yearsRemainingAtEnrollment: null,
    startedBy: null,
    reasons: [],
    warnings: [],
  };

  const division = isD1OrD2(input.division);
  if (!division) {
    return { ...empty, reasons: ["Age-based eligibility applies to Divisions I and II only."] };
  }

  const dob = parse(input.dateOfBirth);
  if (!dob) {
    return { ...empty, applies: true, warnings: ["No date of birth on file, so the five-year eligibility clock cannot be checked. Transcripts usually carry it."] };
  }

  const reasons: string[] = [];
  const warnings: string[] = [];

  // The age trigger, if there is one.
  const nineteenth = addYears(dob, 19);
  const cutoffThatYear = new Date(Date.UTC(nineteenth.getUTCFullYear(), AGE_CUTOFF_MONTH, AGE_CUTOFF_DAY));
  const turnsNineteenBeforeCutoff = nineteenth < cutoffThatYear;
  const ageTrigger = turnsNineteenBeforeCutoff ? academicYearStartFor(nineteenth) : null;

  const enrollment = input.firstFullTimeEnrollment ? parse(input.firstFullTimeEnrollment) : null;

  let clockStart: Date | null = null;
  let startedBy: "enrollment" | "age" | null = null;
  if (enrollment && ageTrigger) {
    if (enrollment <= ageTrigger) {
      clockStart = enrollment;
      startedBy = "enrollment";
    } else {
      clockStart = ageTrigger;
      startedBy = "age";
    }
  } else if (enrollment) {
    clockStart = enrollment;
    startedBy = "enrollment";
  } else if (ageTrigger) {
    clockStart = ageTrigger;
    startedBy = "age";
  }

  if (!clockStart) {
    return {
      ...empty,
      applies: true,
      reasons: [`Turns 19 on ${iso(nineteenth)}, which is on or after September 1, so the clock does not start on age. It starts when they first enrol full time.`],
    };
  }

  const clockEnd = addYears(clockStart, ELIGIBILITY_YEARS);

  if (startedBy === "age") {
    reasons.push(`Turns 19 on ${iso(nineteenth)}, before the September 1 cutoff, so the five-year clock starts ${iso(clockStart)} whether or not they have enrolled anywhere.`);
    warnings.push("The clock starts at the start of that academic year. August 1 is used here; a school whose year starts later will shift this by weeks, so treat the dates as approximate to within a term.");
  } else {
    reasons.push(`First full-time enrollment on ${iso(clockStart)} starts the five-year clock.`);
  }
  reasons.push(`Eligibility runs out ${iso(clockEnd)}. The clock does not pause for a redshirt, a transfer, a gap year or time away.`);

  const target = input.intendedEnrollment ? parse(input.intendedEnrollment) : null;
  let yearsBurnedAtEnrollment: number | null = null;
  let yearsRemainingAtEnrollment: number | null = null;

  if (target) {
    const burned = yearsElapsed(clockStart, clockEnd, target);
    yearsBurnedAtEnrollment = burned;
    yearsRemainingAtEnrollment = Math.round((ELIGIBILITY_YEARS - burned) * 100) / 100;
    if (burned > 0 && startedBy === "age") {
      warnings.push(
        `${burned.toFixed(2)} of the five years are already gone by the intended enrollment date of ${iso(target)}, leaving ${yearsRemainingAtEnrollment.toFixed(2)}. A post-grad year, prep year or gap year spends eligibility even though nobody is playing.`
      );
    }
    if (yearsRemainingAtEnrollment !== null && yearsRemainingAtEnrollment <= 0) {
      warnings.push(`The five-year period has already expired by ${iso(target)}. Confirm with the Eligibility Center before this athlete commits to anything.`);
    }
  } else {
    warnings.push("No intended enrollment date on file, so how much of the five years is left at enrollment is unknown.");
  }

  const now = parse(input.today);
  if (now && now >= clockEnd) {
    warnings.push(`The five-year period ended ${iso(clockEnd)}.`);
  }

  // Transition rules. 2026-27 enrollees may use whichever ruleset
  // benefits them; from fall 2027 the age-based rule is the only one.
  if (target && target < new Date(Date.UTC(2027, ACADEMIC_YEAR_START_MONTH, ACADEMIC_YEAR_START_DAY))) {
    warnings.push("Enrolling before fall 2027 means the athlete may use either the old rules or the age-based rules, whichever helps them. This calculation shows the age-based one only.");
  }

  return {
    applies: true,
    clockStart: iso(clockStart),
    clockEnd: iso(clockEnd),
    yearsBurnedAtEnrollment,
    yearsRemainingAtEnrollment,
    startedBy,
    reasons,
    warnings,
  };
}
