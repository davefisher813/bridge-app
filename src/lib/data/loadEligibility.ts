// One loader for everything the eligibility screens need.
//
// Three pages want the same thing: the verdict screen, the transcript,
// and the per-course approved-list check. Before this, one page carried
// the whole sixty-line query and the others would each have grown their
// own copy. That is precisely how the grading-scale bug happened: one
// caller read both scale tables and the other read one, and nothing
// could tell them apart because each was correct on its own.
//
// So the query lives here once. A page that wants a core GPA calls this
// and cannot accidentally ask for less than the engine needs.

import { createClient } from "@/lib/supabase/server";
import {
  buildEligibilityView,
  type AthleteCourseRow,
  type EligibilityView,
  type GradingScaleRow,
} from "@/lib/data/ncaaAdapters";
import { normalizeDivision } from "@/lib/fit/ncaa/initialEligibility";
import type { ApprovedCourseList } from "@/lib/fit/ncaa/approvedCourses";
import type { SubjectArea } from "@/lib/fit/ncaa/coreGpa";

export interface EligibilityBundle {
  athlete: {
    id: string;
    name: string;
    gpa: number | null;
    gpa_verified: boolean | null;
    date_of_birth: string | null;
    first_full_time_enrollment: string | null;
    intended_enrollment: string | null;
  };
  courses: AthleteCourseRow[];
  division: string;
  view: EligibilityView;
}

const DIVISION_RANK: Record<string, number> = { D1: 3, D2: 2, D3: 1 };

// The strictest live target wins, because clearing D1 clears D2. Uses
// the engine's normalizer rather than a second regex: the copy that once
// lived in a page missed the "DI" and "DII" spellings, so a target
// written that way produced no division and the screen said there was
// nothing to judge against.
export function pickDivision(divisions: string[]): string {
  let best = "";
  let bestRank = 0;
  for (const raw of divisions) {
    const key = normalizeDivision(raw);
    if (!key) continue;
    if (DIVISION_RANK[key]! > bestRank) {
      bestRank = DIVISION_RANK[key]!;
      best = key;
    }
  }
  return best;
}

type ScaleQueryRow = {
  school_name: string;
  bands: unknown;
  reports_weighted_grades: boolean;
  weighting_is_class_rank_only: boolean;
  weight_bonus: number | string;
  source_note: string | null;
  verified_at?: string | null;
};

type ListQueryRow = {
  school_name: string;
  ceeb_code: string | null;
  is_complete: boolean;
  source_note: string | null;
  ncaa_approved_courses?: Array<{ title: string; subject: string; max_credit: number | string | null; weighted: boolean }>;
  org_approved_courses?: Array<{ title: string; subject: string; max_credit: number | string | null; weighted: boolean }>;
};

export async function loadEligibility(orgId: string, athleteId: string, today: string): Promise<EligibilityBundle | null> {
  const supabase = await createClient();

  const [{ data: athlete }, { data: courseRows }, { data: targetRows }] = await Promise.all([
    supabase
      .from("athletes")
      .select("id, name, gpa, gpa_verified, date_of_birth, first_full_time_enrollment, intended_enrollment")
      .eq("id", athleteId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("athlete_courses")
      .select("id, title, subject, credit, grade, term, school_name, weighted, ncaa_approved, duplicate_of")
      .eq("athlete_id", athleteId)
      .eq("org_id", orgId)
      .order("term", { ascending: true }),
    supabase.from("recruiting_targets").select("schools(division)").eq("athlete_id", athleteId).eq("org_id", orgId),
  ]);

  if (!athlete) return null;

  const courses = (courseRows ?? []) as AthleteCourseRow[];

  // Matched on the normalized key, because the adapter compares
  // case-insensitively and an exact-match query filtered rows out before
  // the adapter ever saw them.
  const schoolKeys = [...new Set(courses.map((c) => c.school_name?.trim().toLowerCase()).filter((s): s is string => !!s))];

  const [{ data: sharedScales }, { data: orgScales }, { data: sharedLists }, { data: orgLists }] = schoolKeys.length
    ? await Promise.all([
        supabase
          .from("high_school_grading_scales")
          .select("school_name, bands, reports_weighted_grades, weighting_is_class_rank_only, weight_bonus, source_note, verified_at")
          .in("school_name_key", schoolKeys),
        supabase
          .from("org_grading_scales")
          .select("school_name, bands, reports_weighted_grades, weighting_is_class_rank_only, weight_bonus, source_note")
          .eq("org_id", orgId)
          .in("school_name_key", schoolKeys),
        supabase
          .from("ncaa_approved_course_lists")
          .select("school_name, ceeb_code, is_complete, source_note, ncaa_approved_courses(title, subject, max_credit, weighted)")
          .in("school_name_key", schoolKeys),
        supabase
          .from("org_approved_course_lists")
          .select("school_name, ceeb_code, is_complete, source_note, org_approved_courses(title, subject, max_credit, weighted)")
          .eq("org_id", orgId)
          .in("school_name_key", schoolKeys),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const labelScale = (rows: ScaleQueryRow[] | null, origin: "verified" | "org"): GradingScaleRow[] =>
    (rows ?? []).map((r) => ({
      school_name: r.school_name,
      bands: r.bands,
      reports_weighted_grades: r.reports_weighted_grades,
      weighting_is_class_rank_only: r.weighting_is_class_rank_only,
      weight_bonus: r.weight_bonus,
      source_note: r.source_note,
      origin,
    }));

  // NOT every shared row is confirmed. Doc AI saves a table it read off
  // a transcript into the shared table with verified_at null, so
  // "shared" and "confirmed with the school" are different claims. A
  // scale OCR'd from a phone photo must not outrank one a coordinator
  // typed off the school's printed legend. Order is the precedence
  // resolveScale() reads.
  const sharedAll = (sharedScales ?? []) as ScaleQueryRow[];
  const scales = [
    ...labelScale(sharedAll.filter((r) => r.verified_at != null), "verified"),
    ...labelScale(orgScales as ScaleQueryRow[] | null, "org"),
    ...labelScale(sharedAll.filter((r) => r.verified_at == null), "org"),
  ];

  const toList = (rows: ListQueryRow[] | null, source: "ncaa_portal" | "org"): ApprovedCourseList[] =>
    (rows ?? []).map((r) => ({
      schoolName: r.school_name,
      ceebCode: r.ceeb_code ?? undefined,
      isComplete: r.is_complete,
      source,
      sourceNote: r.source_note ?? undefined,
      courses: (r.ncaa_approved_courses ?? r.org_approved_courses ?? []).map((c) => ({
        title: c.title,
        subject: c.subject as SubjectArea,
        maxCredit: c.max_credit === null ? undefined : Number(c.max_credit),
        weighted: c.weighted,
      })),
    }));

  const approvedLists = [
    ...toList(sharedLists as ListQueryRow[] | null, "ncaa_portal"),
    ...toList(orgLists as ListQueryRow[] | null, "org"),
  ];

  const divisions = (targetRows ?? []).flatMap((t) => {
    const s = (t as { schools?: { division?: string } | { division?: string }[] }).schools;
    const one = Array.isArray(s) ? s[0] : s;
    return one?.division ? [one.division] : [];
  });
  const division = pickDivision(divisions);

  const view = buildEligibilityView({
    courses,
    scales,
    approvedLists,
    division,
    athlete: {
      dateOfBirth: athlete.date_of_birth,
      firstFullTimeEnrollment: athlete.first_full_time_enrollment,
      intendedEnrollment: athlete.intended_enrollment,
    },
    today,
  });

  return { athlete: athlete as EligibilityBundle["athlete"], courses, division, view };
}
