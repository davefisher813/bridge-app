"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { applyCloseOut, applyEnrollment, closeOutNotice, enrollmentNotice } from "@/lib/data/enrollment";
import { currentSchoolOf, nextOutcomes } from "@/lib/placement";
import { addAthleteNote, NOTE_MAX_LENGTH, type AthleteNoteContext } from "@/lib/data/athleteNotes";

export interface EnrollActionState {
  errors: Record<string, string>;
  values?: Record<string, FormDataEntryValue>;
}

// The optional note each of these screens takes (Stage 4), filed on the
// athlete's staff log under the step it was typed on.
function noteOf(formData: FormData): string {
  return String(formData.get("note") ?? "").trim();
}

const NOTE_TOO_LONG = `A note is ${NOTE_MAX_LENGTH} characters or fewer.`;

// A date that has not happened yet is not an enrollment or a graduation:
// it would start the NCAA clock early or close out an athlete who is
// still in school. One day of slack past today in UTC, so a phone a day
// ahead of UTC (east of it, late in the evening) can still pick its own
// today. The same rule updateAthlete applies to a correction.
function dayOf(value: string): string {
  return new Date(Date.parse(value)).toISOString().slice(0, 10);
}

function isAfterTomorrowUtc(value: string): boolean {
  return dayOf(value) > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

// Files the note and says, in the notice, if it could not be saved: the
// close-out itself has already happened by then and is not undone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fileNote(supabase: any, orgId: string, athleteId: string, authorId: string, context: AthleteNoteContext, body: string, notice: string): Promise<string> {
  const error = await addAthleteNote(supabase, { orgId, athleteId, authorId, context, body });
  return error ? `${notice} ${error}` : notice;
}

// The deliberate path onto Enrolled. The school comes from a Committed
// target, or the athlete's Current School, or a school picked on the
// form; enrolling never happens without one (Dave, 2026-09-26: "it just
// says enrolled, doesn't even say what school"). See
// src/lib/data/enrollment.ts for what actually happens.
export async function markEnrolled(slug: string, athleteId: string, _prev: EnrollActionState, formData: FormData): Promise<EnrollActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const enrolledOn = String(formData.get("enrolledOn") ?? "").trim();
  if (!enrolledOn || Number.isNaN(Date.parse(enrolledOn))) {
    return { errors: { enrolledOn: "Pick the date they enrolled." }, values: Object.fromEntries(formData.entries()) };
  }
  if (isAfterTomorrowUtc(enrolledOn)) {
    return { errors: { enrolledOn: "The enrollment date can't be in the future." }, values: Object.fromEntries(formData.entries()) };
  }
  const note = noteOf(formData);
  if (note.length > NOTE_MAX_LENGTH) return { errors: { note: NOTE_TOO_LONG }, values: Object.fromEntries(formData.entries()) };

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, status, detail").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) redirect("/unauthorized");
  if (!nextOutcomes(athlete.status).includes("enroll")) redirect(`/org/${slug}/roster/${athleteId}`);

  const schoolError = await ensureSchool(supabase, org.id, athleteId, athlete.detail, formData, "Pick the school they enrolled at.");
  if (schoolError) return { errors: { schoolId: schoolError }, values: Object.fromEntries(formData.entries()) };

  const { schoolName, closedCount } = await applyEnrollment(supabase, org.id, athleteId, enrolledOn);
  const notice = await fileNote(supabase, org.id, athleteId, user.id, "enrolled", note, enrollmentNotice(schoolName, closedCount));

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(notice)}`);
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
  const user = await requireRole(org.id, STAFF_ROLES);

  const graduatedOn = String(formData.get("graduatedOn") ?? "").trim();
  if (!graduatedOn || Number.isNaN(Date.parse(graduatedOn))) {
    return { errors: { graduatedOn: "Pick the date they graduated." }, values: Object.fromEntries(formData.entries()) };
  }
  if (isAfterTomorrowUtc(graduatedOn)) {
    return { errors: { graduatedOn: "The graduation date can't be in the future." }, values: Object.fromEntries(formData.entries()) };
  }
  const note = noteOf(formData);
  if (note.length > NOTE_MAX_LENGTH) return { errors: { note: NOTE_TOO_LONG }, values: Object.fromEntries(formData.entries()) };

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, status, detail, first_full_time_enrollment").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) redirect("/unauthorized");
  if (!nextOutcomes(athlete.status).includes("graduate")) redirect(`/org/${slug}/roster/${athleteId}`);
  // Never before they enrolled: the same rule, and the same words, as a
  // correction on Edit (updateAthlete).
  const enrolledOn = (athlete as { first_full_time_enrollment?: string | null }).first_full_time_enrollment;
  if (enrolledOn && dayOf(graduatedOn) < dayOf(enrolledOn)) {
    return { errors: { graduatedOn: "Graduated On comes after the Enrollment Date." }, values: Object.fromEntries(formData.entries()) };
  }

  const schoolError = await ensureSchool(supabase, org.id, athleteId, athlete.detail, formData, "Pick the school they graduated from.");
  if (schoolError) return { errors: { schoolId: schoolError }, values: Object.fromEntries(formData.entries()) };

  const { name, closedCount } = await applyCloseOut(supabase, org.id, athleteId, { status: "Graduated", on: graduatedOn });
  const notice = await fileNote(supabase, org.id, athleteId, user.id, "graduated", note, closeOutNotice({ state: "Graduated", name }, closedCount));
  revalidateAthlete(slug, athleteId);
  redirect(`/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(notice)}`);
}

// Drafted: the team, and the round and year when known. Can follow any
// other status. On an athlete already Drafted it only corrects the
// details, with nothing left to close.
export async function markDrafted(slug: string, athleteId: string, _prev: EnrollActionState, formData: FormData): Promise<EnrollActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

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
  const note = noteOf(formData);
  if (note.length > NOTE_MAX_LENGTH) errors.note = NOTE_TOO_LONG;
  if (Object.keys(errors).length) return { errors, values };

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, status").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) redirect("/unauthorized");

  if (athlete.status === "Drafted") {
    await supabase.from("athletes").update({ draft_team: team, draft_round: round, draft_year: year, updated_at: new Date().toISOString() }).eq("id", athleteId).eq("org_id", org.id);
    const noteError = await addAthleteNote(supabase, { orgId: org.id, athleteId, authorId: user.id, context: "drafted", body: note });
    revalidateAthlete(slug, athleteId);
    redirect(noteError ? `/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(`Saved. ${noteError}`)}` : `/org/${slug}/roster/${athleteId}`);
  }

  const { name, closedCount } = await applyCloseOut(supabase, org.id, athleteId, { status: "Drafted", team, round, year });
  const notice = await fileNote(supabase, org.id, athleteId, user.id, "drafted", note, closeOutNotice({ state: "Drafted", name, draftRound: round, draftYear: year }, closedCount));
  revalidateAthlete(slug, athleteId);
  redirect(`/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(notice)}`);
}
