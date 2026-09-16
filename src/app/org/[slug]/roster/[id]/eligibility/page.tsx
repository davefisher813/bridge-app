// NCAA eligibility for one athlete, against one target division.
//
// The engine behind this (src/lib/fit/ncaa/) is pure and law-bound; this
// page is the seam that loads rows, picks a division, and renders. The
// rules it has to respect on screen, all from docs/BUSINESS_RULES.md:
//
//   - Core GPA and transcript GPA always appear together, with the
//     sentence saying why they differ.
//   - Division III gets no core GPA and no qualifier status, ever.
//   - A number the engine refused to compute is never filled in with a
//     guess. Missing conversion tables and unchecked approval lists are
//     shown as work to do.
//   - The verdict is a Score-axis tint, never red.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { SectionHeader, EmptyState } from "@/components/catalog";
import { GpaPair, NoteRail, SubjectRow, VerdictCard } from "@/components/EligibilityVerdict";
import { buildEligibilityView, type AthleteCourseRow, type GradingScaleRow } from "@/lib/data/ncaaAdapters";
import { DIVISION_STANDARDS } from "@/lib/fit/ncaa/initialEligibility";
import type { SubjectArea } from "@/lib/fit/ncaa/coreGpa";

export const dynamic = "force-dynamic";

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5v-13z" strokeLinejoin="round" />
      <path d="M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5v-13z" strokeLinejoin="round" />
    </svg>
  );
}

const SUBJECT_LABEL: Record<SubjectArea, string> = {
  english: "English",
  math: "Math",
  science: "Science",
  social_science: "Social science",
  other_academic: "Other academic",
};

// Which division this athlete is being judged against. Initial
// eligibility is a property of where they are going, not of the athlete,
// so it comes off their targets. The strictest live target wins, because
// clearing D1 clears D2, and a screen that quietly judged a D1 recruit
// against the easier D2 bar would be worse than useless.
const DIVISION_RANK: Record<string, number> = { D1: 3, D2: 2, D3: 1 };

function pickDivision(divisions: string[]): string {
  let best = "";
  let bestRank = 0;
  for (const raw of divisions) {
    const d = (raw || "").toUpperCase().replace(/\s+/g, " ").trim();
    const key = /\bD1\b|DIVISION 1|DIVISION I\b|FBS|FCS/.test(d)
      ? "D1"
      : /\bD2\b|DIVISION 2|DIVISION II\b/.test(d)
        ? "D2"
        : /\bD3\b|DIVISION 3|DIVISION III/.test(d)
          ? "D3"
          : "";
    if (!key) continue;
    if (DIVISION_RANK[key]! > bestRank) {
      bestRank = DIVISION_RANK[key]!;
      best = key;
    }
  }
  return best;
}

export default async function EligibilityPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, ["owner", "staff", "member"]);

  const supabase = await createClient();
  const [{ data: athlete }, { data: courseRows }, { data: targetRows }] = await Promise.all([
    supabase
      .from("athletes")
      .select("id, name, gpa, gpa_verified, date_of_birth, first_full_time_enrollment, intended_enrollment")
      .eq("id", id)
      .eq("org_id", org.id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("athlete_courses")
      .select("id, title, subject, credit, grade, term, school_name, weighted, ncaa_approved, duplicate_of")
      .eq("athlete_id", id)
      .eq("org_id", org.id)
      .order("term", { ascending: true }),
    supabase.from("recruiting_targets").select("schools(division)").eq("athlete_id", id).eq("org_id", org.id),
  ]);

  if (!athlete) notFound();

  const courses = (courseRows ?? []) as AthleteCourseRow[];

  const schoolNames = [...new Set(courses.map((c) => c.school_name).filter((s): s is string => !!s))];
  const { data: scaleRows } = schoolNames.length
    ? await supabase
        .from("high_school_grading_scales")
        .select("school_name, bands, reports_weighted_grades, weighting_is_class_rank_only, weight_bonus")
        .in("school_name", schoolNames)
    : { data: [] };

  const divisions = (targetRows ?? []).flatMap((t) => {
    const s = (t as { schools?: { division?: string } | { division?: string }[] }).schools;
    const one = Array.isArray(s) ? s[0] : s;
    return one?.division ? [one.division] : [];
  });
  const division = pickDivision(divisions);

  const view = buildEligibilityView({
    courses,
    scales: (scaleRows ?? []) as GradingScaleRow[],
    division,
    athlete: {
      dateOfBirth: athlete.date_of_birth,
      firstFullTimeEnrollment: athlete.first_full_time_enrollment,
      intendedEnrollment: athlete.intended_enrollment,
    },
    today: new Date().toISOString().slice(0, 10),
  });

  const { eligibility, ageClock } = view;
  const std = eligibility.division ? DIVISION_STANDARDS[eligibility.division] : null;
  const back = `/org/${slug}/roster/${id}`;
  const transcriptGpa = athlete.gpa === null || athlete.gpa === undefined ? null : Number(athlete.gpa);

  // No targets at all: there is no division to judge against, and
  // guessing D1 would put a verdict on screen that nothing supports.
  if (!division) {
    return (
      <main className="px-4 pt-2 pb-6">
        <div className="mb-4">
          <Link href={back} className="text-[13px] font-bold text-muted">
            &larr; {athlete.name}
          </Link>
        </div>
        <h1 className="mb-1 text-[20px] font-extrabold text-ink">NCAA eligibility</h1>
        <p className="mb-5 text-[12.5px] text-muted">Nothing to judge against yet.</p>
        <EmptyState icon={<BookIcon />} title="No school on the board yet">
          Initial eligibility depends on where an athlete is going, not on the athlete. Add a target school and this starts calculating
          against that division.
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={back} className="text-[13px] font-bold text-muted">
          &larr; {athlete.name}
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">NCAA eligibility</h1>
      <p className="mb-5 text-[12.5px] text-muted">
        {division === "D3"
          ? "Target school is Division III."
          : `Division ${division === "D1" ? "I" : "II"} standard. Calculated from ${std?.coreCredits ?? 16} approved core courses, not from the transcript average.`}
      </p>

      <VerdictCard
        status={eligibility.status}
        headline={
          eligibility.status === "not_applicable"
            ? "Division III sets its own academic standards on campus."
            : eligibility.status === "insufficient_data"
              ? "Not enough on file to calculate this yet."
              : eligibility.yearOne
        }
      />

      {eligibility.status === "not_applicable" ? (
        <div className="flex flex-col gap-2">
          {eligibility.reasons.map((r, i) => (
            <NoteRail key={i} role="contact">
              <div className="text-[12.5px] leading-tight text-ink">{r}</div>
            </NoteRail>
          ))}
          <NoteRail role="target">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-ink">Transcript GPA</div>
                <div className="text-[11.5px] text-muted">The school&apos;s own number, unconverted</div>
              </div>
              <span className="text-[13px] font-extrabold tabular-nums text-ink">
                {transcriptGpa === null ? "None" : transcriptGpa.toFixed(2)}
              </span>
            </div>
          </NoteRail>
        </div>
      ) : (
        <>
          <GpaPair coreGpa={eligibility.coreGpa?.gpa ?? null} transcriptGpa={transcriptGpa} needed={std?.qualifierGpa ?? null} />

          {eligibility.coreGpa?.gpa != null && (
            <NoteRail role="contact">
              <div className="text-[12.5px] leading-tight text-ink">
                These are meant to be different. The core GPA counts only NCAA-approved core courses and uses A=4, B=3, with no plus or
                minus. Electives and PE lift a transcript average and are left out of this one.
              </div>
            </NoteRail>
          )}

          {view.schoolsMissingScale.length > 0 && (
            <div className="mt-3">
              <NoteRail role="target">
                <div className="text-[12.5px] font-bold leading-tight text-ink">
                  {view.schoolsMissingScale.join(" and ")} {view.schoolsMissingScale.length > 1 ? "have" : "has"} no grading scale on file
                </div>
                <div className="mt-1 text-[12px] leading-tight text-muted">
                  Those grades are numbers, not letters. The NCAA converts them using the school&apos;s own published table, so an 85 is not
                  automatically a B. Ask the counselor for the conversion table, or upload a transcript that prints it.
                </div>
              </NoteRail>
            </div>
          )}

          {eligibility.warnings.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {eligibility.warnings.map((w, i) => (
                <NoteRail key={i} role="offer">
                  <div className="text-[12.5px] leading-tight text-ink">{w}</div>
                </NoteRail>
              ))}
            </div>
          )}

          {eligibility.coreGpa && eligibility.coreGpa.counted.length > 0 && (
            <>
              <div className="mb-2 mt-5">
                <SectionHeader
                  label="Core courses"
                  count={eligibility.coreGpa.counted.length}
                  role={eligibility.status === "qualifier" || eligibility.status === "early_academic_qualifier" ? "committed" : "offer"}
                />
              </div>
              <div className="flex flex-col gap-2">
                {(Object.keys(SUBJECT_LABEL) as SubjectArea[]).map((subject) => {
                  const inSubject = eligibility.coreGpa!.counted.filter((c) => c.course.subject === subject);
                  if (!inSubject.length) return null;
                  const credits = inSubject.reduce((s, c) => s + c.course.credit, 0);
                  const points = inSubject.reduce((s, c) => s + c.qualityPoints, 0);
                  const subjectGpa = credits > 0 ? points / credits : 0;
                  const min = std?.subjectMinimums[subject] ?? 0;
                  return (
                    <SubjectRow
                      key={subject}
                      label={SUBJECT_LABEL[subject]}
                      credits={`${credits.toFixed(2)} of ${min} credits`}
                      gpa={subjectGpa.toFixed(2)}
                      role={credits >= min ? "committed" : "offer"}
                    />
                  );
                })}
              </div>
            </>
          )}

          {view.skipped.length > 0 && (
            <>
              <div className="mb-2 mt-5">
                <SectionHeader label="Not counted" count={view.skipped.length} role="target" />
              </div>
              <NoteRail role="target">
                <div className="text-[12.5px] leading-tight text-ink">{view.skipped.map((s) => s.title).join(", ")}</div>
                <div className="mt-1 text-[11.5px] leading-tight text-muted">{view.skipped[0]?.reason}</div>
              </NoteRail>
            </>
          )}

          {ageClock.applies && (
            <>
              <div className="mb-2 mt-5">
                <SectionHeader label="The clock" role="time" />
              </div>
              <div className="flex flex-col gap-2">
                {ageClock.reasons.map((r, i) => (
                  <NoteRail key={i} role="time">
                    <div className="text-[12.5px] leading-tight text-ink">{r}</div>
                  </NoteRail>
                ))}
                {ageClock.warnings.map((w, i) => (
                  <NoteRail key={`w${i}`} role="offer">
                    <div className="text-[12.5px] leading-tight text-ink">{w}</div>
                  </NoteRail>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-muted">
        {eligibility.status === "not_applicable"
          ? "If a Division I or II target is added later, this page starts calculating against that division."
          : "A projection until every core credit is final. Confirm with the NCAA Eligibility Center before anyone signs anything."}
      </p>
    </main>
  );
}
