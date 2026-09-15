import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { athleteRowToFitAthlete, schoolRowToFitSchool, transferWindowRowToFit, type AthleteRow, type SchoolRow, type TransferWindowRow } from "@/lib/data/fitAdapters";
import { scoreFit } from "@/lib/fit/score";
import type { FitTag } from "@/lib/fit/types";

interface TargetRow {
  id: string;
  status: string;
  coach_name: string | null;
  athletes: AthleteRow | AthleteRow[] | null;
  schools: SchoolRow | SchoolRow[] | null;
}

// Fixed display order, not alphabetical: this is the pipeline a target
// actually moves through. Not Interested sits last since it's the one
// state that isn't forward progress.
const STATUS_ORDER = ["Target", "In Contact", "Visit", "Offer", "Committed", "Not Interested"] as const;

const TAG_STYLE: Record<FitTag, string> = {
  Safety: "text-success",
  Fit: "text-accent",
  Reach: "text-ink",
  Conflict: "text-danger",
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

  const [{ data: targets }, { data: windowRows }] = await Promise.all([
    supabase
      .from("recruiting_targets")
      .select(
        "id, status, coach_name, athletes(id, org_id, recruit_type, name, sport, position, gpa, gpa_verified, detail, measurables, is_international, toefl_score, ielts_score, f1_visa_status, ncaa_eligibility_status), schools(id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date)"
      )
      .eq("org_id", org.id)
      .order("created_at", { ascending: false }),
    supabase.from("transfer_windows").select("sport, division, season_year, window_label, opens_on, closes_on"),
  ]);

  const transferWindows = ((windowRows ?? []) as TransferWindowRow[]).map(transferWindowRowToFit);

  const rows = ((targets ?? []) as TargetRow[])
    .map((t) => {
      const athleteRow = unwrap(t.athletes);
      const schoolRow = unwrap(t.schools);
      if (!athleteRow || !schoolRow) return null;

      const athlete = athleteRowToFitAthlete(athleteRow);
      const school = schoolRowToFitSchool(schoolRow);
      const fit = scoreFit(athlete, school, { isPlaced: t.status === "Committed", transferWindows });

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
            <Link href={`/org/${slug}/board/new`} className="text-[12px] font-bold text-accent">
              + Add target
            </Link>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-[14px] border border-line bg-paper px-4 py-8 text-center">
            <div className="text-[14px] font-semibold text-ink">No recruiting targets yet</div>
            {canEdit ? (
              <Link href={`/org/${slug}/board/new`} className="mt-2 inline-block text-[13px] font-bold text-accent">
                Add the first target &rarr;
              </Link>
            ) : (
              <p className="mt-1 text-[13px] text-muted">Ask an owner or coordinator to add one.</p>
            )}
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.status} className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[13px] font-bold uppercase tracking-[0.04em] text-muted">{group.status}</div>
                <div className="text-[12px] text-muted">{group.rows.length}</div>
              </div>
              <div className="divide-y divide-line border-y border-line">
                {group.rows.map((r) => {
                  const row = (
                    <div className="flex items-center justify-between py-3">
                      <div>
                        <div className="text-[15px] font-semibold text-ink">
                          {r.athleteName} <span className="font-normal text-muted">to</span> {r.schoolName}
                        </div>
                        <div className="text-[12px] text-muted">
                          {r.athleteSport} · {r.schoolDivision}
                          {r.coachName ? ` · ${r.coachName}` : ""}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[13px] font-bold tabular-nums ${TAG_STYLE[r.fit.tag]}`}>{r.fit.tag}</div>
                        <div className="text-[11px] text-muted">{r.fit.score}</div>
                      </div>
                    </div>
                  );
                  return canEdit ? (
                    <Link key={r.id} href={`/org/${slug}/board/${r.id}/edit`} className="block">
                      {row}
                    </Link>
                  ) : (
                    <div key={r.id}>{row}</div>
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
