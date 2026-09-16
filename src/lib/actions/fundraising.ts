"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { centsToDecimalString, parseGiftForm, parsePledgeForm } from "@/lib/validation/gift";

export interface FundraisingActionState {
  errors: Record<string, string>;
}

// Every screen behind these actions is gated on
// orgs.modules.donor_fundraising, which is off by default. A server
// action is a public endpoint, so the gate is checked here too rather
// than only where the button renders: a page that never appears for
// Elite Squad is not the same thing as an action they cannot call.
async function requireFundraising(slug: string) {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  if (!org.modules.donor_fundraising) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);
  return { org, user };
}

export async function recordGift(
  slug: string,
  _prevState: FundraisingActionState,
  formData: FormData
): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const parsed = parseGiftForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  const v = parsed.values;

  const supabase = await createClient();

  // A gift can name a donor, a campaign and a pledge, and RLS only
  // proves the GIFT belongs to this org. Each reference is re-fetched
  // scoped to the org before the write, the same guard the target form
  // makes against a cross-org athlete_id.
  for (const [table, id, label] of [
    ["donors", v.donorId, "donor"],
    ["campaigns", v.campaignId, "campaign"],
    ["pledges", v.pledgeId, "pledge"],
  ] as const) {
    if (!id) continue;
    const { data } = await supabase.from(table).select("id").eq("id", id).eq("org_id", org.id).maybeSingle();
    if (!data) return { errors: { form: `That ${label} is not in this organization.` } };
  }

  const { error } = await supabase.from("gifts").insert({
    org_id: org.id,
    donor_id: v.donorId,
    campaign_id: v.campaignId,
    pledge_id: v.pledgeId,
    // Back to a decimal string built from integers, so nothing picks up
    // a floating-point tail between the form and the column.
    amount: centsToDecimalString(v.amountCents),
    received_on: v.receivedOn,
    category: v.category,
    method: v.method,
    in_kind_description: v.inKindDescription,
    external_ref: v.externalRef,
    notes: v.notes,
  });

  if (error) {
    // The unique index on (org_id, external_ref) is what stops a
    // replayed Stripe webhook booking the same donation twice. When
    // somebody hits it by hand, say what it means.
    if (error.code === "23505") {
      return { errors: { externalRef: "A gift with that reference is already recorded. This would be a duplicate." } };
    }
    return { errors: { form: error.message } };
  }

  // If this paid off a pledge completely, close it. Left open, the
  // outstanding figure stays right (it is computed, not stored) but the
  // follow-up list keeps showing a donor who has already paid.
  if (v.pledgeId) await settlePledgeIfPaid(slug, org.id, v.pledgeId);

  revalidatePath(`/org/${slug}/fundraising`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/fundraising`);
}

export async function recordPledge(
  slug: string,
  _prevState: FundraisingActionState,
  formData: FormData
): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const parsed = parsePledgeForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  const v = parsed.values;

  const supabase = await createClient();
  const { data: donor } = await supabase.from("donors").select("id").eq("id", v.donorId).eq("org_id", org.id).maybeSingle();
  if (!donor) return { errors: { donorId: "That donor is not in this organization." } };

  if (v.campaignId) {
    const { data: campaign } = await supabase.from("campaigns").select("id").eq("id", v.campaignId).eq("org_id", org.id).maybeSingle();
    if (!campaign) return { errors: { form: "That campaign is not in this organization." } };
  }

  const { error } = await supabase.from("pledges").insert({
    org_id: org.id,
    donor_id: v.donorId,
    campaign_id: v.campaignId,
    amount: centsToDecimalString(v.amountCents),
    promised_on: v.promisedOn,
    due_on: v.dueOn,
    notes: v.notes,
  });
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/fundraising`);
  redirect(`/org/${slug}/fundraising`);
}

// Marks a pledge fulfilled once its payments cover it. Computed from the
// gift rows rather than tracked as a running balance, for the same
// reason donor totals are: a stored balance drifts the first time a
// payment is corrected.
async function settlePledgeIfPaid(slug: string, orgId: string, pledgeId: string): Promise<void> {
  const supabase = await createClient();
  const [{ data: pledge }, { data: payments }] = await Promise.all([
    supabase.from("pledges").select("id, amount, status").eq("id", pledgeId).eq("org_id", orgId).maybeSingle(),
    supabase.from("gifts").select("amount").eq("pledge_id", pledgeId).eq("org_id", orgId),
  ]);

  const row = pledge as { id: string; amount: number | string; status: string } | null;
  if (!row || row.status !== "open") return;

  const owed = Math.round(Number(row.amount) * 100);
  const paid = (payments ?? []).reduce((s, g) => s + Math.round(Number((g as { amount: number | string }).amount) * 100), 0);
  if (paid < owed) return;

  await supabase
    .from("pledges")
    .update({ status: "fulfilled", updated_at: new Date().toISOString() })
    .eq("id", pledgeId)
    .eq("org_id", orgId);
}

export async function createDonor(
  slug: string,
  _prevState: FundraisingActionState,
  formData: FormData
): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { errors: { name: "A donor needs a name." } };

  const donorType = String(formData.get("donorType") ?? "individual");
  const allowed = ["individual", "board_member", "corporate", "foundation", "other"];
  if (!allowed.includes(donorType)) return { errors: { donorType: "Pick a type." } };

  const supabase = await createClient();
  const { error } = await supabase.from("donors").insert({
    org_id: org.id,
    name,
    donor_type: donorType,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/fundraising/donors`);
  redirect(`/org/${slug}/fundraising/donors`);
}

export async function setBudget(
  slug: string,
  fiscalYear: number,
  _prevState: FundraisingActionState,
  formData: FormData
): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);
  const supabase = await createClient();

  const categories = ["individual", "board", "corporate", "special_event", "grant"] as const;
  const rows = categories.map((category) => ({
    org_id: org.id,
    fiscal_year: fiscalYear,
    category,
    amount: centsToDecimalString(Math.max(0, toCentsFromField(formData.get(`budget_${category}`)))),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("fundraising_budget").upsert(rows, { onConflict: "org_id,fiscal_year,category" });
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/fundraising`);
  redirect(`/org/${slug}/fundraising`);
}

function toCentsFromField(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
