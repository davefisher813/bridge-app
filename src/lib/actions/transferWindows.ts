"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseTransferWindowForm } from "@/lib/validation/transferWindow";

// Transfer portal windows are shared reference data, like schools: every
// org reads them and the table has no write policy, so an owner writes
// through the service role behind requireOwner(). The fit engine reports
// transfer timing as unverified when no window row matches, which is
// exactly why an owner needs a way to enter one.

export interface TransferWindowActionState {
  errors: Record<string, string>;
  values?: Record<string, FormDataEntryValue>;
}

export async function createTransferWindow(slug: string, _prev: TransferWindowActionState, formData: FormData): Promise<TransferWindowActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const parsed = parseTransferWindowForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors, values: Object.fromEntries(formData.entries()) };
  const v = parsed.values;

  // The same window entered twice would double every timing answer the
  // fit engine gives for that sport and division. Migration 0032's
  // unique index is the rule; this read is what turns it into a
  // sentence on the field rather than a database error.
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("transfer_windows")
    .select("id")
    .eq("sport", v.sport)
    .eq("division", v.division)
    .eq("season_year", v.seasonYear)
    .eq("window_label", v.windowLabel)
    .maybeSingle();
  if (existing) {
    return { errors: { windowLabel: "That window is already on file for this sport, division and season." }, values: Object.fromEntries(formData.entries()) };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("transfer_windows").insert({
    sport: v.sport,
    division: v.division,
    season_year: v.seasonYear,
    window_label: v.windowLabel,
    opens_on: v.opensOn,
    closes_on: v.closesOn,
    source_url: v.sourceUrl,
  });
  if (error) {
    // Two owners entering the same window at the same moment both read
    // nothing above and both write; migration 0032's unique index is
    // what actually holds, and the loser reads the same sentence as if
    // the check had caught it.
    const duplicate = /duplicate key|unique constraint|transfer_windows_unique_idx/i.test(error.message);
    if (duplicate) return { errors: { windowLabel: "That window is already on file for this sport, division and season." }, values: Object.fromEntries(formData.entries()) };
    return { errors: { form: error.message }, values: Object.fromEntries(formData.entries()) };
  }

  revalidatePath(`/org/${slug}/transfer-windows`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/transfer-windows?notice=${encodeURIComponent("Window added. Every transfer's timing reads it from now on.")}`);
}

export async function deleteTransferWindow(slug: string, windowId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const admin = createAdminClient();
  const { error } = await admin.from("transfer_windows").delete().eq("id", windowId);
  revalidatePath(`/org/${slug}/transfer-windows`);
  revalidatePath(`/org/${slug}`);
  if (error) redirect(`/org/${slug}/transfer-windows?error=${encodeURIComponent(error.message)}`);
  redirect(`/org/${slug}/transfer-windows?notice=${encodeURIComponent("Window removed.")}`);
}
