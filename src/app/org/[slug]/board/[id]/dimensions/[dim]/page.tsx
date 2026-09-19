// One fit dimension, in full.
//
// The target page shows four dimensions with the first reason under each
// and a count of the rest. That is the right density for a summary and
// the wrong place to stop, because the reasons ARE the argument: a
// financial score of 42 is a number, and "average aid covers only 18% of
// cost" is the sentence somebody can act on.
//
// Everything here comes from the same scoreFit() call the target page
// made, through loadTarget. No second computation, so a dimension cannot
// score one way on the summary and another when it is opened.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { EmptyState, Figure, LinkButton, Notice, Screen, Section } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { RowKind } from "@/components/RowGlyph";
import { scoreRole } from "@/components/statusHue";
import { loadTarget } from "@/lib/data/loadTarget";
import type { DimensionResult } from "@/lib/fit/types";

export const dynamic = "force-dynamic";

type DimKey = "academic" | "athletic" | "financial" | "eligibility";

const DIM: Record<DimKey, { label: string; kind: RowKind; asks: string }> = {
  academic: { label: "Academic", kind: "course", asks: "Can they get in, and stay in." },
  athletic: { label: "Athletic", kind: "target", asks: "Do the measurables reach this level of play." },
  financial: { label: "Financial", kind: "money", asks: "What this actually costs the family." },
  eligibility: { label: "Eligibility", kind: "checklist", asks: "Whether the NCAA lets them compete, and when." },
};

// What the engine means by its own word, rather than the word alone.
// "low" beside a score is the kind of label that gets read as "bad score"
// instead of "we are guessing", which is the opposite of what it says.
const CONFIDENCE_NOTE: Record<string, string> = {
  high: "Based on data specific to this school and this athlete.",
  medium: "Based on partial data. Some of it is a division default rather than this school's own numbers.",
  low: "Mostly division defaults. Treat the score as a starting point, not a finding.",
  unknown: "Not enough on file to judge. The score is a placeholder, not a measurement.",
};

const CONFIDENCE_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low", unknown: "Unknown" };

function isDimKey(v: string): v is DimKey {
  return v === "academic" || v === "athletic" || v === "financial" || v === "eligibility";
}

export default async function DimensionPage({ params }: { params: Promise<{ slug: string; id: string; dim: string }> }) {
  const { slug, id, dim } = await params;
  if (!isDimKey(dim)) notFound();

  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, ["owner", "staff", "member"]);

  const bundle = await loadTarget(org.id, id);
  if (!bundle) notFound();

  const d = bundle.fit[dim] as DimensionResult | undefined;
  // Eligibility is only computed for a transfer. A high school athlete
  // has no transfer dimension, and an empty page saying "0" would be a
  // claim rather than an absence.
  if (!d) notFound();

  const meta = DIM[dim];
  const role = d.veto ? "offer" : d.score >= 70 ? "committed" : d.score >= 40 ? "contact" : "target";

  return (
    <Screen
      title={meta.label}
      back={{ href: `/org/${slug}/board/${id}`, label: bundle.school.name }}
      lede={`${meta.asks} ${bundle.athlete.name} at ${bundle.school.name}.`}
      action={<Figure tone={scoreRole(d.score)}>{d.score}</Figure>}
    >
      {/* A veto is not a low score, and the difference matters enough to
          say it above everything else. A veto means the blend was thrown
          away and this dimension set the number by itself. */}
      {d.veto && (
        <Notice tone="warning" title="This one overrides the others">
          A veto is not a low score averaged in with the rest. The overall fit was set by this dimension alone, because nothing the athlete
          does elsewhere gets past it.
        </Notice>
      )}

      <Section label="Why" count={d.reasons.length} role={role} kind={meta.kind}>
        {d.reasons.length === 0 ? (
          <EmptyState kind="note" title="No reason given">
            The engine returned a score without a stated reason, which normally means it had nothing specific to this school to work from.
          </EmptyState>
        ) : (
          d.reasons.map((r, i) => <Note key={i}>{r}</Note>)
        )}
      </Section>

      {/* Warnings are not reasons and are not filed with them. A reason
          is why the number is what it is; a warning is what could still
          change it. Mixing them is how a coordinator reads "not
          verified" as a finding. */}
      {d.warnings.length > 0 && (
        <Section label="What could still change this" count={d.warnings.length} role="offer" kind="warning">
          {d.warnings.map((w, i) => (
            <Note key={i}>{w}</Note>
          ))}
        </Section>
      )}

      <Section label="How sure" role="contact" kind="info">
        <Note title={CONFIDENCE_LABEL[d.confidence] ?? d.confidence}>{CONFIDENCE_NOTE[d.confidence] ?? "No confidence reported."}</Note>
      </Section>

      <LinkButton href={`/org/${slug}/board/${id}`} variant="secondary">
        Back to the Full Score
      </LinkButton>
    </Screen>
  );
}
