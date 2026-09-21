import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { loadFamilyAthletes, requireFamily } from "@/lib/data/family";
import { loadFitsForPairs, rowToFit } from "@/lib/data/fits";
import { StatusPill } from "@/components/StatusPill";
import { statusRole, scoreRole } from "@/components/statusHue";
import { Body, Card, EmptyState, Figure, Label, Prose, Row, Screen, Section, Stack, TextLink } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { RowKind } from "@/components/RowGlyph";
import type { DimensionResult } from "@/lib/fit/types";

export const dynamic = "force-dynamic";

// One college on the family's list: where things stand, the offer if
// there is one, the stored match score with its reasons, and the
// visits. No calls, no notes, no coach: those are staff's.

const VISIT_TYPE_LABEL: Record<string, string> = { official: "Official", unofficial: "Unofficial", junior_day: "Junior day", camp: "Camp", other: "Other" };

const DIM: Array<{ key: "academic" | "athletic" | "financial" | "eligibility"; label: string; kind: RowKind }> = [
  { key: "academic", label: "Academic", kind: "course" },
  { key: "athletic", label: "Athletic", kind: "target" },
  { key: "financial", label: "Financial", kind: "money" },
  { key: "eligibility", label: "Eligibility", kind: "checklist" },
];

interface TargetRow {
  id: string;
  status: string;
  athlete_id: string;
  school_id: string;
  offer_type: string | null;
  offer_scholarship_percent: number | null;
  schools: { id: string; name: string; division: string; conference: string | null; state: string | null } | { id: string; name: string; division: string; conference: string | null; state: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function FamilyCollegePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const athletes = await loadFamilyAthletes(org.id, user.id);
  const base = `/org/${slug}/family`;

  const supabase = await createClient();
  const { data: targetRow } = await supabase
    .from("recruiting_targets")
    .select("id, status, athlete_id, school_id, offer_type, offer_scholarship_percent, schools(id, name, division, conference, state)")
    .eq("id", id)
    .eq("org_id", org.id)
    .maybeSingle();
  const target = targetRow as TargetRow | null;
  const athlete = target ? athletes.find((a) => a.id === target.athlete_id) : undefined;
  // A target for an athlete this person is not linked to is not found,
  // the same answer the database gives.
  if (!target || !athlete) notFound();
  const school = unwrap(target.schools);
  if (!school) notFound();

  const [fits, { data: visitRows }] = await Promise.all([
    loadFitsForPairs(supabase, org.id, [{ athleteId: target.athlete_id, schoolId: target.school_id }]),
    supabase.from("target_visits").select("id, visit_type, visit_date, impression, next_step").eq("target_id", id).eq("org_id", org.id).order("visit_date", { ascending: false }),
  ]);
  const fitRow = fits.get(`${target.athlete_id}:${target.school_id}`);
  const fit = fitRow ? rowToFit(fitRow) : null;
  const visits = (visitRows ?? []) as { id: string; visit_type: string; visit_date: string | null; impression: string | null; next_step: string | null }[];

  return (
    <Screen
      title={school.name}
      back={{ href: `${base}/colleges`, label: "Colleges" }}
      lede={`${school.division} · ${athlete.name}`}
      action={
        fit ? (
          <div className="text-right">
            <Figure tone={scoreRole(fit.score)}>{fit.score}</Figure>
            <Label>{fit.tag}</Label>
          </div>
        ) : undefined
      }
    >
      <Row
        kind="school"
        role={statusRole(target.status)}
        title="Where Things Stand"
        meta={target.offer_type ? `${target.offer_type} offer${target.offer_scholarship_percent ? ` · ${target.offer_scholarship_percent}% scholarship` : ""}` : "No offer on file"}
        trailing={<StatusPill status={target.status} />}
        wrap
      />

      {fit ? (
        <Section label="How the Score Is Built" role="contact" kind="target">
          {fit.reasons.length > 0 && <Note>{fit.reasons[0]}</Note>}
          {DIM.map(({ key, label, kind }) => {
            const d = fit[key] as DimensionResult | undefined;
            if (!d) return null;
            const role = d.veto ? "offer" : d.score >= 70 ? "committed" : d.score >= 40 ? "contact" : "target";
            return (
              <Row
                key={key}
                kind={d.veto ? "warning" : kind}
                role={role}
                title={d.veto ? `${label} · sets the score by itself` : label}
                meta={d.reasons[0] ?? d.warnings[0] ?? "No signal"}
                trailing={
                  <Body weight="bold" numeric>
                    {d.score}
                  </Body>
                }
                wrap
              />
            );
          })}
          <TextLink href={`${base}/${athlete.id}/matches/${school.id}`}>Every Reason Behind the Score</TextLink>
        </Section>
      ) : (
        <Section label="Match Score" role="contact" kind="target">
          <EmptyState kind="target" title="Not Scored Yet">
            This school is scored once its profile and the athlete&apos;s numbers are on file.
          </EmptyState>
        </Section>
      )}

      <Section label="Visits" count={visits.length} role="place" kind="visit">
        {visits.length === 0 ? (
          <EmptyState kind="visit" title="No Visits Yet">
            Visits to this school are listed here once staff log them.
          </EmptyState>
        ) : (
          visits.map((v) => (
            <Card key={v.id}>
              <Stack gap={2}>
                <div className="flex items-start justify-between gap-3">
                  <Body weight="bold">{VISIT_TYPE_LABEL[v.visit_type] ?? v.visit_type}</Body>
                  <div className="flex-shrink-0">
                    <Label numeric>{longDate(v.visit_date)}</Label>
                  </div>
                </div>
                {v.impression && <Body>{v.impression}</Body>}
                {v.next_step && <Label>Next: {v.next_step}</Label>}
              </Stack>
            </Card>
          ))
        )}
      </Section>

      <Prose>Staff keep this record. Ask {org.name} about anything here.</Prose>
    </Screen>
  );
}
