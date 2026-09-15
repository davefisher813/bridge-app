// Turns the rows Doc AI reads off a transcript into the CoreCourse
// shape the NCAA calculator scores.
//
// This file deliberately does not import anything from src/lib/docai/.
// It takes a plain structural shape, so the two walled-off modules stay
// independent of each other and either can still lift out on its own.
//
// The interesting problem here is numeric grades. Dave's real
// transcripts print numbers, not letters: Westminster reports an 86.2
// average and Cardinal Hayes reports course grades like 87 and 102. The
// NCAA converts those using the high school's OWN published scale, not
// a generic curve, so a number cannot be scored until that scale is
// known. Guessing one would produce a confident, wrong eligibility
// verdict, which is worse than no verdict, so an unconvertible grade is
// reported rather than approximated.

import type { CoreCourse, SubjectArea } from "./coreGpa";

export interface TranscriptCourseRow {
  title: string;
  subject: SubjectArea | "non_academic";
  credit: number;
  grade: string;
  weighted?: boolean;
  term?: string | null;
}

// A band from the school's own printed table, e.g. { letter: "B", min:
// 83, max: 86 }.
export interface GradingBand {
  letter: string;
  min: number;
  max: number;
}

export interface FromTranscriptResult {
  courses: CoreCourse[];
  // Rows that could not be turned into a scorable course, with the
  // reason, so nothing disappears silently.
  skipped: Array<{ row: TranscriptCourseRow; reason: string }>;
  warnings: string[];
}

function numericGrade(raw: string): number | null {
  const t = (raw || "").trim();
  if (!/^\d{1,3}(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// The school's table governs. A value above the top band (a weighted
// 102, say) takes the highest band rather than falling off the end.
export function letterFromScale(value: number, scale: GradingBand[]): string | null {
  if (!scale.length) return null;
  const sorted = [...scale].sort((a, b) => b.max - a.max);
  for (const band of sorted) {
    if (value >= band.min && value <= band.max) return band.letter;
  }
  const top = sorted[0]!;
  if (value > top.max) return top.letter;
  return null;
}

export function coursesFromTranscript(
  rows: TranscriptCourseRow[],
  options: { gradingScale?: GradingBand[] | null; schoolName?: string } = {}
): FromTranscriptResult {
  const courses: CoreCourse[] = [];
  const skipped: Array<{ row: TranscriptCourseRow; reason: string }> = [];
  const warnings: string[] = [];
  const scale = options.gradingScale ?? null;

  let numericSeen = 0;
  let numericUnconverted = 0;

  for (const row of rows) {
    if (row.subject === "non_academic") {
      // PE, most electives. Not core courses, and the transcript GPA's
      // main source of lift.
      skipped.push({ row, reason: "Not an academic subject, so it cannot be an NCAA core course" });
      continue;
    }

    let grade = row.grade;
    const numeric = numericGrade(row.grade);
    if (numeric !== null) {
      numericSeen++;
      const letter = scale ? letterFromScale(numeric, scale) : null;
      if (!letter) {
        numericUnconverted++;
        skipped.push({
          row,
          reason: scale
            ? `Grade ${numeric} does not fall in any band of the school's printed scale`
            : `Grade ${numeric} is numeric and this school's conversion table is not on file`,
        });
        continue;
      }
      grade = letter;
    }

    courses.push({
      title: row.title,
      subject: row.subject,
      credit: row.credit,
      grade,
      weighted: row.weighted ?? false,
      // Left undefined on purpose: nobody has checked this course
      // against the school's NCAA-approved list yet, and undefined is
      // reported as unchecked rather than treated as approved.
      ncaaApproved: undefined,
    });
  }

  if (numericUnconverted > 0 && !scale) {
    const where = options.schoolName ? `${options.schoolName}'s` : "this school's";
    warnings.push(
      `${numericUnconverted} of ${numericSeen} numeric grades could not be scored because ${where} numeric-to-letter table is not on file. The NCAA uses the school's own published scale, so this needs the school's scale rather than an assumed one before an eligibility answer means anything.`
    );
  }

  return { courses, skipped, warnings };
}
