"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { PRESETS, type ScoringPreset } from "@/lib/fit/contract";
import { recomputeFitsForOrg } from "@/lib/data/fits";

// docs/MATCHING_CONTRACT.md section 2: Add to Board on a match row makes
// a target at the Target stage. Section 3: the org's scoring preset and
// Recalculate All, both owner-only.

export async function addMatchToBoard(slug: string, athleteId: string, schoolId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id").eq("id", athleteId).eq("org_id", org.id).is("deleted_at", null).single();
  if (!athlete) redirect(`/org/${slug}/roster`);

  const { data: created, error } = await supabase
    .from("recruiting_targets")
    .insert({ org_id: org.id, athlete_id: athleteId, school_id: schoolId, status: "Target" })
    .select("id")
    .single();
  // Already on the board is not an error worth a screen; land on it.
  if (error && error.code !== "23505") redirect(`/org/${slug}/roster/${athleteId}/matches`);

  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster/${athleteId}/matches`);
  revalidatePath(`/org/${slug}`);
  redirect(created?.id ? `/org/${slug}/board/${created.id}` : `/org/${slug}/roster/${athleteId}/matches`);
}

export interface PresetActionState {
  errors: Record<string, string>;
}

export async function setScoringPreset(slug: string, _prevState: PresetActionState, formData: FormData): Promise<PresetActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const preset = String(formData.get("preset") ?? "") as ScoringPreset;
  if (!(preset in PRESETS)) return { errors: { preset: "Pick a preset" } };

  // orgs is read-only under RLS for everyone; the owner-gated door is the
  // service role, same as the schools table.
  const admin = createAdminClient();
  const { error } = await admin.from("orgs").update({ scoring_preset: preset }).eq("id", org.id);
  if (error) return { errors: { form: error.message } };

  const supabase = await createClient();
  await recomputeFitsForOrg(supabase, org.id);

  revalidatePath(`/org/${slug}`, "layout");
  redirect(`/org/${slug}/more`);
}

export async function recalculateAllMatches(slug: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  // Reports what it did, or that it failed. It used to return silently
  // either way, and a failed rescore after a big import looked exactly
  // like a finished one.
  const supabase = await createClient();
  const { error, count } = await recomputeFitsForOrg(supabase, org.id);

  revalidatePath(`/org/${slug}`, "layout");
  const params = error ? `error=${encodeURIComponent(`The recalculation did not finish: ${error}`)}` : `notice=${encodeURIComponent(`${count} ${count === 1 ? "match" : "matches"} recalculated.`)}`;
  redirect(`/org/${slug}/more?${params}`);
}
