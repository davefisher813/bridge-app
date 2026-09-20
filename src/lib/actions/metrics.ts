"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseMetricForm } from "@/lib/validation/metric";
import { recomputeFitsForAthlete } from "@/lib/data/fits";

// The metrics log. docs/MATCHING_CONTRACT.md section 1: staff and
// owners log a value, a date and where it was measured; every save
// recomputes the athlete's stored fits, since the number that scores
// may have changed.

export interface MetricActionState {
  errors: Record<string, string>;
}

async function assertAthleteInOrg(orgId: string, athleteId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).single();
  return !!data;
}

export async function createMetric(slug: string, athleteId: string, _prevState: MetricActionState, formData: FormData): Promise<MetricActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseMetricForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  if (!(await assertAthleteInOrg(org.id, athleteId))) return { errors: { form: "That athlete is not on this org's roster." } };

  const supabase = await createClient();
  const { error } = await supabase.from("athlete_metrics").insert({
    org_id: org.id,
    athlete_id: athleteId,
    metric: parsed.values.metric,
    value: parsed.values.value,
    measured_on: parsed.values.measuredOn,
    source: parsed.values.source,
    source_detail: parsed.values.sourceDetail ?? null,
    entered_by: user.id,
  });
  if (error) return { errors: { form: error.message } };

  await recomputeFitsForAthlete(supabase, org.id, athleteId);

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster/${athleteId}/metrics`);
  revalidatePath(`/org/${slug}/roster/${athleteId}/matches`);
  revalidatePath(`/org/${slug}/board`);
  redirect(`/org/${slug}/roster/${athleteId}/metrics`);
}

export async function deleteMetric(slug: string, athleteId: string, metricId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  await supabase.from("athlete_metrics").delete().eq("id", metricId).eq("athlete_id", athleteId).eq("org_id", org.id);
  await recomputeFitsForAthlete(supabase, org.id, athleteId);

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster/${athleteId}/metrics`);
  revalidatePath(`/org/${slug}/roster/${athleteId}/matches`);
  revalidatePath(`/org/${slug}/board`);
  redirect(`/org/${slug}/roster/${athleteId}/metrics`);
}
