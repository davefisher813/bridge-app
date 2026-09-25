import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { JourneyStepper } from "@/components/JourneyStepper";
import { deriveJourneyStage } from "@/lib/journey";
import { Card, Chevron, EmptyState, Label, Notice, Row, Score, Screen, Section, Stack, Stat, StatRow, TextLink } from "@/components/kit";
import { metricRowsToEntries, type MetricRow } from "@/lib/data/fitAdapters";
import { loadFitsForAthlete } from "@/lib/data/fits";
import { formatMetricValue, metricsFor, positionGroupOf, selectScoringMetrics } from "@/lib/fit";
import { GOAL_LABEL, type AthleteGoal } from "@/lib/fit/contract";
import type { FitTag } from "@/lib/fit/types";

// One athlete, as their family sees them: the same record staff keep,
// read only, with nothing from the rest of the org on it. Dave's picks
// in the Family Access catalog (2026-09-21): this page is home, every
// match shows its reasons, their own documents are listed, nothing is
// editable, and staff are who to ask.

const TAG_TONE: Record<FitTag, "committed" | "ink" | "muted" | "danger"> = {
  Safety: "committed",
  Fit: "ink",
  Reach: "muted",
  Conflict: "danger",
  Unknown: "muted",
};

const RECRUIT_TYPE_LABEL: Record<string, string> = {
  hs: "High School",
  transfer_4to4: "Transfer (4-to-4)",
  transfer_juco: "Transfer (JUCO)",
  transfer_grad: "Transfer (Grad)",
};

const CATEGORY_LABEL: Record<string, string> = {
  transcript: "Transcript",
  test_scores: "Test Scores",
  offer_letter: "Offer Letter",
  recommendation: "Recommendation",
  financial_aid: "Financial Aid",
  metrics: "Metrics Report",
  film: "Film",
};

// A document's status, in a family's words. The pipeline's own words
// (route, failure stage) are staff's business.
const DOC_STATUS: Record<string, string> = {
  applied: "On the record",
  pending: "Being checked by staff",
  processing: "Being read",
  failed: "Could not be read",
  discarded: "Set aside by staff",
};

interface TargetRow {
  id: string;
  status: string;
  schools: { name: string } | { name: string }[] | null;
}

interface DocRow {
  id: string;
  file_name: string;
  category: string | null;
  status: string;
  created_at: string;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function money(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

export default async function FamilyAthletePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const { all } = await requireFamilyAthlete(org.id, user.id, id);
  const base = `/org/${slug}/family`;
  const here = `${base}/${id}`;

  const supabase = await createClient();
  const [{ data: athlete }, { data: targetRows }, { data: metricRows }, { data: docRows }, fits] = await Promise.all([
    supabase.from("athletes").select("id, name, sport, position, recruit_type, gpa, goal, family_budget_cents, home_state").eq("id", id).eq("org_id", org.id).is("deleted_at", null).single(),
    supabase.from("recruiting_targets").select("id, status, schools(name)").eq("athlete_id", id).eq("org_id", org.id).order("created_at", { ascending: false }),
    supabase.from("athlete_metrics").select("id, metric, value, measured_on, source").eq("athlete_id", id).eq("org_id", org.id).order("measured_on", { ascending: false }),
    supabase.from("documents").select("id, file_name, category, status, created_at").eq("athlete_id", id).eq("org_id", org.id).order("created_at", { ascending: false }),
    loadFitsForAthlete(supabase, org.id, id),
  ]);
  if (!athlete) notFound();

  const metrics = (metricRows ?? []) as MetricRow[];
  const scoring = selectScoringMetrics(metricRowsToEntries(metrics));
  const group = positionGroupOf(athlete.sport, athlete.position ?? undefined);
  const tiles = metricsFor(athlete.sport, group).first.slice(0, 3);
  const lastLogged = metrics[0]?.measured_on;

  const targets = ((targetRows ?? []) as TargetRow[]).map((t) => ({ ...t, school: unwrap(t.schools) }));
  const journey = deriveJourneyStage(targets.map((t) => ({ status: t.status, schoolName: t.school?.name ?? "" })));
  const topFits = fits.slice(0, 5);
  const goal = GOAL_LABEL[(athlete.goal ?? "balanced") as AthleteGoal] ?? GOAL_LABEL.balanced;
  const budgetCents = athlete.family_budget_cents as number | null;
  const docs = (docRows ?? []) as DocRow[];

  return (
    <Screen
      title={athlete.name}
      back={all.length > 1 ? { href: base, label: "Your Athletes" } : undefined}
      lede={`${athlete.sport}${athlete.position ? ` · ${athlete.position}` : ""} · ${RECRUIT_TYPE_LABEL[athlete.recruit_type] ?? athlete.recruit_type}${athlete.gpa != null ? ` · ${Number(athlete.gpa).toFixed(2)} school GPA` : ""}`}
    >
      <Card href={`${base}/colleges`}>
        <JourneyStepper result={journey} />
      </Card>

      <Stack gap={3}>
        <Row href={`${here}/eligibility`} kind="checklist" role="contact" title="NCAA Eligibility" meta="Core GPA, qualifier status and the clock" trailing={<Chevron />} />
        <Row href={`${here}/transcript`} kind="course" role="contact" title="Transcript" meta="Every course, and what the NCAA counted" trailing={<Chevron />} />
      </Stack>

      {tiles.length > 0 && (
        <StatRow>
          {tiles.map((m) => (
            <Stat
              key={m.key}
              value={scoring.measurables[m.key] !== undefined ? formatMetricValue(m.key, scoring.measurables[m.key]) : "None"}
              label={m.label}
              role="contact"
              href={`${here}/metrics`}
            />
          ))}
        </StatRow>
      )}

      <Stack gap={3}>
        <Row href={`${here}/metrics`} kind="check" role="contact" title="Metrics" meta={metrics.length === 0 ? "Nothing logged yet" : `${metrics.length} logged · last on ${longDate(lastLogged)}`} trailing={<Chevron />} />
        <Row kind="flag" role="committed" title="Goal and Budget" meta={`${goal} · ${budgetCents ? `${money(budgetCents / 100)} a year` : "No family budget on file"}${athlete.home_state ? ` · ${athlete.home_state}` : ""}`} wrap />
        <Label>To change the goal or the budget, ask {org.name}.</Label>
      </Stack>

      <Section label="Matches" count={fits.length} role="place" kind="target" action={fits.length > 5 ? <TextLink href={`${here}/matches`}>See All</TextLink> : undefined}>
        {fits.length === 0 ? (
          <EmptyState kind="target" title="No Matches Yet">
            Every school on file is scored once the record is complete.
          </EmptyState>
        ) : (
          <>
            {topFits.map((f) => (
              <Row
                key={f.school_id}
                href={`${here}/matches/${f.school_id}`}
                kind="school"
                role={f.tag === "Conflict" ? "danger" : f.tag === "Safety" ? "committed" : "place"}
                title={f.school.name}
                meta={`${f.school.division} · ${f.partial ? (f.warnings[0] ?? "Partial score") : (f.reasons[0] ?? f.warnings[0] ?? "")}`}
                trailing={
                  <>
                    <Score score={f.score} />
                    <Label tone={TAG_TONE[f.tag as FitTag] ?? "muted"}>{f.tag}</Label>
                  </>
                }
              />
            ))}
            {topFits.some((f) => f.partial) && (
              <Notice tone="info" title="Some Scores Are Partial">
                A dimension with nothing on file is left out and the rest are reweighted. The score fills in once the missing numbers are logged.
              </Notice>
            )}
            <TextLink href={`${here}/matches`}>{`See All ${fits.length} Matches`}</TextLink>
          </>
        )}
      </Section>

      <Section label="Colleges" count={targets.length} role="place" kind="school">
        {targets.length === 0 ? (
          <EmptyState kind="school" title="No Colleges Yet">
            Schools being pursued show up here.
          </EmptyState>
        ) : (
          <Row href={`${base}/colleges`} kind="school" role="place" title="Where Things Stand" meta={`${targets.length} ${targets.length === 1 ? "school" : "schools"} on the list, and every visit`} trailing={<Chevron />} />
        )}
      </Section>

      <Section label="Documents" count={docs.length} role="contact" kind="document">
        {docs.length === 0 ? (
          <EmptyState kind="document" title="Nothing on File">
            A transcript or a test score is listed here once it is read.
          </EmptyState>
        ) : (
          docs.map((d) => (
            <Row
              key={d.id}
              kind="document"
              role={d.status === "applied" ? "committed" : d.status === "failed" ? "danger" : "contact"}
              title={d.category ? (CATEGORY_LABEL[d.category] ?? d.category) : "Document"}
              meta={`${d.file_name} · ${DOC_STATUS[d.status] ?? d.status} · ${longDate(d.created_at)}`}
              wrap
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
