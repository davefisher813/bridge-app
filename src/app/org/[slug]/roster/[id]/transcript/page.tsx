// Every course on an athlete's transcript, by term, with what the NCAA
// did with each one.
//
// This is where "why is my core GPA lower than my transcript GPA" gets
// answered. The eligibility screen gives the verdict and the subject
// totals; this is the row-by-row working behind them.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { loadEligibility } from "@/lib/data/loadEligibility";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";
import type { SubjectArea } from "@/lib/fit/ncaa/coreGpa";

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
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link href={`/org/${slug}/roster/${id}`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; {athlete.name}
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Transcript</h1>
      <div className="mb-5 text-[12.5px] font-bold text-muted">
        {courses.length} courses &middot; {core?.counted.length ?? 0} counted by the NCAA
      </div>

      {courses.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="course" role="neutral" className="h-7 w-7" />} title="No courses on file">
          Upload a transcript from the athlete&apos;s page and the courses land here.
        </EmptyState>
      ) : (
        terms.map((term) => (
          <div key={term} className="mb-4">
            <div className="mb-2">
              <SectionHeader label={term} count={byTerm.get(term)!.length} role="contact" kind="course" />
            </div>
            <div className="flex flex-col gap-2">
              {byTerm.get(term)!.map((c) => {
                const key = c.title + "|" + (c.term ?? "");
                const hit = countedBy.get(key);
                const miss = excludedBy.get(key);
                const role = hit ? "committed" : miss ? "target" : "contact";
                return (
                  <RailCard key={c.id} role={role} kind={miss ? "blocked" : "course"}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold leading-tight text-ink">{c.title}</div>
                        <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                          {SUBJECT[c.subject] ?? c.subject} &middot; {Number(c.credit)} credit
                          {c.weighted ? " · weighted" : ""}
                        </div>
                        {/* The reason, on the row it belongs to. A list
                            of excluded titles at the bottom of another
                            screen makes you match them up yourself. */}
                        {miss && <div className="mt-1 text-[11.5px] font-semibold leading-tight text-tint-accent-on">{miss.reason}</div>}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-[14px] font-extrabold tabular-nums text-ink">{c.grade}</div>
                        {hit && <div className="text-[10.5px] font-bold text-muted">{hit.points.toFixed(1)} pts</div>}
                      </div>
                    </div>
                  </RailCard>
                );
              })}
            </div>
          </div>
        ))
      )}

      {view.skipped.length > 0 && (
        <>
          <div className="mb-2 mt-5">
            <SectionHeader label="Could not be read" count={view.skipped.length} role="offer" kind="warning" />
          </div>
          <div className="flex flex-col gap-2">
            {view.skipped.map((s, i) => (
              <RailCard key={i} role="offer" kind="warning">
                <div className="text-[13px] font-bold leading-tight text-ink">
                  {s.title} &middot; {s.grade}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-tight text-muted">{s.reason}</div>
              </RailCard>
            ))}
          </div>
        </>
      )}

      <Link
        href={`/org/${slug}/roster/${id}/eligibility`}
        className="mt-5 flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[14px] font-bold text-ink"
      >
        NCAA eligibility
      </Link>
    </main>
  );
}
