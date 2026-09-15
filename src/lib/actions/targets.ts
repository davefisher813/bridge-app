"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseTargetForm } from "@/lib/validation/target";

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
// this repo, just for a relationship instead of a jsonb column.
async function assertAthleteInOrg(orgId: string, athleteId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).single();
  return !!data;
}

export async function createTarget(slug: string, _prevState: TargetActionState, formData: FormData): Promise<TargetActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseTargetForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  if (!(await assertAthleteInOrg(org.id, parsed.values.athleteId))) {
    return { errors: { athleteId: "That athlete isn't on this org's roster." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("recruiting_targets").insert({
    org_id: org.id,
    athlete_id: parsed.values.athleteId,
    school_id: parsed.values.schoolId,
    status: parsed.values.status,
    coach_name: parsed.values.coachName ?? null,
    notes: parsed.values.notes ?? null,
    visit_date: parsed.values.visitDate ?? null,
  });

  if (error) {
    const message = error.code === "23505" ? "This athlete already has a target for that school." : error.message;
    return { errors: { form: message } };
  }

  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/board`);
}

export async function updateTarget(slug: string, targetId: string, _prevState: TargetActionState, formData: FormData): Promise<TargetActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseTargetForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  if (!(await assertAthleteInOrg(org.id, parsed.values.athleteId))) {
    return { errors: { athleteId: "That athlete isn't on this org's roster." } };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("recruiting_targets")
    .update({
      athlete_id: parsed.values.athleteId,
      school_id: parsed.values.schoolId,
      status: parsed.values.status,
      coach_name: parsed.values.coachName ?? null,
      notes: parsed.values.notes ?? null,
      visit_date: parsed.values.visitDate ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId)
    .eq("org_id", org.id);

  if (error) {
    const message = error.code === "23505" ? "This athlete already has a target for that school." : error.message;
    return { errors: { form: message } };
  }

  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/board`);
}
