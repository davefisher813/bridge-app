"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { loadLiveTarget } from "@/lib/data/loadTarget";
import { parseCommunicationForm } from "@/lib/validation/communication";
import { requireNotViewing } from "@/lib/data/viewAs";

export interface CommunicationActionState {
  errors: Record<string, string>;
}

// Same cross-org safety shape as src/lib/actions/targets.ts's
// assertAthleteInOrg: RLS on target_communications only checks that the
// log entry's own org_id is one of the caller's orgs, not that target_id
// actually points at a target in that org.
// A removed athlete's target counts as gone too (loadLiveTarget), so
// nothing is logged, corrected or removed on it.
async function assertTargetInOrg(orgId: string, targetId: string): Promise<boolean> {
  const supabase = await createClient();
  return !!(await loadLiveTarget(supabase, orgId, targetId));
}

export async function logCommunication(
  slug: string,
  targetId: string,
  _prevState: CommunicationActionState,
  formData: FormData
): Promise<CommunicationActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseCommunicationForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  if (!(await assertTargetInOrg(org.id, targetId))) {
    return { errors: { form: "That target isn't on this org's board." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("target_communications").insert({
    org_id: org.id,
    target_id: targetId,
    kind: parsed.values.kind,
    occurred_on: parsed.values.occurredOn ?? new Date().toISOString().slice(0, 10),
    notes: parsed.values.notes ?? null,
  });

  if (error) return { errors: { form: error.message } };

  // A logged communication IS the target's most recent activity - bump
  // updated_at here too, not just on a full target edit, so Today's
  // "needs follow-up" staleness reflects real engagement rather than
  // only reacting to someone opening the edit form. See docs/DECISIONS.md.
  await supabase.from("recruiting_targets").update({ updated_at: new Date().toISOString() }).eq("id", targetId).eq("org_id", org.id);

  revalidatePath(`/org/${slug}/board/${targetId}/edit`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  return { errors: {} };
}

function revalidateTarget(slug: string, targetId: string) {
  revalidatePath(`/org/${slug}/board/${targetId}/edit`);
  revalidatePath(`/org/${slug}/board/${targetId}/communications`);
  revalidatePath(`/org/${slug}/board/${targetId}`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
}

// Correcting a logged entry: a wrong date, the wrong kind, a note on the
// wrong line. Scoped by the entry, its target and this org together, so
// an id from another target or another org matches nothing. RLS allows
// staff this write (migration 0004); the org filter makes a foreign id
// a no-op rather than relying on it.
export async function updateCommunication(
  slug: string,
  targetId: string,
  entryId: string,
  _prevState: CommunicationActionState,
  formData: FormData,
): Promise<CommunicationActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseCommunicationForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  if (!(await assertTargetInOrg(org.id, targetId))) {
    return { errors: { form: "That target isn't on this org's board." } };
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("target_communications")
    .update({
      kind: parsed.values.kind,
      occurred_on: parsed.values.occurredOn ?? null,
      notes: parsed.values.notes ?? null,
    })
    .eq("id", entryId)
    .eq("target_id", targetId)
    .eq("org_id", org.id)
    .select("id");
  if (error) return { errors: { form: error.message } };
  if (!updated || updated.length === 0) return { errors: { form: "That entry isn't on this target any more." } };

  revalidateTarget(slug, targetId);
  redirect(`/org/${slug}/board/${targetId}/communications`);
}

// Posted by the Remove button on an entry, through a ConfirmButton, the
// Contacts pattern: bound to the ids, no client state.
export async function removeCommunication(slug: string, targetId: string, entryId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  if (!(await assertTargetInOrg(org.id, targetId))) redirect(`/org/${slug}/board`);

  const supabase = await createClient();
  await supabase.from("target_communications").delete().eq("id", entryId).eq("target_id", targetId).eq("org_id", org.id);

  revalidateTarget(slug, targetId);
  redirect(`/org/${slug}/board/${targetId}/communications`);
}
