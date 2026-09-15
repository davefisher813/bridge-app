"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseContactForm } from "@/lib/validation/contact";

export interface ContactActionState {
  errors: Record<string, string>;
}

// Same cross-org safety shape as src/lib/actions/targets.ts's
// assertAthleteInOrg: RLS on contacts only checks that the contact's own
// org_id is one of the caller's orgs, not that athlete_id actually
// points at an athlete in that org.
async function assertAthleteInOrg(orgId: string, athleteId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).single();
  return !!data;
}

export async function createContact(
  slug: string,
  athleteId: string,
  _prevState: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseContactForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  if (!(await assertAthleteInOrg(org.id, athleteId))) {
    return { errors: { form: "That athlete isn't on this org's roster." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("contacts").insert({
    org_id: org.id,
    athlete_id: athleteId,
    name: parsed.values.name,
    role: parsed.values.role,
    school_id: parsed.values.schoolId ?? null,
    email: parsed.values.email || null,
    phone: parsed.values.phone ?? null,
    notes: parsed.values.notes ?? null,
  });

  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  return { errors: {} };
}

export async function deleteContact(slug: string, athleteId: string, contactId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) return;
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  await supabase.from("contacts").delete().eq("id", contactId).eq("org_id", org.id);

  revalidatePath(`/org/${slug}/roster/${athleteId}`);
}
