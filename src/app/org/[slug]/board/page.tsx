import { notFound } from "next/navigation";
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
import { loadFitsForPairs, rowToFit } from "@/lib/data/fits";
import type { FitTag } from "@/lib/fit/types";
import { AddButton, EmptyState, Label, LinkButton, Row, Score, Screen, Section } from "@/components/kit";
import { stageKind, statusRole } from "@/components/statusHue";

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

// The score above this tag already says how good the fit is, so the
// tag is low-weight text rather than a third colour-coded thing. Red is
// deliberately absent: it belongs to actions now, not to a rating.
const TAG_TONE: Record<FitTag, "committed" | "ink" | "muted" | "danger"> = {
  Safety: "committed",
  Fit: "ink",
  Reach: "muted",
  Conflict: "danger",
  Unknown: "muted",
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

  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();

  const [{ data: targets }, { data: commRows }, { data: visitRows }] = await Promise.all([
    supabase
      .from("recruiting_targets")
      .select(
        "id, status, coach_name, offer_type, offer_scholarship_percent, athletes(id, org_id, recruit_type, name, sport, position, gpa, gpa_verified, detail, measurables, is_international, toefl_score, ielts_score, f1_visa_status, ncaa_eligibility_status), schools(id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date)"
      )
      .eq("org_id", org.id)
      .order("created_at", { ascending: false }),
    supabase.from("target_communications").select("target_id, kind").eq("org_id", org.id),
    supabase.from("target_visits").select("target_id").eq("org_id", org.id),
  ]);

  // Stored fits, one read for the whole board. docs/MATCHING_CONTRACT.md:
  // a screen reads rows, it never scores.
  const targetRows = (targets ?? []) as TargetRow[];
  const fits = await loadFitsForPairs(
    supabase,
    org.id,
    targetRows.map((t) => ({ athleteId: unwrap(t.athletes)?.id ?? "", schoolId: unwrap(t.schools)?.id ?? "" })),
  );

  // One batched query for every target's log, grouped in memory, rather
  // than a query per row. The counts are chips on the row, never part of
  // the score.
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

  const rows = targetRows
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
      const stored = fits.get(`${athlete.id}:${school.id}`);
      const fit = stored ? { ...rowToFit(stored), signals } : null;

      return { id: t.id, status: t.status, coachName: t.coach_name, athleteName: athlete.name, athleteSport: athlete.sport, schoolName: school.name, schoolDivision: school.division, fit };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const grouped: { status: string; rows: typeof rows }[] = STATUS_ORDER.map((status) => ({ status, rows: rows.filter((r) => r.status === status) })).filter(
    (g) => g.rows.length > 0
  );

  const unknownStatusRows = rows.filter((r) => !(STATUS_ORDER as readonly string[]).includes(r.status));
  if (unknownStatusRows.length > 0) grouped.push({ status: "Other", rows: unknownStatusRows });

  return (
    <Screen title="Targets" action={canEdit ? <AddButton href={`/org/${slug}/board/new`} label="Add" /> : undefined}>
      {rows.length === 0 ? (
        <>
          <EmptyState kind="target" title="No Recruiting Targets Yet" action={canEdit && <LinkButton href={`/org/${slug}/board/new`}>Add the First Target</LinkButton>}>
            {canEdit ? "A target is one athlete pointed at one school." : "Ask an owner or coordinator to add one."}
          </EmptyState>
        </>
      ) : (
        grouped.map((group) => (
          <Section key={group.status} label={group.status} count={group.rows.length} role={statusRole(group.status)} kind={stageKind(group.status)}>
            {/* Every row opens the read view, whatever the role. It used
                to link to the edit form and only for staff, so a member
                could see a score and had no way to find out what it was
                made of. */}
            {group.rows.map((r) => (
              <Row
                key={r.id}
                href={`/org/${slug}/board/${r.id}`}
                kind="school"
                role={statusRole(r.status)}
                title={`${r.athleteName} to ${r.schoolName}`}
                meta={`${r.athleteSport} · ${r.schoolDivision}${r.coachName ? ` · ${r.coachName}` : ""}`}
                trailing={
                  r.fit ? (
                    <>
                      <Score score={r.fit.score} />
                      <Label tone={TAG_TONE[r.fit.tag]}>{r.fit.tag}</Label>
                    </>
                  ) : (
                    <Label>Not Scored Yet</Label>
                  )
                }
              />
            ))}
          </Section>
        ))
      )}
    </Screen>
  );
}
