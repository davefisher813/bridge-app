"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseVisitForm } from "@/lib/validation/visit";

export interface VisitActionState {
  errors: Record<string, string>;
}

// Same cross-org safety shape as src/lib/actions/communications.ts's
// assertTargetInOrg: RLS on target_visits only checks that the visit's
// own org_id is one of the caller's orgs, not that target_id actually
// points at a target in that org.
async function assertTargetInOrg(orgId: string, targetId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("recruiting_targets").select("id").eq("id", targetId).eq("org_id", orgId).single();
  return !!data;
}

export async function logVisit(
  slug: string,
  targetId: string,
  _prevState: VisitActionState,
  formData: FormData
): Promise<VisitActionState> {
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
