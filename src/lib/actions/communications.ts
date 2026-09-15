"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseCommunicationForm } from "@/lib/validation/communication";

export interface CommunicationActionState {
  errors: Record<string, string>;
}

// Same cross-org safety shape as src/lib/actions/targets.ts's
// assertAthleteInOrg: RLS on target_communications only checks that the
// log entry's own org_id is one of the caller's orgs, not that target_id
// actually points at a target in that org.
async function assertTargetInOrg(orgId: string, targetId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("recruiting_targets").select("id").eq("id", targetId).eq("org_id", orgId).single();
  return !!data;
}

export async function logCommunication(
  slug: string,
  targetId: string,
  _prevState: CommunicationActionState,
  formData: FormData
): Promise<CommunicationActionState> {
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
