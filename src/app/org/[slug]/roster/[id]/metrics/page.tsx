// The metrics log for one athlete. docs/MATCHING_CONTRACT.md section 1:
// a dated log with value, date and where it was measured; the current
// number per metric with a sparkline of the log; the entry that scores
// is marked, since "best verified, else most recent" is not always the
// newest or the biggest number.

import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { athleteHome, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { assertMayViewAthlete } from "@/lib/data/family";
import { createClient } from "@/lib/supabase/server";
import { createMetric, deleteMetric } from "@/lib/actions/metrics";
import { MetricForm } from "@/components/MetricForm";
import { metricRowsToEntries, type MetricRow } from "@/lib/data/fitAdapters";
import { formatMetricValue, metricsFor, positionGroupOf, selectScoringMetrics } from "@/lib/fit";
import { METRICS, metricSpec, sourceSpec } from "@/lib/fit/contract";
import { Body, Card, ConfirmButton, EmptyState, Form, Label, Notice, Screen, Section, Sparkline, Stack } from "@/components/kit";

export const dynamic = "force-dynamic";

interface LogRow extends MetricRow {
  source_detail: string | null;
}

export default async function MetricsPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "family"]);
  await assertMayViewAthlete(org.id, user, id);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: athlete }, { data: metricRows }] = await Promise.all([
    supabase.from("athletes").select("id, name, sport, position").eq("id", id).eq("org_id", org.id).is("deleted_at", null).single(),
    supabase.from("athlete_metrics").select("id, metric, value, measured_on, source, source_detail").eq("athlete_id", id).eq("org_id", org.id).order("measured_on", { ascending: false }),
  ]);
  if (!athlete) notFound();

  const rows = (metricRows ?? []) as LogRow[];
  const scoring = selectScoringMetrics(metricRowsToEntries(rows));
  const group = positionGroupOf(athlete.sport, athlete.position ?? undefined);
  const { first, more } = metricsFor(athlete.sport, group);

  // Current numbers in the contract's order: the position's metrics
  // first, then the rest, and only the ones with an entry.
  const order = [...first, ...more].map((m) => m.key);
  const current = order
    .filter((key) => scoring.measurables[key] !== undefined)
    .map((key) => {
      const spec = metricSpec(key);
      const entries = rows.filter((r) => r.metric === key).slice().reverse();
      const scoredId = scoring.scoredEntryId[key];
      const scored = entries.find((e) => e.id === scoredId);
      const recent = entries.slice(-12);
      return {
        key,
        label: spec?.label ?? key,
        value: formatMetricValue(key, scoring.measurables[key]),
        lowerIsBetter: spec?.lowerIsBetter ?? false,
        values: recent.map((e) => Number(e.value)),
        mark: recent.findIndex((e) => e.id === scoredId),
        count: entries.length,
        meta: scored ? `${sourceSpec(scored.source).label} · ${longDate(scored.measured_on)}` : undefined,
      };
    });

  const createAction = createMetric.bind(null, slug, id);
  const deleteAction = deleteMetric.bind(null, slug, id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Screen
      title="Metrics"
      back={{ href: athleteHome(slug, id, user.role), label: athlete.name }}
      lede={`${athlete.sport}${athlete.position ? ` · ${athlete.position}` : ""} · ${rows.length} ${rows.length === 1 ? "entry" : "entries"} logged`}
    >
      {!group && (
        <Notice tone="info" title="Position Not Set">
          Set a position on the athlete and the metrics that score for it come first here.
        </Notice>
      )}

      <Section label="Current" count={current.length} role="contact" kind="check">
        {current.length === 0 ? (
          <EmptyState kind="check" title="Nothing Logged Yet">
            {canEdit ? "Log the first number below. The best verified one scores." : "Staff log numbers here. The best verified one scores."}
          </EmptyState>
        ) : (
          current.map((c) => (
            <Card key={c.key}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Body weight="bold">{c.label}</Body>
                  {c.meta && <Label>{`Scores · ${c.meta}`}</Label>}
                  <Label>{`${c.count} ${c.count === 1 ? "entry" : "entries"}`}</Label>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <Body weight="bold" numeric>
                    {c.value}
                  </Body>
                  <Sparkline values={c.values} lowerIsBetter={c.lowerIsBetter} mark={c.mark} />
                </div>
              </div>
            </Card>
          ))
        )}
      </Section>

      {canEdit && (
        <Section label="Log a Metric" role="accent" kind="note">
          <MetricForm action={createAction} first={first} more={more} today={today} />
        </Section>
      )}

      <Section label="Log" count={rows.length} role="time" kind="clock">
        {rows.length === 0 ? (
          <EmptyState kind="clock" title="No Entries Yet">
            Every number logged shows here, newest first.{canEdit ? " Log one above." : ""}
          </EmptyState>
        ) : (
          rows.map((r) => {
            const scores = scoring.scoredEntryId[r.metric] === r.id;
            const label = metricSpec(r.metric)?.label ?? r.metric;
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Body weight="bold" numeric>
                      {`${label} ${formatMetricValue(r.metric, Number(r.value))}`}
                    </Body>
                    <Label>{[sourceSpec(r.source).label, r.source_detail, longDate(r.measured_on)].filter(Boolean).join(" · ")}</Label>
                    {scores && <Label tone="committed">Scores</Label>}
                  </div>
                  {canEdit && (
                    <Form action={deleteAction.bind(null, r.id)}>
                      <ConfirmButton inline title={`Remove This ${label} Entry?`} body="It comes off the log and the athlete's matches recompute." confirmLabel="Remove">
                        Remove
                      </ConfirmButton>
                    </Form>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </Section>

      {METRICS.length > 0 && rows.length > 0 && (
        <Stack gap={2}>
          <Label>The entry marked Scores is the best number from the most trusted source. A self-reported number only scores when nothing else exists.</Label>
        </Stack>
      )}
    </Screen>
  );
}
