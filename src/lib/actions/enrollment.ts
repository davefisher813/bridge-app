"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { applyEnrollment, enrollmentNotice } from "@/lib/data/enrollment";

export interface EnrollActionState {
  errors: Record<string, string>;
  values?: Record<string, FormDataEntryValue>;
}

// The deliberate path onto Enrolled: it requires a Committed target
// (that is where "which school" comes from, so nothing is typed twice)
// and lets the date be picked, unlike the plain Edit form's escape
// hatch in updateAthlete, which defaults it to today. See
// src/lib/data/enrollment.ts for what actually happens.
export async function markEnrolled(slug: string, athleteId: string, _prev: EnrollActionState, formData: FormData): Promise<EnrollActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const enrolledOn = String(formData.get("enrolledOn") ?? "").trim();
  if (!enrolledOn || Number.isNaN(Date.parse(enrolledOn))) {
    return { errors: { enrolledOn: "Pick the date they enrolled." }, values: Object.fromEntries(formData.entries()) };
  }

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, status").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) redirect("/unauthorized");
  if (athlete.status === "Enrolled") redirect(`/org/${slug}/roster/${athleteId}`);

  const { data: committed } = await supabase
    .from("recruiting_targets")
    .select("id")
    .eq("org_id", org.id)
    .eq("athlete_id", athleteId)
    .eq("status", "Committed")
    .maybeSingle();
  if (!committed) {
    return { errors: { form: "Mark a target Committed first. Enrolling reads which school from there." }, values: Object.fromEntries(formData.entries()) };
  }

  const { schoolName, closedCount } = await applyEnrollment(supabase, org.id, athleteId, enrolledOn);

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(enrollmentNotice(schoolName, closedCount))}`);
}
