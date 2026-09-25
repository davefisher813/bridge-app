import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { loadFamilyAthletes, requireFamily } from "@/lib/data/family";
import { loadFitsForPairs } from "@/lib/data/fits";
import { StatusPill } from "@/components/StatusPill";
import { statusRole } from "@/components/statusHue";
import { Body, Card, EmptyState, Label, Prose, Row, Score, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

// Colleges, as a family sees them: each school on the list with where
// things stand and its match score, then every visit. Dave's picks
// (2026-09-21): status and score, plus visits; not the calls, notes or
// the coach's contact, which stay with staff.

const VISIT_TYPE_LABEL: Record<string, string> = { official: "Official", unofficial: "Unofficial", junior_day: "Junior day", camp: "Camp", other: "Other" };

interface TargetRow {
  id: string;
  status: string;
  athlete_id: string;
  school_id: string;
  offer_type: string | null;
  offer_scholarship_percent: number | null;
  schools: { id: string; name: string; division: string } | { id: string; name: string; division: string }[] | null;
}

interface VisitRow {
  id: string;
  target_id: string;
  visit_type: string;
  visit_date: string | null;
  impression: string | null;
  next_step: string | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function FamilyCollegesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const athletes = await loadFamilyAthletes(org.id, user.id);
  const base = `/org/${slug}/family`;
  const athleteIds = athletes.map((a) => a.id);

  const supabase = await createClient();
  const { data: targetRows } = athleteIds.length
    ? await supabase
        .from("recruiting_targets")
        .select("id, status, athlete_id, school_id, offer_type, offer_scholarship_percent, schools(id, name, division)")
        .in("athlete_id", athleteIds)
        .eq("org_id", org.id)
        .order("created_at", { ascending: false })
    : { data: [] };
  const targets = ((targetRows ?? []) as TargetRow[]).map((t) => ({ ...t, school: unwrap(t.schools) }));
  const targetIds = targets.map((t) => t.id);

  const [fits, { data: visitRows }] = await Promise.all([
    loadFitsForPairs(
      supabase,
      org.id,
      targets.map((t) => ({ athleteId: t.athlete_id, schoolId: t.school_id })),
    ),
    targetIds.length
      ? supabase.from("target_visits").select("id, target_id, visit_type, visit_date, impression, next_step").in("target_id", targetIds).eq("org_id", org.id).order("visit_date", { ascending: false })
      : Promise.resolve({ data: [] as VisitRow[] }),
  ]);
  const visits = (visitRows ?? []) as VisitRow[];
  const targetById = new Map(targets.map((t) => [t.id, t]));
  const athleteName = new Map(athletes.map((a) => [a.id, a.name]));

  const targetRow = (t: (typeof targets)[number]) => {
    const fit = fits.get(`${t.athlete_id}:${t.school_id}`);
    return (
      <Row
        key={t.id}
        href={`${base}/colleges/${t.id}`}
        kind="school"
        role={statusRole(t.status)}
        title={t.school?.name ?? "Unknown school"}
        meta={`${t.school?.division ?? ""}${t.offer_type ? ` · ${t.offer_type} offer${t.offer_scholarship_percent ? ` (${t.offer_scholarship_percent}%)` : ""}` : ""}`}
        trailing={
          <>
            <StatusPill status={t.status} />
            {fit && <Score score={fit.score} />}
          </>
        }
      />
    );
  };

  return (
    <Screen title="Colleges" lede={athletes.length === 1 ? athletes[0]!.name : `${athletes.length} athletes`}>
      {targets.length === 0 ? (
        <EmptyState kind="school" title="No Colleges Yet">
          Schools being pursued show up here, with every visit.
        </EmptyState>
      ) : athletes.length > 1 ? (
        athletes.map((a) => {
          const mine = targets.filter((t) => t.athlete_id === a.id);
          if (mine.length === 0) return null;
          return (
            <Section key={a.id} label={a.name} count={mine.length} role="place" kind="school">
              {mine.map(targetRow)}
            </Section>
          );
        })
      ) : (
        <Section label="On the List" count={targets.length} role="place" kind="school">
          {targets.map(targetRow)}
        </Section>
      )}

      <Section label="Visits" count={visits.length} role="place" kind="visit">
        {visits.length === 0 ? (
          <EmptyState kind="visit" title="No Visits Yet">
            Listed here once staff log them.
          </EmptyState>
        ) : (
          visits.map((v) => {
            const t = targetById.get(v.target_id);
            return (
              <Card key={v.id} href={t ? `${base}/colleges/${t.id}` : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <Body weight="bold">
                    {t?.school?.name ?? "Unknown school"} · {VISIT_TYPE_LABEL[v.visit_type] ?? v.visit_type}
                  </Body>
                  <div className="flex-shrink-0">
                    <Label numeric>{longDate(v.visit_date)}</Label>
                  </div>
                </div>
                {athletes.length > 1 && t && <Label>{athleteName.get(t.athlete_id)}</Label>}
                {v.impression && <Body>{v.impression}</Body>}
                {v.next_step && <Label>Next: {v.next_step}</Label>}
              </Card>
            );
          })
        )}
      </Section>

      <Prose>Staff keep this list. To add a school or log a visit, ask {org.name}.</Prose>
    </Screen>
  );
}
