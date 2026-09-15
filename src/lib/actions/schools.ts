"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSchoolForm, parseSportsSponsored } from "@/lib/validation/school";

export interface SchoolActionState {
  errors: Record<string, string>;
}

// schools is shared reference data across every org (see the RLS comment
// in migrations/0001_core_schema.sql and docs/ARCHITECTURE.md) and has no
// INSERT policy at all - deliberately, so no org can silently corrupt
// another org's shared list through ordinary RLS-scoped writes. Rather
// than reopen that policy, this action is the one deliberate, owner-gated
// door into it: requireOwner() is the actual authorization check (RLS
// can't help here, since the admin client bypasses it entirely), then the
// write goes through the service-role client. Any coach or staff-role
// user hitting this action directly still gets refused by requireOwner
// before the admin client is ever touched. See docs/DECISIONS.md.
export async function createSchool(slug: string, _prevState: SchoolActionState, formData: FormData): Promise<SchoolActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const parsed = parseSchoolForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const admin = createAdminClient();
  const { error } = await admin.from("schools").insert({
    name: parsed.values.name,
    division: parsed.values.division,
    conference: parsed.values.conference ?? null,
    sports_sponsored: parseSportsSponsored(parsed.values.sportsSponsored),
  });

  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/board/new`);
  redirect(`/org/${slug}/board/new`);
}
