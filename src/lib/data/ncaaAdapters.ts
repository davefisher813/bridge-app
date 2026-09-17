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
import {
  assumedScaleWarning,
  resolveScale,
  TEN_POINT_STARTING_POINT,
  type ScaleOrigin,
} from "@/lib/fit/ncaa/gradingScale";
import type { CoreCourse } from "@/lib/fit/ncaa/coreGpa";
import {
  applyApprovedLists,
  normalizeSchoolKey,
  type ApprovedCourseList,
  type CourseMatch,
} from "@/lib/fit/ncaa/approvedCourses";

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
  // Which table this is: one confirmed with the school and shared across
  // every org, or one this org entered for itself. A verified row wins,
  // and the screen says which one the number came from, because "we
  // checked" and "someone here typed it" are different claims.
  origin: ScaleOrigin;
  source_note?: string | null;
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
  // The Eligibility Center's approved-course list per school, when one
  // is on file. Absent means every course stays unchecked and the core
  // GPA reports itself as an estimate, which is what happened for every
  // athlete before these lists existed.
  approvedLists?: ApprovedCourseList[];
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
  // Which table each school's grades were converted through, so the
  // screen can attribute the number instead of presenting every core GPA
  // as equally confirmed.
  scalesUsed: Array<{ school: string; origin: ScaleOrigin; sourceNote: string | null }>;
  adapterWarnings: string[];
  // How each course fared against its school's approved list, so the
  // screen can show why a course was dropped rather than only that the
  // total moved.
  approvals: Array<{ title: string; school: string; match: CourseMatch }>;
  // The corrections the list made to what the transcript said: a subject
  // reassignment or a credit cap changes the verdict, so neither happens
  // silently.
  approvalNotes: string[];
  // Schools with courses on this transcript and no approved list on
  // file. Drives the same kind of action schoolsMissingScale does.
  schoolsMissingApprovedList: string[];
}

export function buildEligibilityView(input: EligibilityInput): EligibilityView {
  // Every table on file for a school, then the one that governs. A
  // verified shared row beats an org's own entry; an org only ever
  // receives its own entries, so no ordering lets one org's typing
  // displace another's.
  const candidatesByName = new Map<string, GradingScaleRow[]>();
  for (const s of input.scales) {
    const key = s.school_name.trim().toLowerCase();
    const list = candidatesByName.get(key);
    if (list) list.push(s);
    else candidatesByName.set(key, [s]);
  }

  const lookup = (school: string | null) => {
    if (!school) return null;
    const candidates = candidatesByName.get(school.trim().toLowerCase());
    return candidates ? resolveScale(candidates) : null;
  };

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
  // Which school each converted course was taken at. A transfer's
  // transcript carries two, and each has its own approved list.
  const schoolOfCourse = new Map<CoreCourse, string>();
  const skipped: EligibilityView["skipped"] = [];
  const adapterWarnings: string[] = [];
  const schoolsMissingScale = new Set<string>();
  const scalesUsed: EligibilityView["scalesUsed"] = [];
  // The weighted-bonus conditions are a property of the school, and the
  // engine takes one set of options for the whole calculation. Applying
  // the bonus requires every school on the transcript to qualify for it,
  // which is the conservative reading and never inflates a GPA.
  let everySchoolReportsWeighted = true;
  let anySchoolIsClassRankOnly = false;

  for (const [schoolName, rows] of bySchool) {
    const onFile = lookup(schoolName);
    const hasNumericGrades = rows.some((r) => /^\d{1,3}(\.\d+)?$/.test(r.grade.trim()));

    // No table on file. Rather than drop every numeric grade and show
    // nothing, fall back to the common ten-point scale so a number
    // appears, and carry the assumption with it everywhere. The school
    // still shows up in schoolsMissingScale, because the real table is
    // still the thing to go get: the fallback changes what the screen
    // can show, not what is actually known.
    const scale: GradingScaleRow | null =
      onFile ??
      (hasNumericGrades
        ? {
            school_name: schoolName,
            bands: TEN_POINT_STARTING_POINT,
            // An assumed conversion never earns the weighted bonus. Both
            // conditions on it are claims about what the school told the
            // NCAA, and nobody has made either claim here.
            reports_weighted_grades: false,
            weighting_is_class_rank_only: false,
            weight_bonus: 0,
            origin: "assumed",
            source_note: null,
          }
        : null);

    if (!scale) {
      everySchoolReportsWeighted = false;
    } else if (scale.origin !== "verified" && scale.origin !== "org" && scale.origin !== "assumed") {
      // A real table with a label nobody set. Used, because a real table
      // beats a guess, but never presented as confirmed and never given
      // the weighted bonus, which is a claim about what the school told
      // the Eligibility Center rather than about the numbers.
      everySchoolReportsWeighted = false;
      scalesUsed.push({ school: schoolName || "this athlete's school", origin: "org", sourceNote: scale.source_note ?? null });
    } else if (scale.origin === "assumed") {
      everySchoolReportsWeighted = false;
      schoolsMissingScale.add(schoolName || "this athlete's school");
      adapterWarnings.push(assumedScaleWarning(schoolName));
      scalesUsed.push({ school: schoolName || "this athlete's school", origin: "assumed", sourceNote: null });
    } else {
      if (!scale.reports_weighted_grades) everySchoolReportsWeighted = false;
      if (scale.weighting_is_class_rank_only) anySchoolIsClassRankOnly = true;
      // Reported only when a numeric grade actually ran through the
      // table. A school whose transcript prints letters converts the
      // same either way, and attributing a table nothing used would put
      // a caveat on screen that means nothing.
      if (rows.some((r) => /^\d{1,3}(\.\d+)?$/.test(r.grade.trim()))) {
        scalesUsed.push({
          school: schoolName || "this athlete's school",
          origin: scale.origin,
          sourceNote: scale.source_note ?? null,
        });
      }
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
      const built: CoreCourse = {
        ...c,
        ncaaApproved: original?.ncaa_approved ?? undefined,
        duplicateOf: original?.duplicate_of ?? undefined,
        // Without this the engine's bonus lookup finds nothing and
        // silently applies zero, so a school that does award weighted
        // grades would still show an unweighted GPA.
        schoolWeightBonus: scale ? toNumber(scale.weight_bonus) : 0,
      };
      courses.push(built);
      schoolOfCourse.set(built, schoolName);
    }
    for (const s of converted.skipped) {
      skipped.push({ title: s.row.title, grade: s.row.grade, reason: s.reason });
    }
    adapterWarnings.push(...converted.warnings);
  }

  // The approved lists run over the whole converted set, after the
  // grading scales and before the engine. Order matters: the list can
  // move a course's subject and cap its credit, and both feed the
  // per-subject minimums the engine checks.
  const listsByKey = new Map<string, ApprovedCourseList>();
  for (const l of input.approvedLists ?? []) {
    const key = normalizeSchoolKey(l.schoolName);
    const existing = listsByKey.get(key);
    // A list transcribed from the portal beats one an org typed, the
    // same precedence a verified grading scale has over an org's own.
    if (!existing || (existing.source !== "ncaa_portal" && l.source === "ncaa_portal")) listsByKey.set(key, l);
  }

  // Which school each converted course came from. The converted array is
  // built school by school above, so this is recorded as it goes rather
  // than recovered by matching titles, which is the bug the index
  // correlation above already exists to avoid.
  const applied = applyApprovedLists(courses, listsByKey, (c) => schoolOfCourse.get(c) ?? "");
  // By index, not by looking the returned course up in schoolOfCourse:
  // applyApprovedLists returns new objects, so the map keyed on the
  // originals would miss every one and report every course as belonging
  // to no school. Order is preserved, and that is what is relied on.
  const approvals = applied.matches.map((m, i) => ({
    title: m.course.title,
    school: schoolOfCourse.get(courses[i]!) ?? "",
    match: m.match,
  }));

  const schoolsMissingApprovedList = [...bySchool.keys()]
    .filter((name) => bySchool.get(name)!.length > 0 && !listsByKey.has(normalizeSchoolKey(name)))
    .map((name) => name || "this athlete's school");

  if (applied.ambiguousCount > 0) {
    adapterWarnings.push(
      `${applied.ambiguousCount} course(s) match more than one entry on the school's approved list. Nothing was assumed about them.`,
    );
  }

  const eligibility = evaluateInitialEligibility({
    division: input.division,
    courses: applied.courses,
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

  return {
    eligibility,
    ageClock,
    skipped,
    schoolsMissingScale: [...schoolsMissingScale],
    scalesUsed,
    adapterWarnings,
    approvals,
    approvalNotes: applied.notes,
    schoolsMissingApprovedList,
  };
}
