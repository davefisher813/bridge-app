"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { loadLiveTarget } from "@/lib/data/loadTarget";
import { parseVisitForm } from "@/lib/validation/visit";
import { requireNotViewing } from "@/lib/data/viewAs";

export interface VisitActionState {
  errors: Record<string, string>;
}

// Same cross-org safety shape as src/lib/actions/communications.ts's
// assertTargetInOrg: RLS on target_visits only checks that the visit's
// own org_id is one of the caller's orgs, not that target_id actually
// points at a target in that org.
// A removed athlete's target counts as gone too (loadLiveTarget), so
// nothing is logged, corrected or removed on it.
async function assertTargetInOrg(orgId: string, targetId: string): Promise<boolean> {
  const supabase = await createClient();
  return !!(await loadLiveTarget(supabase, orgId, targetId));
}

export async function logVisit(
  slug: string,
  targetId: string,
  _prevState: VisitActionState,
  formData: FormData
): Promise<VisitActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseVisitForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  if (!(await assertTargetInOrg(org.id, targetId))) {
    return { errors: { form: "That target isn't on this org's board." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("target_visits").insert({
    org_id: org.id,
    target_id: targetId,
    visit_type: parsed.values.visitType,
    visit_date: parsed.values.visitDate ?? new Date().toISOString().slice(0, 10),
    impression: parsed.values.impression ?? null,
    next_step: parsed.values.nextStep ?? null,
    notes: parsed.values.notes ?? null,
  });

  if (error) return { errors: { form: error.message } };

  // A logged visit is real activity on the target, same as a logged
  // communication (src/lib/actions/communications.ts) - bump updated_at
  // so Today's "needs follow-up" staleness reflects it.
  const { data: targetRow } = await supabase
    .from("recruiting_targets")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", targetId)
    .eq("org_id", org.id)
    .select("athlete_id")
    .single();

  revalidatePath(`/org/${slug}/board/${targetId}/edit`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  if (targetRow?.athlete_id) revalidatePath(`/org/${slug}/roster/${targetRow.athlete_id}`);
  return { errors: {} };
}

async function revalidateVisit(slug: string, targetId: string, orgId: string) {
  revalidatePath(`/org/${slug}/board/${targetId}/edit`);
  revalidatePath(`/org/${slug}/board/${targetId}/communications`);
  revalidatePath(`/org/${slug}/board/${targetId}`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  const supabase = await createClient();
  const { data } = await supabase.from("recruiting_targets").select("athlete_id").eq("id", targetId).eq("org_id", orgId).maybeSingle();
  const athleteId = (data as { athlete_id?: string } | null)?.athlete_id;
  if (athleteId) revalidatePath(`/org/${slug}/roster/${athleteId}`);
}

// Correcting a logged visit. Scoped by the visit, its target and this
// org together, so an id from anywhere else matches nothing.
export async function updateVisit(slug: string, targetId: string, visitId: string, _prevState: VisitActionState, formData: FormData): Promise<VisitActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseVisitForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  if (!(await assertTargetInOrg(org.id, targetId))) {
    return { errors: { form: "That target isn't on this org's board." } };
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("target_visits")
    .update({
      visit_type: parsed.values.visitType,
      visit_date: parsed.values.visitDate ?? null,
      impression: parsed.values.impression ?? null,
      next_step: parsed.values.nextStep ?? null,
      notes: parsed.values.notes ?? null,
    })
    .eq("id", visitId)
    .eq("target_id", targetId)
    .eq("org_id", org.id)
    .select("id");
  if (error) return { errors: { form: error.message } };
  if (!updated || updated.length === 0) return { errors: { form: "That visit isn't on this target any more." } };

  await revalidateVisit(slug, targetId, org.id);
  redirect(`/org/${slug}/board/${targetId}/communications`);
}

export async function removeVisit(slug: string, targetId: string, visitId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  if (!(await assertTargetInOrg(org.id, targetId))) redirect(`/org/${slug}/board`);

  const supabase = await createClient();
  await supabase.from("target_visits").delete().eq("id", visitId).eq("target_id", targetId).eq("org_id", org.id);

  await revalidateVisit(slug, targetId, org.id);
  redirect(`/org/${slug}/board/${targetId}/communications`);
}
