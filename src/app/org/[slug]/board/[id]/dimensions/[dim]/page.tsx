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
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph, type RowKind } from "@/components/RowGlyph";
import { TEXT_ON, scoreRole } from "@/components/statusHue";
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
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link
          href={`/org/${slug}/board/${id}`}
          className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted"
        >
          &larr; {bundle.school.name}
        </Link>
      </div>

      <div className="mb-1 flex items-start justify-between gap-3">
        <h1 className="text-[22px] font-extrabold leading-tight text-ink">{meta.label}</h1>
        <span className={`flex-shrink-0 text-[28px] font-black leading-none tabular-nums ${TEXT_ON[scoreRole(d.score)]}`}>{d.score}</span>
      </div>
      <p className="mb-5 text-[13.5px] leading-tight text-muted">
        {meta.asks} {bundle.athlete.name} at {bundle.school.name}.
      </p>

      {/* A veto is not a low score, and the difference matters enough to
          say it above everything else. A veto means the blend was thrown
          away and this dimension set the number by itself. */}
      {d.veto && (
        <div className="mb-5">
          <RailCard role="offer" kind="warning">
            <div className="text-[14.5px] font-bold leading-tight text-ink">This one overrides the others</div>
            <div className="mt-1 text-[13px] leading-relaxed text-muted">
              A veto is not a low score averaged in with the rest. The overall fit was set by this dimension alone, because nothing the
              athlete does elsewhere gets past it.
            </div>
          </RailCard>
        </div>
      )}

      <div className="mb-2">
        <SectionHeader label="Why" count={d.reasons.length} role={role} kind={meta.kind} />
      </div>
      {d.reasons.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="note" role="neutral" className="h-7 w-7" />} title="No reason given">
          The engine returned a score without a stated reason, which normally means it had nothing specific to this school to work from.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {d.reasons.map((r, i) => (
            <RailCard key={i} role={role} kind={meta.kind}>
              <div className="text-[13.5px] leading-relaxed text-ink">{r}</div>
            </RailCard>
          ))}
        </div>
      )}

      {/* Warnings are not reasons and are not filed with them. A reason
          is why the number is what it is; a warning is what could still
          change it. Mixing them is how a coordinator reads "not
          verified" as a finding. */}
      {d.warnings.length > 0 && (
        <>
          <div className="mb-2 mt-5">
            <SectionHeader label="What could still change this" count={d.warnings.length} role="offer" kind="warning" />
          </div>
          <div className="flex flex-col gap-2">
            {d.warnings.map((w, i) => (
              <RailCard key={i} role="offer" kind="warning">
                <div className="text-[13.5px] leading-relaxed text-ink">{w}</div>
              </RailCard>
            ))}
          </div>
        </>
      )}

      <div className="mb-2 mt-5">
        <SectionHeader label="How sure" role="contact" kind="info" />
      </div>
      <RailCard role="contact" kind="info">
        <div className="text-[14.5px] font-bold capitalize text-ink">{d.confidence}</div>
        <div className="mt-1 text-[13px] leading-relaxed text-muted">
          {CONFIDENCE_NOTE[d.confidence] ?? "No confidence reported."}
        </div>
      </RailCard>

      <div className="mt-5">
        <Link
          href={`/org/${slug}/board/${id}`}
          className="flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[15px] font-bold text-ink"
        >
          Back to the full score
        </Link>
      </div>
    </main>
  );
}
