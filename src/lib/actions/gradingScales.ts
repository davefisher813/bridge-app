"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { parseGradingScaleForm } from "@/lib/validation/gradingScale";

export interface GradingScaleActionState {
  errors: Record<string, string>;
}

// Unlike createSchool, this does NOT go through the service role and is
// not owner-only. That difference is the whole design: `schools` and
// `high_school_grading_scales` are shared across every org, so a bad
// write there corrupts other organizations and the narrow owner-gated
// service-role door is the price of writing to them at all.
// `org_grading_scales` is org-scoped, so a wrong table here is wrong for
// exactly one org, the same blast radius as an athlete's GPA or a course
// grade that staff already type in. Ordinary RLS is the boundary and
// staff is the right role. See migrations/0009 and docs/DECISIONS.md.
export async function saveGradingScale(
  slug: string,
  scaleId: string | null,
  _prevState: GradingScaleActionState,
  formData: FormData,
): Promise<GradingScaleActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseGradingScaleForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  const v = parsed.values;

  const supabase = await createClient();

  const row = {
    org_id: org.id,
    school_name: v.schoolName,
    bands: v.bands,
    reports_weighted_grades: v.reportsWeightedGrades,
    weighting_is_class_rank_only: v.weightingIsClassRankOnly,
    weight_bonus: v.weightBonus,
    source_note: v.sourceNote,
    entered_by: user.id,
    updated_at: new Date().toISOString(),
  };

  if (scaleId) {
    // Scoped to the org as well as the id. RLS would refuse a row from
    // another org anyway, but a silent zero-row update reads as success
    // to the caller, so the org filter makes the intent explicit and the
    // error below catches the rest.
    const { error } = await supabase.from("org_grading_scales").update(row).eq("id", scaleId).eq("org_id", org.id);
    if (error) return { errors: { form: error.message } };
  } else {
    // Upsert on the same key the table is unique on. Someone entering a
    // scale for a school they already have one for is correcting it, not
    // creating a duplicate, and a raw insert would fail with a
    // constraint message nobody can act on.
    const { error } = await supabase
      .from("org_grading_scales")
      .upsert(row, { onConflict: "org_id,school_name_key" });
    if (error) return { errors: { form: error.message } };
  }

  // The eligibility screens are where this number actually shows up, and
  // they are force-dynamic, but the list here caches.
  revalidatePath(`/org/${slug}/grading-scales`);

  const returnTo = String(formData.get("returnTo") ?? "").trim();
  // Only a path inside this org. A full URL or a path elsewhere would
  // turn a form field into an open redirect.
  const safeReturn = returnTo.startsWith(`/org/${slug}/`) ? returnTo : `/org/${slug}/grading-scales`;
  redirect(safeReturn);
}

export async function deleteGradingScale(slug: string, scaleId: string): Promise<{ ok: boolean; error?: string }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Org not found." };
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { error } = await supabase.from("org_grading_scales").delete().eq("id", scaleId).eq("org_id", org.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${slug}/grading-scales`);
  return { ok: true };
}
