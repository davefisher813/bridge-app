"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { matchingColumnsFrom, parseFirstMetrics, parseAthleteForm } from "@/lib/validation/athlete";
import { clearFitsForAthlete, recomputeFitsForAthlete } from "@/lib/data/fits";
import { isClosedStatus, isPlacedStatus } from "@/lib/placement";
import { resolveCollege, resolveHighSchool } from "@/lib/data/lookups";
import { addAthleteNote, deleteAthleteNote } from "@/lib/data/athleteNotes";
import { escapeIlike, nameKey } from "@/lib/lookup/nameKey";
import { isUsStateCode } from "@/lib/lookup/states";
import type { AthleteFormResult } from "@/lib/validation/athlete";

// Athlete add/edit was the top ROADMAP.md item once roster/board existed
// as read-only screens - there was no way to get real data in short of
// using Supabase directly. Both actions re-validate on the server (never
// trust that the client-side form did) and write `detail` through the
// same athleteDetailSchema the fit engine itself reads, so a malformed
// write can never reach the column parseAthleteDetail() expects to be clean.

export interface AthleteActionState {
  errors: Record<string, string>;
  values: Record<string, FormDataEntryValue>;
  // Add Athlete found the same name on this org's roster (Stage 4). The
  // form shows Open Theirs and Add Anyway; Add Anyway posts
  // confirmDuplicate=1. Only ever this org's own athlete.
  duplicate?: { id: string; name: string; meta: string; href: string };
}

function valuesFromFormData(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

// The advisor must be an owner or staff member of this org (migration
// 0039). The database trigger refuses anyone else; this asks first so the
// answer is a field error, not a constraint message. Read through the
// caller's own client: an owner or staff member sees their org's rows.
const ADVISOR_ERROR = { advisorId: "Pick an Admin." };

async function assertAdvisorInOrg(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, advisorId: string | undefined): Promise<boolean> {
  if (!advisorId) return true;
  const { data } = await supabase.from("org_members").select("user_id").eq("user_id", advisorId).eq("org_id", orgId).in("role", ["owner", "staff"]).maybeSingle();
  return !!data;
}

// The directory fills (Stage 4). A high school or current school that
// matches exactly one directory row records that row's id; anything else
// stays the text that was typed, with no id. A match fills Home State or
// Current Division only when that field is blank, and never overwrites
// one. The client does the same on a pick; this is the server's own
// answer, so an id the client sent is never trusted as is.
type Supabase = Awaited<ReturnType<typeof createClient>>;

async function fillFromDirectory(supabase: Supabase, parsed: AthleteFormResult): Promise<void> {
  const detail = parsed.detail;
  if (!detail) return;
  if (detail.kind === "hs") {
    delete detail.highSchoolId;
    if (!detail.highSchool) return;
    const hit = await resolveHighSchool(supabase, detail.highSchool, parsed.values.homeState ?? null);
    if (!hit) return;
    detail.highSchoolId = hit.id;
    if (!parsed.values.homeState && hit.state && isUsStateCode(hit.state)) parsed.values.homeState = hit.state.trim().toUpperCase();
    return;
  }
  delete detail.currentSchoolId;
  if (!detail.currentSchool) return;
  const hit = await resolveCollege(supabase, detail.currentSchool);
  if (!hit) return;
  detail.currentSchoolId = hit.id;
  if (!detail.currentDivision?.trim() && hit.division) detail.currentDivision = hit.division;
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
  if (!(await assertAdvisorInOrg(supabase, org.id, parsed.values.advisorId))) {
    return { errors: ADVISOR_ERROR, values: valuesFromFormData(formData) };
  }

  // The same name already on this org's roster: say so before a second
  // record is made, unless Add Anyway said it is a different athlete.
  // This org only, removed athletes excluded, and nothing is copied
  // from the record found.
  if (formData.get("confirmDuplicate") !== "1") {
    const { data: same } = await supabase
      .from("athletes")
      .select("id, name, sport, status")
      .eq("org_id", org.id)
      .is("deleted_at", null)
      .ilike("name", escapeIlike(parsed.values.name));
    const hit = ((same ?? []) as { id: string; name: string; sport: string; status: string }[]).find((r) => nameKey(r.name) === nameKey(parsed.values.name));
    if (hit) {
      return {
        errors: {},
        values: valuesFromFormData(formData),
        duplicate: { id: hit.id, name: hit.name, meta: `${hit.sport}, ${hit.status}`, href: `/org/${slug}/roster/${hit.id}` },
      };
    }
  }

  await fillFromDirectory(supabase, parsed);

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
    advisor_id: parsed.values.advisorId ?? null,
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

  // The note typed on the form, filed as the first entry in the staff
  // log. Blank adds nothing.
  const noteError = created?.id ? await addAthleteNote(supabase, { orgId: org.id, athleteId: created.id, authorId: user.id, context: "general", body: parsed.values.notes }) : null;

  // Stored fits: a new athlete is scored against every school now, so
  // the Matches section is full the first time anyone opens the record.
  if (created?.id) await recomputeFitsForAthlete(supabase, org.id, created.id);
  if (metricsWarning) {
    return { errors: { form: `${parsed.values.name} was added, but the metrics could not be logged: ${metricsWarning}. Log them from the athlete's Metrics screen.` }, values: valuesFromFormData(formData) };
  }

  // Land on the record that was just made, not the list it sits in. A
  // list after a save makes the person find what they just typed.
  revalidatePath(`/org/${slug}/roster`);
  if (!created?.id) redirect(`/org/${slug}/roster`);
  redirect(noteError ? `/org/${slug}/roster/${created.id}?notice=${encodeURIComponent(`${parsed.values.name} was added. ${noteError}`)}` : `/org/${slug}/roster/${created.id}`);
}

export async function updateAthlete(
  slug: string,
  athleteId: string,
  _prevState: AthleteActionState,
  formData: FormData
): Promise<AthleteActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseAthleteForm(formData);
  if (!parsed.ok) {
    return { errors: parsed.errors, values: valuesFromFormData(formData) };
  }

  const supabase = await createClient();

  if (!(await assertAdvisorInOrg(supabase, org.id, parsed.values.advisorId))) {
    return { errors: ADVISOR_ERROR, values: valuesFromFormData(formData) };
  }

  // Read before write, so a save that flips the dropdown can be told
  // apart from every other save while it already reads the same, and a
  // date correction can be checked against what is on file.
  const { data: beforeRow } = await supabase
    .from("athletes")
    .select("status, recruit_type, first_full_time_enrollment, graduated_on")
    .eq("id", athleteId)
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .maybeSingle();
  const before = beforeRow as { status: string; recruit_type: string; first_full_time_enrollment: string | null; graduated_on: string | null } | null;
  if (!before) redirect("/unauthorized");

  // A close-out is never a dropdown change. Enrolled, Graduated and
  // Drafted each have their own screen on the athlete page, which asks
  // for the school or team and the real date and closes the open
  // targets; a hand edit would stamp today on the NCAA clock and could
  // never be corrected (audit crud F8). Committed is the Targets board's.
  const next = parsed.values.status;
  const transition = before.status !== next ? next : null;
  if (transition === "Drafted") {
    return { errors: { status: "Use Mark Drafted on the athlete page to enter the team." }, values: valuesFromFormData(formData) };
  }
  if (transition === "Enrolled") {
    return { errors: { status: "Use Mark Enrolled on the athlete page. It takes the school and the date." }, values: valuesFromFormData(formData) };
  }
  if (transition === "Graduated") {
    const screen = before.status === "Enrolled" ? "Mark Graduated on the athlete page. It takes the date." : "Mark Enrolled, then Mark Graduated, on the athlete page.";
    return { errors: { status: `Use ${screen}` }, values: valuesFromFormData(formData) };
  }
  // The way back is Reopen Recruiting, which restores what the close-out
  // closed. A hand edit would leave every target Not Interested and the
  // dates set. Transferring on create, or from Active or Inactive, is an
  // athlete who arrives already in the portal, and stays allowed.
  if (transition === "Transferring" && isPlacedStatus(before.status)) {
    return { errors: { status: "Use Reopen Recruiting on the athlete page." }, values: valuesFromFormData(formData) };
  }
  if (isClosedStatus(before.status) && (next === "Active" || next === "Committed" || next === "Inactive")) {
    return { errors: { status: "Use Reopen Recruiting on the athlete page to bring them back." }, values: valuesFromFormData(formData) };
  }
  if (transition === "Committed") {
    const { data: committed } = await supabase.from("recruiting_targets").select("id").eq("org_id", org.id).eq("athlete_id", athleteId).eq("status", "Committed").maybeSingle();
    if (!committed) {
      return { errors: { status: "Commit on the Targets board, which records the school and closes the other targets." }, values: valuesFromFormData(formData) };
    }
  }

  // Date corrections (audit crud F8). The enrollment date is correctable
  // once it is on file, or on a transfer, whose clock started at another
  // school before this org saw them; Graduated On once Mark Graduated
  // set it. Blank leaves a date as it is.
  const datePatch: Record<string, string> = {};
  const enrollmentEditable = !!before.first_full_time_enrollment || before.recruit_type !== "hs";
  if (parsed.values.enrollmentDate && enrollmentEditable) datePatch.first_full_time_enrollment = parsed.values.enrollmentDate;
  if (parsed.values.graduatedOn && before.graduated_on) datePatch.graduated_on = parsed.values.graduatedOn;
  // Never a day that has not come yet, with one day of UTC slack: the
  // same rule Mark Enrolled and Mark Graduated apply (enrollment.ts).
  const tomorrowUtc = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (datePatch.first_full_time_enrollment && datePatch.first_full_time_enrollment > tomorrowUtc) {
    return { errors: { enrollmentDate: "The enrollment date can't be in the future." }, values: valuesFromFormData(formData) };
  }
  if (datePatch.graduated_on && datePatch.graduated_on > tomorrowUtc) {
    return { errors: { graduatedOn: "The graduation date can't be in the future." }, values: valuesFromFormData(formData) };
  }
  const enrolledOn = datePatch.first_full_time_enrollment ?? before.first_full_time_enrollment;
  const graduatedOn = datePatch.graduated_on ?? before.graduated_on;
  if (enrolledOn && graduatedOn && graduatedOn < enrolledOn) {
    return { errors: { graduatedOn: "Graduated On comes after the Enrollment Date." }, values: valuesFromFormData(formData) };
  }

  await fillFromDirectory(supabase, parsed);

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
      advisor_id: parsed.values.advisorId ?? null,
      is_international: parsed.values.isInternational,
      toefl_score: parsed.values.toeflScore ?? null,
      ielts_score: parsed.values.ieltsScore ?? null,
      f1_visa_status: parsed.values.f1VisaStatus ?? null,
      ncaa_eligibility_status: parsed.values.ncaaEligibilityStatus ?? null,
      detail: parsed.detail,
      ...matchingColumnsFrom(parsed.values),
      ...datePatch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", athleteId)
    .eq("org_id", org.id);

  if (error) {
    return { errors: { form: error.message }, values: valuesFromFormData(formData) };
  }

  // Every input the score reads may have changed. docs/MATCHING_CONTRACT.md.
  await recomputeFitsForAthlete(supabase, org.id, athleteId);

  // Add a Note: a new dated entry in the staff log. Blank adds nothing.
  const noteError = await addAthleteNote(supabase, { orgId: org.id, athleteId, authorId: user.id, context: "general", body: parsed.values.notes });

  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(noteError ? `/org/${slug}/roster/${athleteId}?notice=${encodeURIComponent(`Saved. ${noteError}`)}` : `/org/${slug}/roster/${athleteId}`);
}

// A staff note typed straight onto the athlete page's Notes section. The
// same log as Add a Note on Edit.
export interface NoteActionState {
  errors: Record<string, string>;
  body?: string;
}

export async function addNote(slug: string, athleteId: string, _prevState: NoteActionState, formData: FormData): Promise<NoteActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { errors: { body: "Type the note first." } };

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) return { errors: { form: "That athlete isn't on this org's roster." }, body };

  const error = await addAthleteNote(supabase, { orgId: org.id, athleteId, authorId: user.id, context: "general", body });
  if (error) return { errors: { body: error }, body };

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  return { errors: {} };
}

// Staff delete a note; nobody edits one. Scoped to this org and this
// athlete, so another org's or another athlete's note id removes nothing.
export async function removeNote(slug: string, athleteId: string, noteId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  await deleteAthleteNote(supabase, { orgId: org.id, athleteId, noteId });
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
}

// Remove Athlete (audit crud F1). Staff only, behind a confirm on the
// athlete page. A soft delete: deleted_at is set and every screen that
// reads athletes already filters it, so the record leaves the roster,
// Today, My Athletes and the family's view at once. The stored matches go
// with it, since nothing should rank schools for someone who is gone.
// Scoped to this org, so another org's athlete id changes nothing.
export async function removeAthlete(slug: string, athleteId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const stamp = new Date().toISOString();
  const { data: removed } = await supabase
    .from("athletes")
    .update({ deleted_at: stamp, updated_at: stamp })
    .eq("id", athleteId)
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .select("id, name");
  const row = ((removed ?? []) as { id: string; name: string }[])[0];
  if (!row) redirect(`/org/${slug}/roster`);

  await clearFitsForAthlete(supabase, org.id, athleteId);

  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}/mine`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/roster?notice=${encodeURIComponent(`${row.name} was removed from the roster.`)}`);
}
