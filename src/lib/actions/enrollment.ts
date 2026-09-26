"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { applyCloseOut, applyEnrollment, closeOutNotice, enrollmentNotice } from "@/lib/data/enrollment";
import { currentSchoolOf, nextOutcomes } from "@/lib/placement";

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
  if (!nextOutcomes(athlete.status).includes("enroll")) redirect(`/org/${slug}/roster/${athleteId}`);

  const schoolError = await ensureSchool(supabase, org.id, athleteId, athlete.detail, formData, "Pick the school they enrolled at.");
  if (schoolError) return { errors: { schoolId: schoolError }, values: Object.fromEntries(formData.entries()) };

  const { schoolName, closedCount } = await applyEnrollment(supabase, org.id, athleteId, enrolledOn);

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(enrollmentNotice(schoolName, closedCount))}`);
}

// Which school. A Committed target already says; otherwise the form
// asked, and a school picked from the list is recorded as this athlete's
// Committed target so the board, the profile and the family page all
// name the same one. With no pick, the Current School on the record will
// do. Returns an error message when nothing names a school.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureSchool(supabase: any, orgId: string, athleteId: string, detail: unknown, formData: FormData, missing: string): Promise<string | null> {
  const { data: committed } = await supabase.from("recruiting_targets").select("id").eq("org_id", orgId).eq("athlete_id", athleteId).eq("status", "Committed").maybeSingle();
  if (committed) return null;
  const schoolId = String(formData.get("schoolId") ?? "").trim();
  if (!schoolId) return currentSchoolOf(detail) ? null : missing;
  const { data: school } = await supabase.from("schools").select("id").eq("id", schoolId).maybeSingle();
  if (!school) return "Pick a school from the list.";
  const { data: existing } = await supabase.from("recruiting_targets").select("id").eq("org_id", orgId).eq("athlete_id", athleteId).eq("school_id", schoolId).maybeSingle();
  if (existing) {
    await supabase.from("recruiting_targets").update({ status: "Committed", updated_at: new Date().toISOString() }).eq("id", existing.id).eq("org_id", orgId);
  } else {
    await supabase.from("recruiting_targets").insert({ org_id: orgId, athlete_id: athleteId, school_id: schoolId, status: "Committed" });
  }
  return null;
}

function revalidateAthlete(slug: string, athleteId: string) {
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
}

// Graduated from college: only after Enrolled, named by the same school.
// Dave, 2026-09-26.
export async function markGraduated(slug: string, athleteId: string, _prev: EnrollActionState, formData: FormData): Promise<EnrollActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const graduatedOn = String(formData.get("graduatedOn") ?? "").trim();
  if (!graduatedOn || Number.isNaN(Date.parse(graduatedOn))) {
    return { errors: { graduatedOn: "Pick the date they graduated." }, values: Object.fromEntries(formData.entries()) };
  }

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, status, detail").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) redirect("/unauthorized");
  if (!nextOutcomes(athlete.status).includes("graduate")) redirect(`/org/${slug}/roster/${athleteId}`);

  const schoolError = await ensureSchool(supabase, org.id, athleteId, athlete.detail, formData, "Pick the school they graduated from.");
  if (schoolError) return { errors: { schoolId: schoolError }, values: Object.fromEntries(formData.entries()) };

  const { name, closedCount } = await applyCloseOut(supabase, org.id, athleteId, { status: "Graduated", on: graduatedOn });
  revalidateAthlete(slug, athleteId);
  redirect(`/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(closeOutNotice({ state: "Graduated", name }, closedCount))}`);
}

// Drafted: the team, and the round and year when known. Can follow any
// other status. On an athlete already Drafted it only corrects the
// details, with nothing left to close.
export async function markDrafted(slug: string, athleteId: string, _prev: EnrollActionState, formData: FormData): Promise<EnrollActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const values = Object.fromEntries(formData.entries());
  const team = String(formData.get("draftTeam") ?? "").trim();
  const roundRaw = String(formData.get("draftRound") ?? "").trim();
  const yearRaw = String(formData.get("draftYear") ?? "").trim();
  const round = roundRaw ? Number(roundRaw) : null;
  const year = yearRaw ? Number(yearRaw) : null;
  const errors: Record<string, string> = {};
  if (!team) errors.draftTeam = "Enter the team that drafted them.";
  if (team.length > 80) errors.draftTeam = "Keep the team name under 80 characters.";
  if (round !== null && (!Number.isInteger(round) || round < 1 || round > 99)) errors.draftRound = "A round from 1 to 99.";
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) errors.draftYear = "A four digit year.";
  if (Object.keys(errors).length) return { errors, values };

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, status").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) redirect("/unauthorized");

  if (athlete.status === "Drafted") {
    await supabase.from("athletes").update({ draft_team: team, draft_round: round, draft_year: year, updated_at: new Date().toISOString() }).eq("id", athleteId).eq("org_id", org.id);
    revalidateAthlete(slug, athleteId);
    redirect(`/org/${slug}/roster/${athleteId}`);
  }

  const { name, closedCount } = await applyCloseOut(supabase, org.id, athleteId, { status: "Drafted", team, round, year });
  revalidateAthlete(slug, athleteId);
  redirect(`/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(closeOutNotice({ state: "Drafted", name, draftRound: round, draftYear: year }, closedCount))}`);
}
