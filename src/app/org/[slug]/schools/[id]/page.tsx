// One school: what it costs, what it takes academically, how deep the
// position is, and which of your athletes are pointed at it.
//
// The schools list was built on 2026-09-17 and every row on it was a dead
// end. A school record is the input to half the fit engine, so "what does
// this school actually say" had no answer anywhere in the product.
//
// The D3 rule is enforced here as well as in the engine. It is a law
// (src/laws/fitLaws.test.ts) because a D3 school cannot offer athletic
// aid under NCAA rules, whatever a School record's financials field was
// filled in with, and a screen that prints the field is a screen that
// tells a family money exists.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { RailCard, SectionHeader, EmptyState, ScorePill } from "@/components/catalog";
import { StatusPill } from "@/components/StatusPill";
import { RowGlyph } from "@/components/RowGlyph";
import { statusRole } from "@/components/statusHue";
import { schoolRowToFitSchool, type SchoolRow } from "@/lib/data/fitAdapters";
import { isD3 } from "@/lib/fit/benchmarks";
import { loadTarget } from "@/lib/data/loadTarget";

export const dynamic = "force-dynamic";

const AID_LABEL: Record<string, string> = {
  full: "Full scholarships available",
  partial: "Partial scholarships available",
  none: "No athletic aid, academic only",
};

const OUTLOOK_LABEL: Record<string, string> = {
  realistic: "Realistic shot at playing time",
  competitive: "Competitive for playing time",
  difficult: "Difficult to break into",
};

function money(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[12px] bg-paper p-3.5">
      <div className="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">{label}</div>
      <div className="mt-1 text-[22px] font-black leading-tight tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] leading-tight text-muted">{sub}</div>}
    </div>
  );
}

export default async function SchoolPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: schoolRow }, { data: targetRows }] = await Promise.all([
    supabase
      .from("schools")
      .select("id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date")
      .eq("id", id)
      .single(),
    supabase
      .from("recruiting_targets")
      .select("id, status, athletes(id, name, position)")
      .eq("school_id", id)
      .eq("org_id", org.id),
  ]);

  if (!schoolRow) notFound();
  const school = schoolRowToFitSchool(schoolRow as SchoolRow);

  const targets = (targetRows ?? []) as Array<{
    id: string;
    status: string;
    athletes: { id: string; name: string; position: string | null } | Array<{ id: string; name: string; position: string | null }> | null;
  }>;

  // Each target's score comes from loadTarget, the same call the target
  // page makes. Scoring them inline here with a second set of adapters is
  // exactly how the same target ends up at 68 on one screen and 71 on
  // another with nothing failing.
  const scored = await Promise.all(
    targets.map(async (t) => {
      const bundle = await loadTarget(org.id, t.id);
      const a = Array.isArray(t.athletes) ? t.athletes[0] : t.athletes;
      return { id: t.id, status: t.status, name: a?.name ?? "Unknown athlete", position: a?.position ?? null, fit: bundle?.fit ?? null };
    }),
  );
  scored.sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1));

  const fin = school.financials ?? {};
  const ac = school.academics ?? {};
  const at = school.athletics ?? {};
  const d3 = isD3(school.division);

  const cost = fin.outstateTotal ?? fin.instateTotal;
  const aid = d3 ? (fin.avgMeritAid ?? 0) + (fin.avgNeedAid ?? 0) : (fin.avgAthleticAid ?? 0);
  const coverage = cost && cost > 0 && aid > 0 ? Math.round((aid / cost) * 100) : null;

  const staleDays = school.profileDate
    ? Math.floor((Date.now() - new Date(school.profileDate).getTime()) / 86_400_000)
    : null;

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link href={`/org/${slug}/schools`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Schools
        </Link>
      </div>

      <h1 className="mb-1 text-[22px] font-extrabold leading-tight text-ink">{school.name}</h1>
      <p className="mb-5 text-[13.5px] font-bold text-muted">
        {school.division}
        {school.conference ? ` · ${school.conference}` : ""}
        {school.sportsSponsored.length > 0 ? ` · ${school.sportsSponsored.length} sports` : ""}
      </p>

      {/* A stale profile is the quiet failure mode of this whole record:
          every number below feeds a fit score, and a three-year-old
          tuition figure produces a confident wrong answer. */}
      {staleDays !== null && staleDays >= 90 && (
        <div className="mb-5">
          <RailCard role="offer" kind="warning">
            <div className="text-[14.5px] font-bold leading-tight text-ink">This profile is {staleDays} days old</div>
            <div className="mt-1 text-[13px] leading-relaxed text-muted">
              Every fit score against this school is built on the numbers below. Refresh them before anyone leans on one.
            </div>
          </RailCard>
        </div>
      )}

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Tile label="Avg GPA" value={ac.gpaAvg != null ? ac.gpaAvg.toFixed(2) : "None"} sub="admitted" />
        <Tile label="Min GPA" value={ac.gpaMin != null ? ac.gpaMin.toFixed(2) : "None"} sub="floor" />
        <Tile
          label="Spots"
          value={fin.rosterSpotsOpen != null ? String(fin.rosterSpotsOpen) : "None"}
          sub={fin.rosterSpotsOpen != null ? "reported open" : "not reported"}
        />
      </div>

      {(ac.satRange || ac.actRange) && (
        <div className="mb-5">
          <RailCard role="contact" kind="course">
            <div className="text-[13.5px] leading-relaxed text-ink">
              {ac.satRange ? `SAT ${ac.satRange}` : ""}
              {ac.satRange && ac.actRange ? " · " : ""}
              {ac.actRange ? `ACT ${ac.actRange}` : ""}
            </div>
            <div className="mt-0.5 text-[13px] leading-relaxed text-muted">
              The middle 50% of admitted students. Above the top number is a real advantage; below the bottom one is a real headwind.
            </div>
          </RailCard>
        </div>
      )}

      <div className="mb-2">
        <SectionHeader label="Money" role="committed" kind="money" />
      </div>
      <div className="flex flex-col gap-2">
        {/* The D3 rule, enforced on the screen as well as in the engine.
            A D3 school cannot offer athletic aid whatever the record
            says, and printing the field would tell a family money exists
            that does not. */}
        <RailCard role={d3 ? "place" : "committed"} kind="money">
          <div className="text-[14.5px] font-bold leading-tight text-ink">
            {d3 ? "No athletic scholarships at D3" : (AID_LABEL[fin.athleticScholarship ?? ""] ?? "Athletic aid not recorded")}
          </div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-muted">
            {d3
              ? "NCAA rules, not this school's choice. Academic and need-based aid still apply and are often substantial."
              : "From this school's profile. Confirm with the coaching staff before a family plans around it."}
          </div>
        </RailCard>

        {aid > 0 && (
          <RailCard role="committed" kind="grant">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14.5px] font-bold leading-tight text-ink">{d3 ? "Average academic and need aid" : "Average athletic award"}</div>
                {coverage !== null && (
                  <div className="mt-0.5 text-[13px] leading-relaxed text-muted">Covers about {coverage}% of the cost of attendance.</div>
                )}
              </div>
              <span className="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">{money(aid)}</span>
            </div>
          </RailCard>
        )}

        {fin.instateTotal != null && (
          <RailCard role="contact" kind="school">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[14.5px] font-bold leading-tight text-ink">In state</div>
              <span className="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">{money(fin.instateTotal)}</span>
            </div>
          </RailCard>
        )}
        {fin.outstateTotal != null && (
          <RailCard role="contact" kind="school">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[14.5px] font-bold leading-tight text-ink">Out of state</div>
              <span className="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">{money(fin.outstateTotal)}</span>
            </div>
          </RailCard>
        )}
        {fin.instateTotal == null && fin.outstateTotal == null && (
          <RailCard role="target">
            <div className="text-[13.5px] leading-relaxed text-ink">
              No cost of attendance on file, so the financial dimension of every fit score here is running on defaults.
            </div>
          </RailCard>
        )}
      </div>

      {(at.positionDepth || at.playingTimeOutlook) && (
        <>
          <div className="mb-2 mt-5">
            <SectionHeader label="Depth chart" role="visit" kind="athlete" />
          </div>
          <RailCard role="visit" kind="athlete">
            {at.playingTimeOutlook && (
              <div className="text-[14.5px] font-bold leading-tight text-ink">{OUTLOOK_LABEL[at.playingTimeOutlook] ?? at.playingTimeOutlook}</div>
            )}
            {at.positionDepth && <div className="mt-1 text-[13.5px] leading-relaxed text-ink">{at.positionDepth}</div>}
          </RailCard>
        </>
      )}

      {/* Conflicts are on the record for a reason and belong on the
          school, not buried inside one athlete's score. */}
      {school.conflicts && school.conflicts.length > 0 && (
        <>
          <div className="mb-2 mt-5">
            <SectionHeader label="Flags on this school" count={school.conflicts.length} role="offer" kind="warning" />
          </div>
          <div className="flex flex-col gap-2">
            {school.conflicts.map((c, i) => (
              <RailCard key={i} role={c.severity === "conflict" ? "offer" : "contact"} kind={c.severity === "conflict" ? "blocked" : "warning"}>
                <div className="text-[13.5px] leading-relaxed text-ink">{c.message}</div>
              </RailCard>
            ))}
          </div>
        </>
      )}

      <div className="mb-2 mt-5">
        <SectionHeader label="Your athletes here" count={scored.length} role="contact" kind="athlete" />
      </div>
      {scored.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="athlete" role="neutral" className="h-7 w-7" />} title="Nobody here yet">
          No athlete on your roster is targeting this school. Adding one from their profile puts it on the board with a fit score.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {scored.map((t) => (
            <Link key={t.id} href={`/org/${slug}/board/${t.id}`} className="block">
              <RailCard role={statusRole(t.status)} kind="athlete">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold leading-tight text-ink">{t.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] leading-tight text-muted">
                      {t.position && <span>{t.position}</span>}
                      <StatusPill status={t.status} />
                    </div>
                  </div>
                  {t.fit && <ScorePill score={t.fit.score} />}
                </div>
              </RailCard>
            </Link>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="mt-5">
          <Link
            href={`/org/${slug}/schools`}
            className="flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[15px] font-bold text-ink"
          >
            All schools
          </Link>
        </div>
      )}
    </main>
  );
}
