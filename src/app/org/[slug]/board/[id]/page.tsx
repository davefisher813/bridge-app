// One recruiting target: the school, the athlete, the fit score and what
// it is made of.
//
// This did not exist. Tapping a row on the board went straight to the
// edit form, so the only way to see why a school scored 68 was to open a
// form full of inputs. The score is the product's opinion and it was not
// readable anywhere.
//
// The score is computed here the same way the board computes it, from
// the same adapters, rather than passed through or stored. A stored
// score goes stale the moment a GPA or a school profile changes.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import {
  athleteRowToFitAthlete,
  communicationsToSignals,
  schoolRowToFitSchool,
  targetOfferToSignal,
  transferWindowRowToFit,
  visitsToVisitCount,
  type AthleteRow,
  type SchoolRow,
  type TransferWindowRow,
} from "@/lib/data/fitAdapters";
import { scoreFit } from "@/lib/fit/score";
import type { DimensionResult } from "@/lib/fit/types";
import { RailCard, SectionHeader, ScorePill } from "@/components/catalog";
import type { RowKind } from "@/components/RowGlyph";

export const dynamic = "force-dynamic";

function unwrap<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// Which glyph each dimension wears. Four identical rows tell you nothing
// about which one is about grades and which is about money.
const DIM: Array<{ key: "academic" | "athletic" | "financial" | "eligibility"; label: string; kind: RowKind }> = [
  { key: "academic", label: "Academic", kind: "course" },
  { key: "athletic", label: "Athletic", kind: "target" },
  { key: "financial", label: "Financial", kind: "money" },
  { key: "eligibility", label: "Eligibility", kind: "checklist" },
];

export default async function TargetPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();

  const [{ data: target }, { data: windowRows }, { data: commRows }, { data: visitRows }] = await Promise.all([
    supabase
      .from("recruiting_targets")
      .select(
        "id, status, coach_name, offer_type, offer_scholarship_percent, athletes(id, org_id, recruit_type, name, sport, position, gpa, gpa_verified, detail, measurables, is_international, toefl_score, ielts_score, f1_visa_status, ncaa_eligibility_status), schools(id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date)",
      )
      .eq("id", id)
      .eq("org_id", org.id)
      .single(),
    supabase.from("transfer_windows").select("sport, division, season_year, window_label, opens_on, closes_on"),
    supabase.from("target_communications").select("target_id, kind, notes, occurred_at").eq("target_id", id).eq("org_id", org.id).order("occurred_at", { ascending: false }),
    supabase.from("target_visits").select("target_id, visit_type, impression, occurred_at").eq("target_id", id).eq("org_id", org.id).order("occurred_at", { ascending: false }),
  ]);

  if (!target) notFound();

  const athleteRow = unwrap((target as { athletes: AthleteRow | AthleteRow[] | null }).athletes);
  const schoolRow = unwrap((target as { schools: SchoolRow | SchoolRow[] | null }).schools);
  if (!athleteRow || !schoolRow) notFound();

  const athlete = athleteRowToFitAthlete(athleteRow);
  const school = schoolRowToFitSchool(schoolRow);
  const comms = (commRows ?? []) as Array<{ target_id: string; kind: string; notes: string | null; occurred_at: string | null }>;
  const visits = (visitRows ?? []) as Array<{ target_id: string; visit_type: string; impression: string | null; occurred_at: string | null }>;

  const fit = scoreFit(athlete, school, {
    isPlaced: (target as { status: string }).status === "Committed",
    transferWindows: ((windowRows ?? []) as TransferWindowRow[]).map(transferWindowRowToFit),
    signals: {
      ...communicationsToSignals(comms.map((c) => ({ target_id: c.target_id, kind: c.kind }))),
      visitCount: visitsToVisitCount(visits.map((v) => ({ target_id: v.target_id }))),
      offer: targetOfferToSignal(target as { offer_type: string | null; offer_scholarship_percent: number | null }),
    },
  });

  const status = (target as { status: string }).status;
  const coachName = (target as { coach_name: string | null }).coach_name;

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link href={`/org/${slug}/board`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Board
        </Link>
      </div>

      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold leading-tight text-ink">
            <Link href={`/org/${slug}/schools/${school.id}`}>{school.name}</Link>
          </h1>
          <div className="text-[13.5px] font-bold text-muted">
            {school.division} &middot; {athlete.name}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="text-[28px] font-black leading-none tabular-nums text-ink">{fit.score}</div>
          <div className="mt-1 text-[12.5px] font-bold text-muted">{fit.tag}</div>
        </div>
      </div>

      {/* The headline reason, before the breakdown. A score with no
          sentence attached is a number somebody has to take on faith. */}
      {fit.reasons.length > 0 && (
        <div className="mb-5">
          <RailCard role="contact" kind="info">
            <div className="text-[13.5px] leading-relaxed text-ink">{fit.reasons[0]}</div>
          </RailCard>
        </div>
      )}

      <div className="mb-2">
        <SectionHeader label="How the score is built" role="contact" kind="target" />
      </div>
      <div className="mb-5 flex flex-col gap-2">
        {DIM.map(({ key, label, kind }) => {
          const d = fit[key] as DimensionResult | undefined;
          if (!d) return null;
          const role = d.veto ? "offer" : d.score >= 70 ? "committed" : d.score >= 40 ? "contact" : "target";
          // One reason shown and the rest behind a tap. The reasons ARE
          // the argument: a financial 42 is a number, and "average aid
          // covers only 18% of cost" is the sentence somebody acts on.
          const card = (
            <RailCard role={role} kind={d.veto ? "warning" : kind}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14.5px] font-bold leading-tight text-ink">{label}</div>
                  <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
                    {d.reasons[0] ?? d.warnings[0] ?? "No signal"}
                  </div>
                </div>
                <span className="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">{d.score}</span>
              </div>
              {/* A veto is not a low score, it is an override, so it says
                  so rather than being inferred from a small number. */}
              {d.veto && <div className="mt-1.5 text-[12.5px] font-semibold leading-tight text-tint-accent-on">Overrides the blend: {d.veto}</div>}
              {(d.reasons.length > 1 || d.warnings.length > 0) && (
                <div className="mt-1.5 text-[12.5px] font-bold leading-tight text-muted">
                  {d.reasons.length + d.warnings.length} {d.reasons.length + d.warnings.length === 1 ? "note" : "notes"} in full
                </div>
              )}
            </RailCard>
          );
          return (
            <Link key={key} href={`/org/${slug}/board/${id}/dimensions/${key}`} className="block">
              {card}
            </Link>
          );
        })}
      </div>

      {fit.warnings.length > 0 && (
        <>
          <div className="mb-2">
            <SectionHeader label="Worth knowing" count={fit.warnings.length} role="offer" kind="warning" />
          </div>
          <div className="mb-5 flex flex-col gap-2">
            {fit.warnings.map((w) => (
              <RailCard key={w} role="offer" kind="warning">
                <div className="text-[13.5px] leading-relaxed text-ink">{w}</div>
              </RailCard>
            ))}
          </div>
        </>
      )}

      <div className="mb-2">
        <SectionHeader label="Contact" count={comms.length + visits.length} role="people" kind="message" />
      </div>
      <div className="mb-5 flex flex-col gap-2">
        <RailCard role="people" kind="message">
          <div className="text-[14.5px] font-bold leading-tight text-ink">{coachName || "No coach on file"}</div>
          <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
            {comms.length} {comms.length === 1 ? "message" : "messages"} &middot; {visits.length} {visits.length === 1 ? "visit" : "visits"}
          </div>
        </RailCard>
        {comms.slice(0, 5).map((c, i) => (
          <RailCard key={i} role="contact" kind="message">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14.5px] font-bold leading-tight text-ink">{c.notes || c.kind}</div>
                <div className="mt-0.5 text-[12.5px] leading-tight text-muted">{c.kind}</div>
              </div>
              {c.occurred_at && <span className="flex-shrink-0 text-[12.5px] font-bold text-muted">{c.occurred_at.slice(0, 10)}</span>}
            </div>
          </RailCard>
        ))}
        {/* Five is a preview. The count is what somebody reads and the
            gap since the last one is what they act on, and neither of
            those fits in a preview. */}
        {comms.length + visits.length > 0 && (
          <Link
            href={`/org/${slug}/board/${id}/communications`}
            className="flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[15px] font-bold text-ink"
          >
            The whole log
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Link
          href={`/org/${slug}/roster/${athlete.id}`}
          className="flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[15px] font-bold text-ink"
        >
          Open {athlete.name}
        </Link>
        {canEdit && (
          <Link
            href={`/org/${slug}/board/${id}/edit`}
            className="flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[15px] font-bold text-ink"
          >
            Edit this target
          </Link>
        )}
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-muted">
        Status: {status}. The score is calculated every time this page loads, never stored, so it cannot disagree with the record it came from.
      </p>
    </main>
  );
}
