// Every course on an athlete's transcript, by term, with what the NCAA
// did with each one.
//
// This is where "why is my core GPA lower than my transcript GPA" gets
// answered. The eligibility screen gives the verdict and the subject
// totals; this is the row-by-row working behind them.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { loadEligibility } from "@/lib/data/loadEligibility";
import { Body, EmptyState, Label, LinkButton, Row, Screen, Section } from "@/components/kit";
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
  await requireRole(org.id, ["owner", "staff", "member"]);

  const bundle = await loadEligibility(org.id, id, new Date().toISOString().slice(0, 10));
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
      back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}
      lede={`${courses.length} courses · ${core?.counted.length ?? 0} counted by the NCAA`}
    >
      {courses.length === 0 ? (
        <EmptyState kind="course" title="No courses on file">
          Upload a transcript from the athlete&apos;s page and the courses land here.
        </EmptyState>
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
        <Section label="Could not be read" count={view.skipped.length} role="offer" kind="warning">
          {view.skipped.map((s, i) => (
            <Note key={i} title={`${s.title} · ${s.grade}`}>
              {s.reason}
            </Note>
          ))}
        </Section>
      )}

      <LinkButton href={`/org/${slug}/roster/${id}/eligibility`} variant="secondary">
        NCAA Eligibility
      </LinkButton>
    </Screen>
  );
}
