"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseCheckinForm } from "@/lib/validation/checkin";
import { activitySummary, logActivity } from "@/lib/data/activity";

// The check-in log (migration 0039). Staff only, to read and to write:
// these athletes are minors and an advisor's call notes never reach a
// family login, so there is no family screen and no family path to
// revalidate. The person who logs it is recorded as who checked in.

export interface CheckinActionState {
  errors: Record<string, string>;
}

// RLS only checks the new row's own org_id; the athlete must be this
// org's too (the coherence trigger is the backstop). The name comes
// back for the activity log's line.
async function loadOrgAthlete(orgId: string, athleteId: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id, name").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

function revalidateCheckins(slug: string, athleteId: string) {
  revalidatePath(`/org/${slug}/roster/${athleteId}/checkins`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/mine`);
  revalidatePath(`/org/${slug}`);
}

export async function logCheckin(slug: string, athleteId: string, _prevState: CheckinActionState, formData: FormData): Promise<CheckinActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseCheckinForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const athlete = await loadOrgAthlete(org.id, athleteId);
  if (!athlete) {
    return { errors: { form: "That athlete isn't on this org's roster." } };
  }

  const supabase = await createClient();
  const occurredOn = parsed.values.occurredOn ?? new Date().toISOString().slice(0, 10);
  const { data: created, error } = await supabase
    .from("athlete_checkins")
    .insert({
      org_id: org.id,
      athlete_id: athleteId,
      advisor_id: user.id,
      kind: parsed.values.kind,
      occurred_on: occurredOn,
      notes: parsed.values.notes ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error) return { errors: { form: error.message } };

  // The log line carries the kind and the day. The note stays in
  // athlete_checkins, where only staff read it.
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: athlete.id,
    action: "checkin_logged",
    subjectType: "checkin",
    subjectId: (created as { id?: string } | null)?.id ?? null,
    summary: activitySummary("checkin_logged", { name: athlete.name, kind: parsed.values.kind, date: occurredOn }),
  });

  revalidateCheckins(slug, athleteId);
  return { errors: {} };
}

// Fix one entry in place (audit crud F21): the type, the date and the
// notes. Never who checked in: advisor_id records the person who logged
// it and an edit does not move the credit. Scoped to the org and the
// athlete, and a zero-row update says so rather than pretending it saved.
export async function updateCheckin(slug: string, athleteId: string, checkinId: string, _prevState: CheckinActionState, formData: FormData): Promise<CheckinActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseCheckinForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  if (!parsed.values.occurredOn) return { errors: { occurredOn: "Pick the date it happened." } };

  if (!(await loadOrgAthlete(org.id, athleteId))) {
    return { errors: { form: "That athlete isn't on this org's roster." } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("athlete_checkins")
    .update({ kind: parsed.values.kind, occurred_on: parsed.values.occurredOn, notes: parsed.values.notes ?? null })
    .eq("id", checkinId)
    .eq("org_id", org.id)
    .eq("athlete_id", athleteId)
    .select("id");
  if (error) return { errors: { form: error.message } };
  if (!data || data.length === 0) return { errors: { form: "That check-in is not on this athlete's log any more." } };

  revalidateCheckins(slug, athleteId);
  redirect(`/org/${slug}/roster/${athleteId}/checkins`);
}

// Posted by the Remove button on a log entry, the Contacts pattern:
// bound to the entry's id, no client state.
export async function removeCheckin(slug: string, athleteId: string, checkinId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) return;
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  await supabase.from("athlete_checkins").delete().eq("id", checkinId).eq("org_id", org.id).eq("athlete_id", athleteId);

  revalidateCheckins(slug, athleteId);
}
