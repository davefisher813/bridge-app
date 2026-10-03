// Every course on an athlete's transcript, by term, with what the NCAA
// did with each one.
//
// This is where "why is my core GPA lower than my transcript GPA" gets
// answered. The eligibility screen gives the verdict and the subject
// totals; this is the row-by-row working behind them.
//
// Staff open a row to correct it and add a row by hand (audit crud F5):
// a misread grade no longer means discarding the whole document. A
// family login reads the same list and changes nothing.

import { orgToday } from "@/lib/datetime/today";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { athleteHome, requireRole } from "@/lib/auth/guard";
import { assertMayViewAthlete } from "@/lib/data/family";
import { loadEligibility } from "@/lib/data/loadEligibility";
import { AddButton, Body, EmptyState, Label, LinkButton, Row, Screen, Section, Stack } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";

export const dynamic = "force-dynamic";

const SUBJECT: Record<string, string> = {
  english: "English",
  math: "Math",
  science: "Science",
  social_science: "Social science",
  other_academic: "Other academic",
  non_academic: "Not academic",
};

export default async function TranscriptPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "family"]);
  await assertMayViewAthlete(org.id, user, id);
  const home = athleteHome(slug, id, user.role);
  const isStaff = user.role === "owner" || user.role === "staff";
  const addHref = `/org/${slug}/roster/${id}/transcript/new`;

  const bundle = await loadEligibility(org.id, id, orgToday());
  if (!bundle) notFound();
  const { athlete, courses, view } = bundle;
  const core = view.eligibility.coreGpa;

  // Keyed on title plus term, not title alone: a year-long course
  // appears twice and the two halves are different rows with different
  // grades.
  const countedBy = new Map((core?.counted ?? []).map((c) => [c.course.title + "|" + (c.course.term ?? ""), c]));
  const excludedBy = new Map((core?.excluded ?? []).map((x) => [x.course.title + "|" + (x.course.term ?? ""), x]));

  const byTerm = new Map<string, typeof courses>();
  for (const c of courses) {
    const term = c.term ?? "No term";
    byTerm.set(term, [...(byTerm.get(term) ?? []), c]);
  }
  const terms = [...byTerm.keys()].sort().reverse();

  return (
    <Screen
      title="Transcript"
      back={{ href: home, label: athlete.name }}
      lede={`${courses.length} courses · ${core?.counted.length ?? 0} counted by the NCAA`}
      action={isStaff ? <AddButton href={addHref} label="Add" /> : undefined}
    >
      {courses.length === 0 ? (
        <EmptyState
          kind="course"
          title="No Courses on File"
          action={
            isStaff ? (
              <Stack gap={2}>
                <LinkButton href={`/org/${slug}/documents/new`}>Upload a Transcript</LinkButton>
                <LinkButton href={addHref} variant="secondary">
                  Type a Course In
                </LinkButton>
              </Stack>
            ) : undefined
          }
        />
      ) : (
        terms.map((term) => (
          <Section key={term} label={term} count={byTerm.get(term)!.length} role="contact" kind="course">
            {byTerm.get(term)!.map((c) => {
              const key = c.title + "|" + (c.term ?? "");
              const hit = countedBy.get(key);
              const miss = excludedBy.get(key);
              const role = hit ? "committed" : miss ? "target" : "contact";
              // The reason, on the row it belongs to. A list of excluded
              // titles at the bottom of another screen makes you match
              // them up yourself.
              const line = `${SUBJECT[c.subject] ?? c.subject} · ${Number(c.credit)} credit${c.weighted ? " · weighted" : ""}`;
              return (
                <Row
                  key={c.id}
                  href={isStaff ? `/org/${slug}/roster/${id}/transcript/${c.id}` : `${home}/eligibility/approvals`}
                  kind={miss ? "blocked" : "course"}
                  role={role}
                  title={c.title}
                  meta={miss ? `${line} · ${miss.reason}` : line}
                  wrap={Boolean(miss)}
                  trailing={
                    <>
                      <Body weight="bold" numeric>
                        {c.grade}
                      </Body>
                      {hit && <Label>{hit.points.toFixed(1)} pts</Label>}
                    </>
                  }
                />
              );
            })}
          </Section>
        ))
      )}

      {view.skipped.length > 0 && (
        <Section label="Could Not Be Read" count={view.skipped.length} role="offer" kind="warning">
          {view.skipped.map((s, i) => (
            <Note key={i} title={`${s.title} · ${s.grade}`}>
              {s.reason}
            </Note>
          ))}
        </Section>
      )}

      <LinkButton href={`${home}/eligibility`} variant="secondary">
        NCAA Eligibility
      </LinkButton>
      {isStaff && courses.length > 0 && (
        <LinkButton href={`${home}/eligibility/approvals`} variant="secondary">
          Course Approvals
        </LinkButton>
      )}
    </Screen>
  );
}
