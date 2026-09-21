"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseBudgetDollars } from "@/lib/validation/docaiBudget";

// How much the org may spend on document reading each month. Owner
// only, in whole dollars on the form and cents in the column. Zero turns
// reading off, which is a legitimate setting and not an error.

export interface BudgetActionState {
  errors: Record<string, string>;
}

export async function setDocaiBudget(slug: string, _prev: BudgetActionState, formData: FormData): Promise<BudgetActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const parsed = parseBudgetDollars(formData.get("budget"));
  if (!parsed.ok) return { errors: { budget: parsed.error } };

  // orgs is read-only under RLS; the owner-gated door is the service
  // role, same as the scoring preset.
  const admin = createAdminClient();
  const { error } = await admin.from("orgs").update({ docai_budget_cents: parsed.cents }).eq("id", org.id);
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/more`);
  redirect(`/org/${slug}/more`);
}
