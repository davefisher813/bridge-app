"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { matchingColumnsFrom, parseFirstMetrics, parseAthleteForm } from "@/lib/validation/athlete";
import { recomputeFitsForAthlete } from "@/lib/data/fits";
import { applyEnrollment, enrollmentNotice } from "@/lib/data/enrollment";

// Athlete add/edit was the top ROADMAP.md item once roster/board existed
// as read-only screens - there was no way to get real data in short of
// using Supabase directly. Both actions re-validate on the server (never
// trust that the client-side form did) and write `detail` through the
// same athleteDetailSchema the fit engine itself reads, so a malformed
// write can never reach the column parseAthleteDetail() expects to be clean.

export interface AthleteActionState {
  errors: Record<string, string>;
  values: Record<string, FormDataEntryValue>;
}

function valuesFromFormData(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

export async function createAthlete(slug: string, _prevState: AthleteActionState, formData: FormData): Promise<AthleteActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseAthleteForm(formData);
  const first = parseFirstMetrics(formData);
  if (!parsed.ok || !first.ok) {
    return { errors: { ...parsed.errors, ...(first.ok ? {} : first.errors) }, values: valuesFromFormData(formData) };
  }

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("athletes")
    .insert({
    org_id: org.id,
    recruit_type: parsed.values.recruitType,
    name: parsed.values.name,
    sport: parsed.values.sport,
    position: parsed.values.position ?? null,
    gpa: parsed.values.gpa ?? null,
    gpa_verified: parsed.values.gpaVerified,
    status: parsed.values.status,
    is_international: parsed.values.isInternational,
    toefl_score: parsed.values.toeflScore ?? null,
    ielts_score: parsed.values.ieltsScore ?? null,
    f1_visa_status: parsed.values.f1VisaStatus ?? null,
    ncaa_eligibility_status: parsed.values.ncaaEligibilityStatus ?? null,
    detail: parsed.detail,
    ...matchingColumnsFrom(parsed.values),
    })
    .select("id")
    .single();

  if (error) {
    return { errors: { form: error.message }, values: valuesFromFormData(formData) };
  }

  // The first metrics, typed on the same form: one dated entry each,
  // the same rows the metrics screen logs, so the best verified number
  // scores from day one.
  let metricsWarning: string | null = null;
  if (created?.id && first.metrics) {
    const m = first.metrics;
    const { error: metricError } = await supabase.from("athlete_metrics").insert(
      m.entries.map((e) => ({ org_id: org.id, athlete_id: created.id, metric: e.metric, value: e.value, measured_on: m.measuredOn, source: m.source, source_detail: m.sourceDetail, entered_by: user.id })),
    );
    if (metricError) metricsWarning = metricError.message;
  }

  // Stored fits: a new athlete is scored against every school now, so
  // the Matches section is full the first time anyone opens the record.
  if (created?.id) await recomputeFitsForAthlete(supabase, org.id, created.id);
  if (metricsWarning) {
    return { errors: { form: `${parsed.values.name} was added, but the metrics could not be logged: ${metricsWarning}. Log them from the athlete's Metrics screen.` }, values: valuesFromFormData(formData) };
  }

  // Land on the record that was just made, not the list it sits in. A
  // list after a save makes the person find what they just typed.
  revalidatePath(`/org/${slug}/roster`);
  redirect(created?.id ? `/org/${slug}/roster/${created.id}` : `/org/${slug}/roster`);
}

export async function updateAthlete(
  slug: string,
  athleteId: string,
  _prevState: AthleteActionState,
  formData: FormData
): Promise<AthleteActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseAthleteForm(formData);
  if (!parsed.ok) {
    return { errors: parsed.errors, values: valuesFromFormData(formData) };
  }

  const supabase = await createClient();

  // Read before write, so a save that flips the dropdown to Enrolled by
  // hand can be told apart from every other save while it already reads
  // Enrolled - the close-out below runs once, on the transition, never
  // on an ordinary later edit. src/lib/data/enrollment.ts.
  const { data: before } = await supabase.from("athletes").select("status").eq("id", athleteId).eq("org_id", org.id).maybeSingle();

  const { error } = await supabase
    .from("athletes")
    .update({
      recruit_type: parsed.values.recruitType,
      name: parsed.values.name,
      sport: parsed.values.sport,
      position: parsed.values.position ?? null,
      gpa: parsed.values.gpa ?? null,
      gpa_verified: parsed.values.gpaVerified,
      status: parsed.values.status,
      is_international: parsed.values.isInternational,
      toefl_score: parsed.values.toeflScore ?? null,
      ielts_score: parsed.values.ieltsScore ?? null,
      f1_visa_status: parsed.values.f1VisaStatus ?? null,
      ncaa_eligibility_status: parsed.values.ncaaEligibilityStatus ?? null,
      detail: parsed.detail,
      ...matchingColumnsFrom(parsed.values),
      updated_at: new Date().toISOString(),
    })
    .eq("id", athleteId)
    .eq("org_id", org.id);

  if (error) {
    return { errors: { form: error.message }, values: valuesFromFormData(formData) };
  }

  // Every input the score reads may have changed. docs/MATCHING_CONTRACT.md.
  await recomputeFitsForAthlete(supabase, org.id, athleteId);

  let notice: string | null = null;
  if (before && before.status !== "Enrolled" && parsed.values.status === "Enrolled") {
    const today = new Date().toISOString().slice(0, 10);
    const { schoolName, closedCount } = await applyEnrollment(supabase, org.id, athleteId, today);
    notice = enrollmentNotice(schoolName, closedCount);
  }

  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(notice ? `/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(notice)}` : `/org/${slug}/roster/${athleteId}`);
}
