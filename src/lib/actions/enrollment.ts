"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { applyEnrollment, enrollmentNotice } from "@/lib/data/enrollment";
import { currentSchoolOf } from "@/lib/placement";

export interface EnrollActionState {
  errors: Record<string, string>;
  values?: Record<string, FormDataEntryValue>;
}

// The deliberate path onto Enrolled. The school comes from a Committed
// target, or the athlete's Current School, or a school picked on the
// form; enrolling never happens without one (Dave, 2026-09-26: "it just
// says enrolled, doesn't even say what school"). See
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
  const { data: athlete } = await supabase.from("athletes").select("id, status, detail").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) redirect("/unauthorized");
  if (athlete.status === "Enrolled") redirect(`/org/${slug}/roster/${athleteId}`);

  // Which school. A Committed target already says; otherwise the form
  // asked, and a school picked from the list is recorded as this
  // athlete's Committed target so the board, the profile and the family
  // page all name the same one.
  const { data: committed } = await supabase.from("recruiting_targets").select("id").eq("org_id", org.id).eq("athlete_id", athleteId).eq("status", "Committed").maybeSingle();
  if (!committed) {
    const schoolId = String(formData.get("schoolId") ?? "").trim();
    if (schoolId) {
      const { data: school } = await supabase.from("schools").select("id").eq("id", schoolId).maybeSingle();
      if (!school) return { errors: { schoolId: "Pick a school from the list." }, values: Object.fromEntries(formData.entries()) };
      const { data: existing } = await supabase.from("recruiting_targets").select("id").eq("org_id", org.id).eq("athlete_id", athleteId).eq("school_id", schoolId).maybeSingle();
      if (existing) {
        await supabase.from("recruiting_targets").update({ status: "Committed", updated_at: new Date().toISOString() }).eq("id", existing.id).eq("org_id", org.id);
      } else {
        await supabase.from("recruiting_targets").insert({ org_id: org.id, athlete_id: athleteId, school_id: schoolId, status: "Committed" });
      }
    } else if (!currentSchoolOf(athlete.detail)) {
      return { errors: { schoolId: "Pick the school they enrolled at." }, values: Object.fromEntries(formData.entries()) };
    }
  }

  const { schoolName, closedCount } = await applyEnrollment(supabase, org.id, athleteId, enrolledOn);

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(enrollmentNotice(schoolName, closedCount))}`);
}
