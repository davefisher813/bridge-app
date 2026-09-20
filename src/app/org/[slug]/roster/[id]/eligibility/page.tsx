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
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { Body, Card, EmptyState, Label, LinkButton, Notice, Prose, Row, Screen, Section, Stack, TextLink } from "@/components/kit";
import { GpaPair, Note, SubjectRow, VerdictCard } from "@/components/EligibilityVerdict";
import { DocumentUploader } from "@/components/DocumentUploader";
import { loadEligibility } from "@/lib/data/loadEligibility";
import { DIVISION_STANDARDS } from "@/lib/fit/ncaa/initialEligibility";
import type { SubjectArea } from "@/lib/fit/ncaa/coreGpa";

export const dynamic = "force-dynamic";

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
// pickDivision lives in src/lib/data/loadEligibility.ts, where the
// transcript and approvals screens use the same one.

export default async function EligibilityPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  // Uploading a document is a staff action, same as everywhere else.
  // A member can read the verdict and cannot change what it is built on.
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canUpload = (STAFF_ROLES as string[]).includes(user.role);

  // One loader, shared with the transcript and approvals screens. A
  // second copy that read one grading-scale table instead of two is the
  // bug that sat in this very file for a release.
  const bundle = await loadEligibility(org.id, id, new Date().toISOString().slice(0, 10));
  if (!bundle) notFound();
  const { athlete, view, division, courses } = bundle;

  const { eligibility, ageClock } = view;
  const std = eligibility.division ? DIVISION_STANDARDS[eligibility.division] : null;
  const back = { href: `/org/${slug}/roster/${id}`, label: athlete.name };
  const here = `/org/${slug}/roster/${id}/eligibility`;
  const transcriptGpa = athlete.gpa === null || athlete.gpa === undefined ? null : Number(athlete.gpa);

  const uploader = canUpload && (
    <Section label={courses.length ? "Add another transcript" : "Add a transcript"} role="contact" kind="document">
      <Prose>
        {courses.length
          ? `Goes straight onto ${athlete.name.split(" ")[0]}'s record. A transfer student legitimately has two, and the second does not replace the first.`
          : "Read for its course list, not just its GPA. That course list is the only thing an NCAA core GPA can be calculated from, so nothing above works until one is on file."}
      </Prose>
      <DocumentUploader slug={slug} orgId={org.id} boundTo={{ athleteId: id, athleteName: athlete.name, category: "transcript", returnTo: here }} />
    </Section>
  );

  // No targets at all: there is no division to judge against, and
  // guessing D1 would put a verdict on screen that nothing supports.
  if (!division) {
    return (
      <Screen title="NCAA Eligibility" back={back}>
        <EmptyState kind="school" title="No School on the Board Yet">
          Initial eligibility depends on where an athlete is going, not on the athlete. Add a target school and this starts calculating
          against that division.
        </EmptyState>
        {uploader}
      </Screen>
    );
  }

  const caveats = [...view.adapterWarnings, ...eligibility.warnings];
  const openApprovals = view.approvals.filter((a) => a.match.status === "unknown" || a.match.status === "ambiguous").length;
  const approvedCount = view.approvals.filter((a) => a.match.status === "approved").length;
  const notApprovedCount = view.approvals.filter((a) => a.match.status === "not_approved").length;

  return (
    <Screen
      title="NCAA Eligibility"
      back={back}
    >
      <Stack>
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
          <Notice tone="warning" title="Not a Final Status">
            {eligibility.coreGpa.totalCredits} of {std?.coreCredits ?? 16} core credits are on file, and the rest can move this either way.
          </Notice>
        )}
      </Stack>

      {eligibility.status === "not_applicable" ? (
        <Stack>
          {eligibility.reasons.map((r, i) => (
            <Note key={i}>{r}</Note>
          ))}
          <Row
            kind="scale"
            role="target"
            title="Transcript GPA"
            meta="The school's own number, unconverted"
            trailing={
              <Body weight="bold" numeric>
                {transcriptGpa === null ? "None" : transcriptGpa.toFixed(2)}
              </Body>
            }
          />
        </Stack>
      ) : (
        <>
          <Stack>
            <GpaPair coreGpa={eligibility.coreGpa?.gpa ?? null} transcriptGpa={transcriptGpa} needed={std?.qualifierGpa ?? null} />
            {eligibility.coreGpa?.gpa != null && (
              <Note>
                These are meant to be different. The core GPA counts only NCAA-approved core courses and uses A=4, B=3, with no plus or
                minus. Electives and PE lift a transcript average and are left out of this one.
              </Note>
            )}
            {view.schoolsMissingScale.length > 0 && (
              <Card>
                <Stack gap={2}>
                  <Body weight="bold">
                    {view.schoolsMissingScale.join(" and ")} {view.schoolsMissingScale.length > 1 ? "have" : "has"} no grading scale on file
                  </Body>
                  <Label>
                    Those grades are numbers, and the number above was produced by assuming the standard ten-point scale. The NCAA uses the
                    school&apos;s own published table, so an 85 is not automatically a B. Enter the real table and this recalculates.
                  </Label>
                  {canUpload && (
                    <div>
                      <TextLink
                        href={`/org/${slug}/grading-scales/new?school=${encodeURIComponent(view.schoolsMissingScale[0] ?? "")}&returnTo=${encodeURIComponent(here)}`}
                      >
                        Enter the Grading Scale
                      </TextLink>
                    </div>
                  )}
                </Stack>
              </Card>
            )}
          </Stack>

          {/* Against the school's NCAA approved list. Until migration
              0014 nothing set the approval flag, so every core GPA in
              the product carried an "estimate" warning. This is the row
              that says whether it still does. */}
          {(view.approvals.length > 0 || view.schoolsMissingApprovedList.length > 0) && (
            <Section label="Against the Approved List" role="committed" kind="checklist">
              {view.approvals.length > 0 && (
                <Row
                  href={`${here}/approvals`}
                  kind="checklist"
                  role={openApprovals > 0 ? "offer" : "committed"}
                  title={`${approvedCount} confirmed on the list`}
                  meta={`${notApprovedCount} not approved${openApprovals > 0 ? ` · ${openApprovals} unchecked` : ""}`}
                  trailing={<Body tone="muted">&rsaquo;</Body>}
                />
              )}
              {view.schoolsMissingApprovedList.length > 0 && (
                <Card>
                  <Stack gap={2}>
                    <Body weight="bold">
                      {view.schoolsMissingApprovedList.join(" and ")} {view.schoolsMissingApprovedList.length > 1 ? "have" : "has"} no
                      approved list on file
                    </Body>
                    {canUpload && (
                      <div>
                        <TextLink href={`/org/${slug}/approved-courses/new?school=${encodeURIComponent(view.schoolsMissingApprovedList[0] ?? "")}`}>
                          Enter the Approved List
                        </TextLink>
                      </div>
                    )}
                  </Stack>
                </Card>
              )}
            </Section>
          )}

          {/* Which table each school's numbers ran through. Only appears
              when a numeric grade actually used one: a transcript that
              prints letters converts the same either way, and a caveat
              that applies to nothing is worse than no caveat. */}
          {view.scalesUsed.length > 0 && (
            <Section label="How the Grades Were Converted" role="people" kind="scale">
              {view.scalesUsed.map((s, i) => (
                <Note
                  key={i}
                  title={
                    s.origin === "verified"
                      ? `${s.school} numbers converted through a confirmed table`
                      : s.origin === "org"
                        ? `${s.school} numbers converted through a table your org entered`
                        : `${s.school} numbers converted on an assumed ten-point scale`
                  }
                >
                  {s.origin === "verified"
                    ? "Verified and shared across the platform. Your org cannot change this one."
                    : s.origin === "org"
                      ? `${s.sourceNote ? `"${s.sourceNote}." ` : ""}Nobody has confirmed it with the school, so this core GPA is only as right as that table.`
                      : "Nothing from this school is on file. This is a placeholder conversion, not what the NCAA will use."}
                </Note>
              ))}
            </Section>
          )}

          {/* adapterWarnings carries the grade-conversion problems, which
              are the ones that can silently inflate a GPA. Three here,
              then the rest on their own page: a verdict with nine caveats
              stacked under it reads as a wall nobody finishes. */}
          {caveats.length > 0 && (
            <Section label="Things to Know" count={caveats.length} role="offer" kind="warning">
              {caveats.slice(0, 3).map((w, i) => (
                <Note key={i}>{w}</Note>
              ))}
              <LinkButton href={`${here}/caveats`} variant="secondary">
                {caveats.length > 3 ? `All ${caveats.length} things to know` : "What to do about these"}
              </LinkButton>
            </Section>
          )}

          {eligibility.coreGpa && eligibility.coreGpa.counted.length > 0 && (
            <Section
              label="Core Courses"
              count={eligibility.coreGpa.counted.length}
              role={eligibility.status === "qualifier" || eligibility.status === "early_academic_qualifier" ? "committed" : "offer"}
              kind="course"
            >
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
            </Section>
          )}

          {view.skipped.length > 0 && (
            <Section label="Not Counted" count={view.skipped.length} role="target">
              <Note title={view.skipped.map((s) => s.title).join(", ")}>{view.skipped[0]?.reason}</Note>
            </Section>
          )}

          {ageClock.applies && (
            <Section label="The Clock" role="time" kind="clock">
              {ageClock.reasons.map((r, i) => (
                <Note key={i}>{r}</Note>
              ))}
              {ageClock.warnings.map((w, i) => (
                <Notice key={`w${i}`} tone="warning" title={w} />
              ))}
            </Section>
          )}
        </>
      )}

      {/* The upload lives here rather than only on the documents screen
          because this page is where someone notices the courses are
          missing. Bound to this athlete: the category is fixed to a
          transcript, the athlete is pinned rather than matched by the
          name printed on the page, and it comes back here. */}
      {uploader}

      <Prose>
        {eligibility.status === "not_applicable"
          ? "If a Division I or II target is added later, this page starts calculating against that division."
          : "A projection until every core credit is final. Confirm with the NCAA Eligibility Center before anyone signs anything."}
      </Prose>
    </Screen>
  );
}
