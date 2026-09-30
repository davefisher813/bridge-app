"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseTargetForm } from "@/lib/validation/target";
import { syncCommitment } from "@/lib/data/commitment";
import { recomputeFitsForAthlete } from "@/lib/data/fits";
import { aidFromRow, parseTargetAidForm } from "@/lib/validation/targetAid";
import { loadLiveTarget } from "@/lib/data/loadTarget";
import { isClosedStatus } from "@/lib/placement";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { requireNotViewing } from "@/lib/data/viewAs";

export interface TargetActionState {
  errors: Record<string, string>;
}

// recruiting_targets RLS (recruiting_targets_by_org) only checks that the
// target row's own org_id belongs to the caller - it has no way to also
// confirm athlete_id points at an athlete in that same org, since that
// would need a cross-table check RLS USING clauses can't express here.
// A submitted athleteId for another org's athlete would otherwise insert
// fine (the FK only checks the row exists, not who owns it), silently
// mixing one org's target list with another org's athlete. So the action
// re-fetches the athlete scoped by org_id itself before ever building the
// insert - the same "app validates shape" split as everywhere else in
// this repo, just for a relationship instead of a jsonb column. The
// name comes back with the row for the activity log's line.
async function loadOrgAthlete(orgId: string, athleteId: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id, name").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).single();
  return (data as { id: string; name: string } | null) ?? null;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

// The school's name for the log line. Schools are the shared directory,
// readable to every signed-in member, so a miss only leaves the name
// blank and the template says "a school".
async function schoolName(supabase: Supabase, schoolId: string): Promise<string> {
  const { data } = await supabase.from("schools").select("name").eq("id", schoolId).maybeSingle();
  return (data as { name?: string | null } | null)?.name ?? "";
}

// Both names on an existing target, read before it is written or
// removed, so the log can say whose target at which school it was.
async function targetNames(supabase: Supabase, orgId: string, targetId: string): Promise<{ name: string; school: string }> {
  const { data } = await supabase.from("recruiting_targets").select("athletes(name), schools(name)").eq("id", targetId).eq("org_id", orgId).maybeSingle();
  const row = data as { athletes: { name: string } | { name: string }[] | null; schools: { name: string } | { name: string }[] | null } | null;
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  return { name: one(row?.athletes)?.name ?? "", school: one(row?.schools)?.name ?? "" };
}

export async function createTarget(slug: string, _prevState: TargetActionState, formData: FormData): Promise<TargetActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseTargetForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const athlete = await loadOrgAthlete(org.id, parsed.values.athleteId);
  if (!athlete) {
    return { errors: { athleteId: "That athlete isn't on this org's roster." } };
  }

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("recruiting_targets")
    .insert({
    org_id: org.id,
    athlete_id: parsed.values.athleteId,
    school_id: parsed.values.schoolId,
    status: parsed.values.status,
    coach_name: parsed.values.coachName ?? null,
    notes: parsed.values.notes ?? null,
    visit_date: parsed.values.visitDate ?? null,
    offer_type: parsed.values.offerType ?? null,
    offer_scholarship_percent: parsed.values.offerScholarshipPercent ?? null,
    })
    .select("id")
    .single();

  if (error) {
    const message = error.code === "23505" ? "This athlete already has a target for that school." : error.message;
    return { errors: { form: message } };
  }

  await syncCommitment(supabase, org.id, parsed.values.athleteId, { before: null, after: parsed.values.status });

  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: athlete.id,
    action: "target_added",
    subjectType: "target",
    subjectId: created?.id ?? null,
    summary: activitySummary("target_added", { name: athlete.name, school: await schoolName(supabase, parsed.values.schoolId) }),
  });

  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/roster/${parsed.values.athleteId}`);
  redirect(created?.id ? `/org/${slug}/board/${created.id}` : `/org/${slug}/board`);
}

export async function updateTarget(slug: string, targetId: string, _prevState: TargetActionState, formData: FormData): Promise<TargetActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseTargetForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const athlete = await loadOrgAthlete(org.id, parsed.values.athleteId);
  if (!athlete) {
    return { errors: { athleteId: "That athlete isn't on this org's roster." } };
  }

  const supabase = await createClient();
  // A removed athlete's target is not edited, or moved to someone else.
  const live = await loadLiveTarget(supabase, org.id, targetId);
  if (!live) return { errors: { form: "That target isn't on this org's board." } };
  // The same rule as deleteTarget: a placed athlete's commitment names
  // the school the placement reads, so it is not moved off Committed or
  // handed to another athlete here. Reopen Recruiting first.
  if (live.status === "Committed" && isClosedStatus(live.athleteStatus) && (parsed.values.status !== "Committed" || parsed.values.athleteId !== live.athleteId)) {
    return { errors: { form: "This commitment is where the athlete was placed. Reopen Recruiting first, then change it." } };
  }
  const before = { status: live.status, athlete_id: live.athleteId };
  const { error } = await supabase
    .from("recruiting_targets")
    .update({
      athlete_id: parsed.values.athleteId,
      school_id: parsed.values.schoolId,
      status: parsed.values.status,
      coach_name: parsed.values.coachName ?? null,
      notes: parsed.values.notes ?? null,
      visit_date: parsed.values.visitDate ?? null,
      offer_type: parsed.values.offerType ?? null,
      offer_scholarship_percent: parsed.values.offerScholarshipPercent ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId)
    .eq("org_id", org.id);

  if (error) {
    const message = error.code === "23505" ? "This athlete already has a target for that school." : error.message;
    return { errors: { form: message } };
  }

  // A target moved to another athlete leaves Committed for the old one.
  if (before.athlete_id !== parsed.values.athleteId) {
    await syncCommitment(supabase, org.id, before.athlete_id, { before: before.status, after: null });
    await syncCommitment(supabase, org.id, parsed.values.athleteId, { before: null, after: parsed.values.status });
  } else {
    await syncCommitment(supabase, org.id, parsed.values.athleteId, { before: before.status, after: parsed.values.status });
  }

  // Only a stage change is history worth a line; a coach name or a note
  // edited in place is not.
  if (before.status !== parsed.values.status) {
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      athleteId: athlete.id,
      action: "target_status_changed",
      subjectType: "target",
      subjectId: targetId,
      summary: activitySummary("target_status_changed", { name: athlete.name, school: await schoolName(supabase, parsed.values.schoolId), from: before.status, to: parsed.values.status }),
    });
  }

  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  revalidatePath(`/org/${slug}/board/${targetId}`);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/roster/${parsed.values.athleteId}`);
  redirect(`/org/${slug}/board/${targetId}`);
}

function revalidateTargetScreens(slug: string, targetId: string, athleteId: string | null) {
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  revalidatePath(`/org/${slug}/board/${targetId}`);
  revalidatePath(`/org/${slug}/board/${targetId}/edit`);
  revalidatePath(`/org/${slug}/roster`);
  if (athleteId) revalidatePath(`/org/${slug}/roster/${athleteId}`);
}

// Removing a target outright (crud F15): a duplicate, or one added by
// mistake, otherwise sits in Recruiting History and the school's Your
// Athletes Here list for good. Staff, like every other target write.
// The row is read first, scoped by id and org, so a foreign id deletes
// nothing and the commitment chain knows what left: a Committed target
// removed reopens the athlete exactly as a withdrawn commitment does.
// Its communications and visits go with it (the foreign keys cascade;
// they are deleted here first so the intent is explicit and scoped).
//
// Refused for the Committed target of an athlete already placed
// (Enrolled, Graduated, Drafted): that target names the school the
// placement reads, and removing it would leave an Enrolled athlete with
// no school and nothing for Reopen Recruiting to restore. Reopen first.
// A removed athlete's target is not touched at all.
const PLACED_COMMITMENT_REFUSAL = "Reopen Recruiting first, then remove it.";

export async function deleteTarget(slug: string, targetId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const live = await loadLiveTarget(supabase, org.id, targetId);
  if (!live) redirect(`/org/${slug}/board`);
  if (live.status === "Committed" && isClosedStatus(live.athleteStatus)) {
    redirect(`/org/${slug}/board/${targetId}/edit?error=${encodeURIComponent(PLACED_COMMITMENT_REFUSAL)}`);
  }
  const row = { status: live.status, athlete_id: live.athleteId };
  // Read before the delete; there is nothing to name afterwards.
  const named = await targetNames(supabase, org.id, targetId);

  await supabase.from("target_communications").delete().eq("target_id", targetId).eq("org_id", org.id);
  await supabase.from("target_visits").delete().eq("target_id", targetId).eq("org_id", org.id);
  const { error } = await supabase.from("recruiting_targets").delete().eq("id", targetId).eq("org_id", org.id);
  if (error) redirect(`/org/${slug}/board/${targetId}/edit?error=${encodeURIComponent(error.message)}`);

  await syncCommitment(supabase, org.id, row.athlete_id, { before: row.status, after: null });
  await recomputeFitsForAthlete(supabase, org.id, row.athlete_id);

  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: row.athlete_id,
    action: "target_removed",
    subjectType: "target",
    subjectId: targetId,
    summary: activitySummary("target_removed", { name: named.name, school: named.school }),
  });

  revalidateTargetScreens(slug, targetId, row.athlete_id);
  redirect(`/org/${slug}/roster/${row.athlete_id}`);
}

export interface TargetAidActionState {
  errors: Record<string, string>;
}

// The award on a target, typed or corrected by hand (crud F14). Staff,
// scoped by id and org. When the award came from an applied award
// letter the document id is kept, so the document screen still knows
// what it wrote. The athlete's matches are recomputed: a net cost is
// the best money evidence the fit engine has.
export async function saveTargetAid(slug: string, targetId: string, _prevState: TargetAidActionState, formData: FormData): Promise<TargetAidActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const live = await loadLiveTarget(supabase, org.id, targetId);
  if (!live) return { errors: { form: "That target isn't on this org's board." } };
  const row = { id: live.id, athlete_id: live.athleteId, aid: live.aid };

  const parsed = parseTargetAidForm(formData, aidFromRow(row.aid)?.documentId ?? null);
  if (!parsed.ok || !parsed.aid) return { errors: parsed.errors };

  const { error } = await supabase.from("recruiting_targets").update({ aid: parsed.aid, updated_at: new Date().toISOString() }).eq("id", targetId).eq("org_id", org.id);
  if (error) return { errors: { form: error.message } };

  await recomputeFitsForAthlete(supabase, org.id, row.athlete_id);
  revalidateTargetScreens(slug, targetId, row.athlete_id);
  redirect(`/org/${slug}/board/${targetId}`);
}

// Clear Award: the target goes back to scoring on the school's averages.
export async function clearTargetAid(slug: string, targetId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const live = await loadLiveTarget(supabase, org.id, targetId);
  if (!live) redirect(`/org/${slug}/board`);
  const row = { id: live.id, athlete_id: live.athleteId };

  await supabase.from("recruiting_targets").update({ aid: null, updated_at: new Date().toISOString() }).eq("id", targetId).eq("org_id", org.id);
  await recomputeFitsForAthlete(supabase, org.id, row.athlete_id);
  revalidateTargetScreens(slug, targetId, row.athlete_id);
  redirect(`/org/${slug}/board/${targetId}/edit`);
}
