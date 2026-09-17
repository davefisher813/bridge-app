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
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { SectionHeader, EmptyState, RailCard } from "@/components/catalog";
import { GpaPair, NoteRail, SubjectRow, VerdictCard } from "@/components/EligibilityVerdict";
import { DocumentUploader } from "@/components/DocumentUploader";
import { loadEligibility } from "@/lib/data/loadEligibility";
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
// pickDivision moved to src/lib/data/loadEligibility.ts, where the
// transcript and approvals screens use the same one.

export default async function EligibilityPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  // Uploading a document is a staff action, same as everywhere else.
  // A member can read the verdict and cannot change what it is built on.
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canUpload = (STAFF_ROLES as string[]).includes(user.role);

  // One loader, shared with the transcript and approvals screens. The
  // query used to live inline here; the moment a second page needed the
  // same thing, a second copy was the obvious move, and a second copy
  // that reads one grading-scale table instead of two is the bug that
  // sat in this very file for a release.
  const bundle = await loadEligibility(org.id, id, new Date().toISOString().slice(0, 10));
  if (!bundle) notFound();
  const { athlete, view, division, courses } = bundle;

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
          <Link href={back} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
            &larr; {athlete.name}
          </Link>
        </div>
        <h1 className="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
        <p className="mb-5 text-[13.5px] text-muted">Nothing to judge against yet.</p>
        <EmptyState icon={<BookIcon />} title="No school on the board yet">
          Initial eligibility depends on where an athlete is going, not on the athlete. Add a target school and this starts calculating
          against that division.
        </EmptyState>
        {/* Still worth loading the transcript now: the courses are what
            any future verdict is built from, and reading them does not
            depend on a target existing yet. */}
        {canUpload && (
          <>
            <div className="mb-2 mt-6">
              <SectionHeader label="Add a transcript anyway" role="contact" />
            </div>
            <p className="mb-3 text-[13px] leading-tight text-muted">
              The course list is what a core GPA is calculated from. Loading it now means the verdict is ready the moment a school goes on
              the board.
            </p>
            <DocumentUploader
              slug={slug}
              boundTo={{ athleteId: id, athleteName: athlete.name, category: "transcript", returnTo: `/org/${slug}/roster/${id}/eligibility` }}
            />
          </>
        )}
      </main>
    );
  }

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={back} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; {athlete.name}
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">NCAA eligibility</h1>
      <p className="mb-5 text-[13.5px] text-muted">
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

      {eligibility.projected && eligibility.coreGpa?.gpa != null && (
        <div className="mb-4">
          <NoteRail role="offer">
            <div className="text-[13.5px] leading-tight text-ink">
              Not a final status. {eligibility.coreGpa.totalCredits} of {std?.coreCredits ?? 16} core credits are on file, and the rest can
              move this either way.
            </div>
          </NoteRail>
        </div>
      )}

      {eligibility.status === "not_applicable" ? (
        <div className="flex flex-col gap-2">
          {eligibility.reasons.map((r, i) => (
            <NoteRail key={i} role="contact">
              <div className="text-[13.5px] leading-tight text-ink">{r}</div>
            </NoteRail>
          ))}
          <NoteRail role="target">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14.5px] font-bold text-ink">Transcript GPA</div>
                <div className="text-[12.5px] text-muted">The school&apos;s own number, unconverted</div>
              </div>
              <span className="text-[14.5px] font-extrabold tabular-nums text-ink">
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
              <div className="text-[13.5px] leading-tight text-ink">
                These are meant to be different. The core GPA counts only NCAA-approved core courses and uses A=4, B=3, with no plus or
                minus. Electives and PE lift a transcript average and are left out of this one.
              </div>
            </NoteRail>
          )}

          {view.schoolsMissingScale.length > 0 && (
            <div className="mt-3">
              <NoteRail role="offer">
                <div className="text-[13.5px] font-bold leading-tight text-ink">
                  {view.schoolsMissingScale.join(" and ")} {view.schoolsMissingScale.length > 1 ? "have" : "has"} no grading scale on file
                </div>
                <div className="mt-1 text-[13px] leading-tight text-muted">
                  Those grades are numbers, and the number above was produced by assuming the standard ten-point scale. The NCAA uses the
                  school&apos;s own published table, so an 85 is not automatically a B. Enter the real table and this recalculates.
                </div>
                {canUpload && (
                  <Link
                    href={`/org/${slug}/grading-scales/new?school=${encodeURIComponent(view.schoolsMissingScale[0] ?? "")}&returnTo=${encodeURIComponent(`/org/${slug}/roster/${id}/eligibility`)}`}
                    className="mt-2 inline-block text-[13px] font-extrabold text-tint-accent-on"
                  >
                    Enter the grading scale
                  </Link>
                )}
              </NoteRail>
            </div>
          )}

          {/* Against the school's NCAA approved list. Until migration
              0014 nothing set the approval flag, so every core GPA in
              the product carried an "estimate" warning. This is the row
              that says whether it still does. */}
          {view.approvals.length > 0 && (
            <>
              <div className="mb-2 mt-5">
                <SectionHeader label="Against the approved list" role="committed" kind="checklist" />
              </div>
              <Link href={`/org/${slug}/roster/${id}/eligibility/approvals`} className="block">
                <RailCard
                  role={view.approvals.some((a) => a.match.status === "unknown" || a.match.status === "ambiguous") ? "offer" : "committed"}
                  kind="checklist"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-bold leading-tight text-ink">
                        {view.approvals.filter((a) => a.match.status === "approved").length} confirmed on the list
                      </div>
                      <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
                        {view.approvals.filter((a) => a.match.status === "not_approved").length} not approved
                        {(() => {
                          const open = view.approvals.filter((a) => a.match.status === "unknown" || a.match.status === "ambiguous").length;
                          return open > 0 ? ` · ${open} unchecked` : "";
                        })()}
                      </div>
                    </div>
                    <span className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">&rsaquo;</span>
                  </div>
                </RailCard>
              </Link>
            </>
          )}

          {view.schoolsMissingApprovedList.length > 0 && (
            <div className="mt-3">
              <RailCard role="offer" kind="warning">
                <div className="text-[13.5px] font-bold leading-tight text-ink">
                  {view.schoolsMissingApprovedList.join(" and ")} {view.schoolsMissingApprovedList.length > 1 ? "have" : "has"} no approved
                  list on file
                </div>
                {canUpload && (
                  <Link
                    href={`/org/${slug}/approved-courses/new?school=${encodeURIComponent(view.schoolsMissingApprovedList[0] ?? "")}`}
                    className="-mb-2 mt-1 inline-flex min-h-[44px] items-center pr-3 text-[13.5px] font-extrabold text-tint-accent-on"
                  >
                    Enter the approved list
                  </Link>
                )}
              </RailCard>
            </div>
          )}

          {/* Which table each school's numbers ran through. Only appears
              when a numeric grade actually used one: a transcript that
              prints letters converts the same either way, and a caveat
              that applies to nothing is worse than no caveat. */}
          {view.scalesUsed.length > 0 && (
            <>
              <div className="mb-2 mt-5">
                <SectionHeader label="How the grades were converted" role="people" />
              </div>
              <div className="flex flex-col gap-2">
                {/* NoteRail's roles are fixed by the locked catalog, so
                    the escalation runs inside them: blue for a confirmed
                    table, gray for one this org typed, orange for a
                    conversion nobody supplied at all. */}
                {view.scalesUsed.map((s, i) => (
                  <NoteRail key={i} role={s.origin === "verified" ? "contact" : s.origin === "org" ? "target" : "offer"}>
                    <div className="text-[13.5px] leading-tight text-ink">
                      {s.origin === "verified"
                        ? `${s.school} numbers converted through a confirmed table`
                        : s.origin === "org"
                          ? `${s.school} numbers converted through a table your org entered`
                          : `${s.school} numbers converted on an assumed ten-point scale`}
                    </div>
                    <div className="mt-1 text-[12.5px] leading-tight text-muted">
                      {s.origin === "verified"
                        ? "Verified and shared across the platform. Your org cannot change this one."
                        : s.origin === "org"
                          ? `${s.sourceNote ? `"${s.sourceNote}." ` : ""}Nobody has confirmed it with the school, so this core GPA is only as right as that table.`
                          : "Nothing from this school is on file. This is a placeholder conversion, not what the NCAA will use."}
                    </div>
                  </NoteRail>
                ))}
              </div>
            </>
          )}

          {/* adapterWarnings carries the grade-conversion problems, which
              are the ones that can silently inflate a GPA. They were
              being computed and never rendered. */}
          {[...view.adapterWarnings, ...eligibility.warnings].length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {[...view.adapterWarnings, ...eligibility.warnings].slice(0, 3).map((w, i) => (
                <NoteRail key={i} role="offer">
                  <div className="text-[13.5px] leading-tight text-ink">{w}</div>
                </NoteRail>
              ))}
              {/* Three, then the rest on their own page. A verdict with
                  nine caveats stacked under it reads as a wall nobody
                  finishes, and the caveats page sorts them into the ones
                  somebody can clear today and the ones they cannot. */}
              <Link
                href={`/org/${slug}/roster/${id}/eligibility/caveats`}
                className="flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[15px] font-bold text-ink"
              >
                {[...view.adapterWarnings, ...eligibility.warnings].length > 3
                  ? `All ${[...view.adapterWarnings, ...eligibility.warnings].length} things to know`
                  : "Things to know, and what to do"}
              </Link>
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
                <div className="text-[13.5px] leading-tight text-ink">{view.skipped.map((s) => s.title).join(", ")}</div>
                <div className="mt-1 text-[12.5px] leading-tight text-muted">{view.skipped[0]?.reason}</div>
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
                    <div className="text-[13.5px] leading-tight text-ink">{r}</div>
                  </NoteRail>
                ))}
                {ageClock.warnings.map((w, i) => (
                  <NoteRail key={`w${i}`} role="offer">
                    <div className="text-[13.5px] leading-tight text-ink">{w}</div>
                  </NoteRail>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* The upload lives here rather than only on the documents screen
          because this page is where someone notices the courses are
          missing. Bound to this athlete: the category is fixed to a
          transcript, the athlete is pinned rather than matched by the
          name printed on the page, and it comes back here. That pinning
          is also what makes a nameless portal export usable, since the
          person uploading it has already said whose it is. */}
      {canUpload && (
        <>
          <div className="mb-2 mt-6">
            <SectionHeader label={courses.length ? "Add another transcript" : "Add a transcript"} role="contact" />
          </div>
          <p className="mb-3 text-[13px] leading-tight text-muted">
            {courses.length
              ? `Goes straight onto ${athlete.name.split(" ")[0]}'s record. A transfer student legitimately has two, and the second does not replace the first.`
              : `Read for its course list, not just its GPA. That course list is the only thing an NCAA core GPA can be calculated from, so nothing above works until one is on file.`}
          </p>
          <DocumentUploader
            slug={slug}
            boundTo={{ athleteId: id, athleteName: athlete.name, category: "transcript", returnTo: `/org/${slug}/roster/${id}/eligibility` }}
          />
        </>
      )}

      <p className="mt-5 text-[12px] leading-relaxed text-muted">
        {eligibility.status === "not_applicable"
          ? "If a Division I or II target is added later, this page starts calculating against that division."
          : "A projection until every core credit is final. Confirm with the NCAA Eligibility Center before anyone signs anything."}
      </p>
    </main>
  );
}
