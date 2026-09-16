// Adapts stored course rows and grading scales into the NCAA engine's
// plain types. Same seam as fitAdapters.ts: src/lib/fit/ncaa/ stays
// walled off from anything Supabase-shaped, so this file is the only
// place that knows a column is called `ncaa_approved`.
//
// One behaviour worth stating plainly, because it is the difference
// between this being useful and being dangerous: when the school's
// numeric-to-letter table is missing, courses with numeric grades are
// dropped rather than converted with a guess, and the caller is told.
// A wrong core GPA reads exactly as authoritative as a right one.

import { z } from "zod";
import { coursesFromTranscript, type GradingBand, type TranscriptCourseRow } from "@/lib/fit/ncaa/fromTranscript";
import { evaluateInitialEligibility, type InitialEligibilityResult } from "@/lib/fit/ncaa/initialEligibility";
import { evaluateAgeClock, type AgeClockResult } from "@/lib/fit/ncaa/ageClock";
import type { CoreCourse } from "@/lib/fit/ncaa/coreGpa";

export interface AthleteCourseRow {
  id: string;
  title: string;
  subject: "english" | "math" | "science" | "social_science" | "other_academic" | "non_academic";
  credit: number | string;
  grade: string;
  term: string | null;
  school_name: string | null;
  weighted: boolean;
  ncaa_approved: boolean | null;
  duplicate_of: string | null;
}

export interface GradingScaleRow {
  school_name: string;
  bands: unknown;
  reports_weighted_grades: boolean;
  weighting_is_class_rank_only: boolean;
  // How much this school actually adds for a weighted course. The
  // NCAA's 1.00 is a cap, not the value, so using the cap as the amount
  // would overstate the core GPA of every AP student at a school that
  // adds less. The engine clamps whatever arrives here.
  weight_bonus: number | string;
}

const bandsSchema = z
  .array(z.object({ letter: z.string().min(1), min: z.number(), max: z.number() }))
  .catch([]);

export function parseBands(raw: unknown): GradingBand[] {
  return bandsSchema.parse(raw);
}

// numeric(4,2) comes back from Supabase as a string often enough that
// treating it as a number silently produces NaN credits and a NaN GPA.
function toNumber(v: number | string): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface EligibilityInput {
  courses: AthleteCourseRow[];
  scales: GradingScaleRow[];
  division: string;
  athlete: {
    dateOfBirth: string | null;
    firstFullTimeEnrollment: string | null;
    intendedEnrollment: string | null;
  };
  preSeventhSemester?: { totalCredits: number; emsCredits: number };
  today: string;
}

export interface EligibilityView {
  eligibility: InitialEligibilityResult;
  ageClock: AgeClockResult;
  // Courses the adapter could not turn into something scorable, with the
  // reason, so the screen can say what is missing instead of showing a
  // number that quietly excluded them.
  skipped: Array<{ title: string; grade: string; reason: string }>;
  // Schools on this athlete's transcript with no conversion table on
  // file. Drives the "add the school's grading scale" action.
  schoolsMissingScale: string[];
  adapterWarnings: string[];
}

export function buildEligibilityView(input: EligibilityInput): EligibilityView {
  const scaleByName = new Map<string, GradingScaleRow>();
  for (const s of input.scales) scaleByName.set(s.school_name.trim().toLowerCase(), s);

  const lookup = (school: string | null) => (school ? scaleByName.get(school.trim().toLowerCase()) ?? null : null);

  // Courses are grouped by the school they were taken at, because a
  // transfer student's transcript legitimately carries two schools and
  // they may convert numeric grades differently. Converting the whole
  // list against one school's table would be wrong for the other half.
  const bySchool = new Map<string, AthleteCourseRow[]>();
  for (const row of input.courses) {
    const key = row.school_name ?? "";
    const list = bySchool.get(key);
    if (list) list.push(row);
    else bySchool.set(key, [row]);
  }

  const courses: CoreCourse[] = [];
  const skipped: EligibilityView["skipped"] = [];
  const adapterWarnings: string[] = [];
  const schoolsMissingScale = new Set<string>();
  // The weighted-bonus conditions are a property of the school, and the
  // engine takes one set of options for the whole calculation. Applying
  // the bonus requires every school on the transcript to qualify for it,
  // which is the conservative reading and never inflates a GPA.
  let everySchoolReportsWeighted = true;
  let anySchoolIsClassRankOnly = false;

  for (const [schoolName, rows] of bySchool) {
    const scale = lookup(schoolName);
    if (!scale) {
      everySchoolReportsWeighted = false;
      if (rows.some((r) => /^\d{1,3}(\.\d+)?$/.test(r.grade.trim()))) {
        schoolsMissingScale.add(schoolName || "this athlete's school");
      }
    } else {
      if (!scale.reports_weighted_grades) everySchoolReportsWeighted = false;
      if (scale.weighting_is_class_rank_only) anySchoolIsClassRankOnly = true;
    }

    const transcriptRows: TranscriptCourseRow[] = rows.map((r) => ({
      title: r.title,
      subject: r.subject,
      credit: toNumber(r.credit),
      grade: r.grade,
      weighted: r.weighted,
      term: r.term,
    }));

    const converted = coursesFromTranscript(transcriptRows, {
      gradingScale: scale ? parseBands(scale.bands) : null,
      schoolName: schoolName || undefined,
    });

    // Carry the stored approval flag and repeat tagging across, which
    // the transcript adapter cannot know about.
    for (let i = 0; i < converted.courses.length; i++) {
      const c = converted.courses[i]!;
      // Correlated by index, not by title. Matching on title returned
      // the first row with that name for BOTH halves of a year-long
      // course, so one row's duplicate tag and approval flag were applied
      // to the other. Either the human's duplicate resolution was thrown
      // away, or a legitimate two-term course was merged and half its
      // credit destroyed.
      const original = rows[converted.sourceIndex[i]!];
      courses.push({
        ...c,
        ncaaApproved: original?.ncaa_approved ?? undefined,
        duplicateOf: original?.duplicate_of ?? undefined,
        // Without this the engine's bonus lookup finds nothing and
        // silently applies zero, so a school that does award weighted
        // grades would still show an unweighted GPA.
        schoolWeightBonus: scale ? toNumber(scale.weight_bonus) : 0,
      });
    }
    for (const s of converted.skipped) {
      skipped.push({ title: s.row.title, grade: s.row.grade, reason: s.reason });
    }
    adapterWarnings.push(...converted.warnings);
  }

  const eligibility = evaluateInitialEligibility({
    division: input.division,
    courses,
    gpaOptions: {
      schoolReportsWeightedGrades: everySchoolReportsWeighted && bySchool.size > 0,
      weightingIsClassRankOnly: anySchoolIsClassRankOnly,
    },
    preSeventhSemester: input.preSeventhSemester,
  });

  const ageClock = evaluateAgeClock({
    dateOfBirth: input.athlete.dateOfBirth ?? "",
    division: input.division,
    firstFullTimeEnrollment: input.athlete.firstFullTimeEnrollment ?? undefined,
    intendedEnrollment: input.athlete.intendedEnrollment ?? undefined,
    today: input.today,
  });

  return { eligibility, ageClock, skipped, schoolsMissingScale: [...schoolsMissingScale], adapterWarnings };
}
