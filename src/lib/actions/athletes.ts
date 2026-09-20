"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseAthleteForm } from "@/lib/validation/athlete";

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
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseAthleteForm(formData);
  if (!parsed.ok) {
    return { errors: parsed.errors, values: valuesFromFormData(formData) };
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
    })
    .select("id")
    .single();

  if (error) {
    return { errors: { form: error.message }, values: valuesFromFormData(formData) };
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", athleteId)
    .eq("org_id", org.id);

  if (error) {
    return { errors: { form: error.message }, values: valuesFromFormData(formData) };
  }

  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  redirect(`/org/${slug}/roster/${athleteId}`);
}
