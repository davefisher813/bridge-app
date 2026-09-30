"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireDirectoryEditor } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseTransferWindowForm } from "@/lib/validation/transferWindow";
import { requireNotViewing } from "@/lib/data/viewAs";

// Transfer portal windows are shared reference data, like schools: every
// org reads them and the table has no write policy, so a directory
// editor (an owner of an org with orgs.edits_shared_directory on,
// migration 0040) writes through the service role behind
// requireDirectoryEditor(). The fit engine reports
// transfer timing as unverified when no window row matches, which is
// exactly why an owner needs a way to enter one, and to correct one
// (crud F22): a wrong date used to mean removing the window and typing
// it again.

export interface TransferWindowActionState {
  errors: Record<string, string>;
  values?: Record<string, FormDataEntryValue>;
}

const DUPLICATE = "That window is already on file for this sport, division and season.";
const NOTES_MAX = 4000;

// Free text on the window (migration 0040): a conference exception, a
// note about which students it covers. Blank is null; the column is
// capped at 4000 in the database too.
function notesFrom(formData: FormData): { notes: string | null; error?: string } {
  const raw = String(formData.get("notes") ?? "").trim();
  if (!raw) return { notes: null };
  if (raw.length > NOTES_MAX) return { notes: null, error: `Keep it under ${NOTES_MAX} characters` };
  return { notes: raw };
}

export async function createTransferWindow(slug: string, _prev: TransferWindowActionState, formData: FormData): Promise<TransferWindowActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const parsed = parseTransferWindowForm(formData);
  const notes = notesFrom(formData);
  if (!parsed.ok || !parsed.values || notes.error) {
    return { errors: { ...parsed.errors, ...(notes.error ? { notes: notes.error } : {}) }, values: Object.fromEntries(formData.entries()) };
  }
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
    return { errors: { windowLabel: DUPLICATE }, values: Object.fromEntries(formData.entries()) };
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
    notes: notes.notes,
  });
  if (error) {
    // Two owners entering the same window at the same moment both read
    // nothing above and both write; migration 0032's unique index is
    // what actually holds, and the loser reads the same sentence as if
    // the check had caught it.
    const duplicate = /duplicate key|unique constraint|transfer_windows_unique_idx/i.test(error.message);
    if (duplicate) return { errors: { windowLabel: DUPLICATE }, values: Object.fromEntries(formData.entries()) };
    return { errors: { form: error.message }, values: Object.fromEntries(formData.entries()) };
  }

  revalidatePath(`/org/${slug}/transfer-windows`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/transfer-windows?notice=${encodeURIComponent("Window added. Every transfer's timing reads it from now on.")}`);
}

// Correcting a window in place. The same parse and the same duplicate
// sentence as adding one, with the window itself left out of the
// duplicate check. Stored matches read the window live through the
// engine's timing, so nothing is recomputed here, the same as adding.
export async function updateTransferWindow(slug: string, windowId: string, _prev: TransferWindowActionState, formData: FormData): Promise<TransferWindowActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const parsed = parseTransferWindowForm(formData);
  const notes = notesFrom(formData);
  if (!parsed.ok || !parsed.values || notes.error) {
    return { errors: { ...parsed.errors, ...(notes.error ? { notes: notes.error } : {}) }, values: Object.fromEntries(formData.entries()) };
  }
  const v = parsed.values;

  const supabase = await createClient();
  const { data: clash } = await supabase
    .from("transfer_windows")
    .select("id")
    .eq("sport", v.sport)
    .eq("division", v.division)
    .eq("season_year", v.seasonYear)
    .eq("window_label", v.windowLabel)
    .neq("id", windowId)
    .maybeSingle();
  if (clash) return { errors: { windowLabel: DUPLICATE }, values: Object.fromEntries(formData.entries()) };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("transfer_windows")
    .update({
      sport: v.sport,
      division: v.division,
      season_year: v.seasonYear,
      window_label: v.windowLabel,
      opens_on: v.opensOn,
      closes_on: v.closesOn,
      source_url: v.sourceUrl,
      notes: notes.notes,
    })
    .eq("id", windowId)
    .select("id");
  if (error) {
    const duplicate = /duplicate key|unique constraint|transfer_windows_unique_idx/i.test(error.message);
    if (duplicate) return { errors: { windowLabel: DUPLICATE }, values: Object.fromEntries(formData.entries()) };
    return { errors: { form: error.message }, values: Object.fromEntries(formData.entries()) };
  }
  if (!updated || updated.length === 0) return { errors: { form: "That window is no longer on file." }, values: Object.fromEntries(formData.entries()) };

  revalidatePath(`/org/${slug}/transfer-windows`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/transfer-windows?notice=${encodeURIComponent("Window saved.")}`);
}

export async function deleteTransferWindow(slug: string, windowId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const admin = createAdminClient();
  const { error } = await admin.from("transfer_windows").delete().eq("id", windowId);
  revalidatePath(`/org/${slug}/transfer-windows`);
  revalidatePath(`/org/${slug}`);
  if (error) redirect(`/org/${slug}/transfer-windows?error=${encodeURIComponent(error.message)}`);
  redirect(`/org/${slug}/transfer-windows?notice=${encodeURIComponent("Window removed.")}`);
}
