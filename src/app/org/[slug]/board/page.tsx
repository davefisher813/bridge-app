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
import type { FitTag } from "@/lib/fit/types";
import { EmptyState, GroupTab, RailCard, ScorePill } from "@/components/catalog";
import { stageKind, statusRole } from "@/components/statusHue";

function BoardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

interface TargetRow {
  id: string;
  status: string;
  coach_name: string | null;
  offer_type: string | null;
  offer_scholarship_percent: number | null;
  athletes: AthleteRow | AthleteRow[] | null;
  schools: SchoolRow | SchoolRow[] | null;
}

// Fixed display order, not alphabetical: this is the pipeline a target
// actually moves through. Not Interested sits last since it's the one
// state that isn't forward progress.
const STATUS_ORDER = ["Target", "In Contact", "Visit", "Offer", "Committed", "Not Interested"] as const;

// The score pill above this tag already says how good the fit is, so the
// tag is low-weight text rather than a third colour-coded thing. Red is
// deliberately absent: it belongs to actions now, not to a rating.
const TAG_STYLE: Record<FitTag, string> = {
  Safety: "text-ios-green",
  Fit: "text-ink",
  Reach: "text-muted",
  Conflict: "text-ios-pink",
  Unknown: "text-muted",
};

function unwrap<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// The recruiting board: every school an org is pursuing for every
// athlete, grouped by status, with a fit tag computed live from
// src/lib/fit/ rather than stored - a school's profile or an athlete's
// GPA can change after the target was created, and the tag should never
// go stale the way Bridge's original stored-tag approach could.
export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();

  const [{ data: targets }, { data: windowRows }, { data: commRows }, { data: visitRows }] = await Promise.all([
    supabase
      .from("recruiting_targets")
      .select(
        "id, status, coach_name, offer_type, offer_scholarship_percent, athletes(id, org_id, recruit_type, name, sport, position, gpa, gpa_verified, detail, measurables, is_international, toefl_score, ielts_score, f1_visa_status, ncaa_eligibility_status), schools(id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date)"
      )
      .eq("org_id", org.id)
      .order("created_at", { ascending: false }),
    supabase.from("transfer_windows").select("sport, division, season_year, window_label, opens_on, closes_on"),
    supabase.from("target_communications").select("target_id, kind").eq("org_id", org.id),
    supabase.from("target_visits").select("target_id").eq("org_id", org.id),
  ]);

  const transferWindows = ((windowRows ?? []) as TransferWindowRow[]).map(transferWindowRowToFit);

  // One batched query for every target's log, grouped in memory, rather
  // than a query per row - the fit tag/score is already computed live on
  // every page load, so the communication signal that feeds it should be
  // too, not stored or cached alongside it.
  const commsByTarget = new Map<string, { target_id: string; kind: string }[]>();
  for (const row of commRows ?? []) {
    const list = commsByTarget.get(row.target_id) ?? [];
    list.push(row);
    commsByTarget.set(row.target_id, list);
  }

  const visitsByTarget = new Map<string, { target_id: string }[]>();
  for (const row of visitRows ?? []) {
    const list = visitsByTarget.get(row.target_id) ?? [];
    list.push(row);
    visitsByTarget.set(row.target_id, list);
  }

  const rows = ((targets ?? []) as TargetRow[])
    .map((t) => {
      const athleteRow = unwrap(t.athletes);
      const schoolRow = unwrap(t.schools);
      if (!athleteRow || !schoolRow) return null;

      const athlete = athleteRowToFitAthlete(athleteRow);
      const school = schoolRowToFitSchool(schoolRow);
      const signals = {
        ...communicationsToSignals(commsByTarget.get(t.id) ?? []),
        visitCount: visitsToVisitCount(visitsByTarget.get(t.id) ?? []),
        offer: targetOfferToSignal(t),
      };
      const fit = scoreFit(athlete, school, { isPlaced: t.status === "Committed", transferWindows, signals });

      return { id: t.id, status: t.status, coachName: t.coach_name, athleteName: athlete.name, athleteSport: athlete.sport, schoolName: school.name, schoolDivision: school.division, fit };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const grouped: { status: string; rows: typeof rows }[] = STATUS_ORDER.map((status) => ({ status, rows: rows.filter((r) => r.status === status) })).filter(
    (g) => g.rows.length > 0
  );

  const unknownStatusRows = rows.filter((r) => !(STATUS_ORDER as readonly string[]).includes(r.status));
  if (unknownStatusRows.length > 0) grouped.push({ status: "Other", rows: unknownStatusRows });

  return (
    <main>
      <div className="px-4 pt-4">
        <div className="mb-2 flex items-center justify-end">
          {canEdit && (
            <Link href={`/org/${slug}/board/new`} className="text-[13px] font-bold text-accent">
              + Add target
            </Link>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<BoardIcon />} title="No recruiting targets yet">
            {canEdit ? (
              <Link href={`/org/${slug}/board/new`} className="font-bold text-accent">
                Add the first target &rarr;
              </Link>
            ) : (
              "Ask an owner or coordinator to add one."
            )}
          </EmptyState>
        ) : (
          grouped.map((group) => (
            <div key={group.status} className="mb-6">
              {/* G3: a tinted pill tab, not a solid one, since the rows
                  below carry the same hue at full saturation. */}
              <div className="mb-2">
                <GroupTab label={group.status} count={group.rows.length} role={statusRole(group.status)} kind={stageKind(group.status)} />
              </div>
              <div className="flex flex-col gap-2">
                {group.rows.map((r) => {
                  const row = (
                    <RailCard role={statusRole(r.status)} kind="school">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[16px] font-semibold text-ink">
                            {r.athleteName} <span className="font-normal text-muted">to</span> {r.schoolName}
                          </div>
                          <div className="text-[13px] text-muted">
                            {r.athleteSport} · {r.schoolDivision}
                            {r.coachName ? ` · ${r.coachName}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 flex-col items-end gap-1">
                          <ScorePill score={r.fit.score} />
                          <div className={`text-[12px] font-bold ${TAG_STYLE[r.fit.tag]}`}>{r.fit.tag}</div>
                        </div>
                      </div>
                    </RailCard>
                  );
                  // Every row opens the read view now, whatever the
                  // role. It used to link to the edit form and only for
                  // staff, so a member could see a score on the board
                  // and had no way to find out what it was made of.
                  return (
                    <Link key={r.id} href={`/org/${slug}/board/${r.id}`} className="block">
                      {row}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
