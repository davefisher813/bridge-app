"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { applyReopen, reopenNotice, type ReopenInput, type TransferKind } from "@/lib/data/reopen";
import { canReopen, currentSchoolOf } from "@/lib/placement";
import { resolveCollege } from "@/lib/data/lookups";
import { addAthleteNote } from "@/lib/data/athleteNotes";
import { activitySummary, logActivity } from "@/lib/data/activity";

export interface ReopenActionState {
  errors: Record<string, string>;
  values?: Record<string, FormDataEntryValue>;
}

const TRANSFER_KINDS: TransferKind[] = ["transfer_4to4", "transfer_juco", "transfer_grad"];

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

// Reopen Recruiting. Reached two ways: the Reopen Recruiting screen
// (Enrolled or Graduated, with the transfer facts, through
// useActionState) and the Reopen button on a Committed athlete's page
// (a plain form action with no fields). The plain form hands FormData
// where the state would be, so both shapes are accepted here.
export async function reopenRecruiting(slug: string, athleteId: string, prevOrForm: ReopenActionState | FormData, maybeForm?: FormData): Promise<ReopenActionState> {
  const formData = maybeForm ?? (prevOrForm instanceof FormData ? prevOrForm : new FormData());
  const values = Object.fromEntries(formData.entries());

  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name, status, detail").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) redirect("/unauthorized");
  const profile = `/org/${slug}/roster/${athleteId}`;
  if (!canReopen(athlete.status)) redirect(profile);

  let input: ReopenInput = {};
  if (athlete.status !== "Committed") {
    const errors: Record<string, string> = {};
    const kindRaw = String(formData.get("transferKind") ?? "").trim();
    const transferKind = (TRANSFER_KINDS as string[]).includes(kindRaw) ? (kindRaw as TransferKind) : athlete.status === "Graduated" ? "transfer_grad" : "transfer_4to4";

    const { data: committedRow } = await supabase.from("recruiting_targets").select("id, schools(name)").eq("org_id", org.id).eq("athlete_id", athleteId).eq("status", "Committed").maybeSingle();
    const committedName = unwrap((committedRow as { schools: { name: string } | { name: string }[] | null } | null)?.schools)?.name ?? null;
    const currentSchool = String(formData.get("currentSchool") ?? "").trim() || committedName || currentSchoolOf(athlete.detail) || "";
    if (!currentSchool) errors.currentSchool = "Enter the school they are leaving.";
    if (currentSchool.length > 120) errors.currentSchool = "Keep the school name under 120 characters.";

    const yearsRaw = String(formData.get("eligibilityYearsRemaining") ?? "").trim();
    const years = yearsRaw === "" ? NaN : Number(yearsRaw);
    if (!Number.isFinite(years) || years < 0 || years > 5) errors.eligibilityYearsRemaining = "Eligibility years left, 0 to 5.";

    const countRaw = String(formData.get("transferCount") ?? "").trim();
    const transferCount = countRaw === "" ? 1 : Number(countRaw);
    if (!Number.isInteger(transferCount) || transferCount < 0) errors.transferCount = "A whole number, zero or more.";

    const portalRaw = String(formData.get("portalEntryDate") ?? "").trim();
    if (portalRaw && !/^\d{4}-\d{2}-\d{2}$/.test(portalRaw)) errors.portalEntryDate = "A date, or leave it blank.";

    if (String(formData.get("note") ?? "").trim().length > 4000) errors.note = "A note is 4000 characters or fewer.";

    if (Object.keys(errors).length) return { errors, values };
    // The school they are leaving, when it names exactly one college on
    // file: its id is remembered on the record (Stage 4), and its
    // division fills in. Otherwise the name stays as typed.
    const college = await resolveCollege(supabase, currentSchool);
    input = {
      transferKind,
      currentSchool,
      currentSchoolId: college?.id,
      currentDivision: college?.division ?? undefined,
      eligibilityYearsRemaining: years,
      transferCount,
      portalEntryDate: portalRaw || undefined,
    };
  }

  const result = await applyReopen(supabase, org.id, athleteId, input);
  if (!result) redirect(profile);

  // The optional note, filed under Reopened Recruiting. Blank adds none.
  const noteError = await addAthleteNote(supabase, { orgId: org.id, athleteId, authorId: user.id, context: "reopened", body: String(formData.get("note") ?? "") });

  // The activity log (Stage 5, Phase 6): a reopen is a status change,
  // from what they were to Active or Transferring. Never inside
  // src/lib/data/reopen.ts, so it is logged once. The note stays above.
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    action: "athlete_status_changed",
    subjectType: "athlete",
    subjectId: athleteId,
    athleteId,
    summary: activitySummary("athlete_status_changed", { name: athlete.name, from: athlete.status, to: result.status }),
  });

  revalidatePath(profile);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`${profile}?notice=${encodeURIComponent(noteError ? `${reopenNotice(result)} ${noteError}` : reopenNotice(result))}`);
}
