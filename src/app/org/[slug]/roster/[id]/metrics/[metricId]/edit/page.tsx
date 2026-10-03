// Edit one logged metric (audit crud F20): fix a mistyped value, date,
// source or event without removing the entry and retyping it. Staff
// only, the same people who log and remove entries. Saving recomputes the
// athlete's matches, since the number that scores may have changed.

import { orgToday } from "@/lib/datetime/today";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateMetric } from "@/lib/actions/metrics";
import { MetricForm } from "@/components/MetricForm";
import { loadPastSourceDetails } from "@/lib/data/lookups";
import { metricsFor, positionGroupOf } from "@/lib/fit";
import { metricSpec } from "@/lib/fit/contract";
import { Screen } from "@/components/kit";

export const dynamic = "force-dynamic";

interface MetricEditRow {
  id: string;
  metric: string;
  value: number;
  measured_on: string;
  source: string;
  source_detail: string | null;
}

export default async function EditMetricPage({ params }: { params: Promise<{ slug: string; id: string; metricId: string }> }) {
  const { slug, id, metricId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, { data: entryRow }, sourceDetails] = await Promise.all([
    supabase.from("athletes").select("id, name, sport, position").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    supabase.from("athlete_metrics").select("id, metric, value, measured_on, source, source_detail").eq("id", metricId).eq("athlete_id", id).eq("org_id", org.id).maybeSingle(),
    loadPastSourceDetails(supabase, org.id),
  ]);
  if (!athlete || !entryRow) notFound();
  const entry = entryRow as MetricEditRow;

  // The sport's metrics as on the log screen. An entry for a metric the
  // sport no longer lists keeps its own option, so a save never changes
  // what it measured.
  const { first, more } = metricsFor(athlete.sport, positionGroupOf(athlete.sport, athlete.position ?? undefined));
  const known = [...first, ...more].some((m) => m.key === entry.metric);
  const spec = metricSpec(entry.metric);
  const moreWithOwn = known || !spec ? more : [...more, spec];
  const label = spec?.label ?? entry.metric;
  const today = orgToday();

  return (
    <Screen title={`Edit ${label}`} back={{ href: `/org/${slug}/roster/${id}/metrics`, label: "Metrics" }} lede={athlete.name}>
      <MetricForm
        action={updateMetric.bind(null, slug, id, entry.id)}
        first={first}
        more={moreWithOwn}
        today={today}
        sourceDetails={sourceDetails}
        initial={{ metric: entry.metric, value: Number(entry.value), measuredOn: entry.measured_on, source: entry.source, sourceDetail: entry.source_detail }}
        submitLabel="Save Changes"
      />
    </Screen>
  );
}
