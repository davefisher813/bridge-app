"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { centsToDecimalString, parseGiftForm, parsePledgeForm, type GiftFormValues } from "@/lib/validation/gift";
import { toCents } from "@/lib/fundraising/rollup";
import { nameKey } from "@/lib/lookup/nameKey";
import { isEligibleAdvisor } from "@/lib/org/advisors";
import { activitySummary, logActivity } from "@/lib/data/activity";

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

type Supabase = Awaited<ReturnType<typeof createClient>>;

// A gift can name a donor, a campaign, a pledge and a board member, and
// RLS only proves the GIFT belongs to this org. Each reference is
// re-fetched scoped to the org before the write, the same guard the
// target form makes against a cross-org athlete_id. Shared by record and
// edit, so an edit cannot point a gift at another org's pledge either.
async function checkGiftReferences(supabase: Supabase, orgId: string, v: GiftFormValues): Promise<string | null> {
  for (const [table, id, label] of [
    ["donors", v.donorId, "donor"],
    ["campaigns", v.campaignId, "campaign"],
    ["pledges", v.pledgeId, "pledge"],
    // A board member from another org would credit somebody else's
    // give/get, which RLS on the gift alone does not prevent.
    ["board_members", v.solicitedBy, "board member"],
  ] as const) {
    if (!id) continue;
    const { data } = await supabase.from(table).select("id").eq("id", id).eq("org_id", orgId).maybeSingle();
    if (!data) return `That ${label} is not in this organization.`;
  }
  return null;
}

function giftRow(v: GiftFormValues) {
  return {
    donor_id: v.donorId,
    campaign_id: v.campaignId,
    pledge_id: v.pledgeId,
    solicited_by: v.solicitedBy,
    // Back to a decimal string built from integers, so nothing picks up
    // a floating-point tail between the form and the column.
    amount: centsToDecimalString(v.amountCents),
    received_on: v.receivedOn,
    category: v.category,
    method: v.method,
    in_kind_description: v.inKindDescription,
    external_ref: v.externalRef,
    notes: v.notes,
  };
}

function revalidateMoney(slug: string) {
  revalidatePath(`/org/${slug}/fundraising`);
  revalidatePath(`/org/${slug}`);
  revalidatePath(`/org/${slug}/fundraising/gifts`);
  revalidatePath(`/org/${slug}/fundraising/pledges`);
  revalidatePath(`/org/${slug}/fundraising/donors`);
  revalidatePath(`/org/${slug}/board-governance`);
}

const note = (s: string) => `notice=${encodeURIComponent(s)}`;
const oops = (s: string) => `error=${encodeURIComponent(s)}`;

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
  const refError = await checkGiftReferences(supabase, org.id, v);
  if (refError) return { errors: { form: refError } };

  const { error } = await supabase.from("gifts").insert({ org_id: org.id, ...giftRow(v) });

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
  if (v.pledgeId) await resettlePledge(org.id, v.pledgeId);

  revalidatePath(`/org/${slug}/fundraising`);
  revalidatePath(`/org/${slug}`);
  revalidatePath(`/org/${slug}/fundraising/gifts`);
  redirect(`/org/${slug}/fundraising/gifts`);
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
  revalidatePath(`/org/${slug}/fundraising/pledges`);
  redirect(`/org/${slug}/fundraising/pledges`);
}

// A pledge's status from its payments: fulfilled once they cover it,
// open again if an edited or removed payment means they no longer do.
// Computed from the gift rows rather than tracked as a running balance,
// for the same reason donor totals are: a stored balance drifts the
// first time a payment is corrected. A written-off pledge stays written
// off; that is somebody's decision, not arithmetic.
async function resettlePledge(orgId: string, pledgeId: string): Promise<void> {
  const supabase = await createClient();
  const [{ data: pledge }, { data: payments }] = await Promise.all([
    supabase.from("pledges").select("id, amount, status").eq("id", pledgeId).eq("org_id", orgId).maybeSingle(),
    supabase.from("gifts").select("amount").eq("pledge_id", pledgeId).eq("org_id", orgId),
  ]);

  const row = pledge as { id: string; amount: number | string; status: string } | null;
  if (!row || row.status === "written_off") return;

  const owed = toCents(row.amount);
  const paid = (payments ?? []).reduce((s, g) => s + toCents((g as { amount: number | string }).amount), 0);
  const next = paid >= owed ? "fulfilled" : "open";
  if (next === row.status) return;

  await supabase
    .from("pledges")
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq("id", pledgeId)
    .eq("org_id", orgId);
}

// Edit a gift (audit crud F10): the same checks as recording one, scoped
// to this org by id, and the pledges it paid down, before and after,
// settle again. A mistyped amount no longer skews a donor's total
// forever.
export async function updateGift(slug: string, giftId: string, _prevState: FundraisingActionState, formData: FormData): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const parsed = parseGiftForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  const v = parsed.values;

  const supabase = await createClient();
  const { data: before } = await supabase.from("gifts").select("id, pledge_id").eq("id", giftId).eq("org_id", org.id).maybeSingle();
  if (!before) return { errors: { form: "That gift is not in this organization." } };

  const refError = await checkGiftReferences(supabase, org.id, v);
  if (refError) return { errors: { form: refError } };

  const { error } = await supabase
    .from("gifts")
    .update({ ...giftRow(v), updated_at: new Date().toISOString() })
    .eq("id", giftId)
    .eq("org_id", org.id);
  if (error) {
    if (error.code === "23505") return { errors: { externalRef: "Another gift already has that reference." } };
    return { errors: { form: error.message } };
  }

  const oldPledge = (before as { pledge_id: string | null }).pledge_id;
  for (const pledgeId of new Set([oldPledge, v.pledgeId])) if (pledgeId) await resettlePledge(org.id, pledgeId);

  revalidateMoney(slug);
  redirect(`/org/${slug}/fundraising/gifts?${note("Gift saved.")}`);
}

// Remove a gift entered by mistake. A refund is a negative gift, which
// keeps the history; this is for a row that should never have existed.
export async function removeGift(slug: string, giftId: string): Promise<void> {
  const { org } = await requireFundraising(slug);

  const supabase = await createClient();
  const { data: gift } = await supabase.from("gifts").select("id, pledge_id").eq("id", giftId).eq("org_id", org.id).maybeSingle();
  if (!gift) redirect(`/org/${slug}/fundraising/gifts?${oops("That gift is already gone.")}`);

  const { error } = await supabase.from("gifts").delete().eq("id", giftId).eq("org_id", org.id);
  if (error) redirect(`/org/${slug}/fundraising/gifts/${giftId}/edit?${oops(`Could not remove it: ${error.message}`)}`);

  const pledgeId = (gift as { pledge_id: string | null }).pledge_id;
  if (pledgeId) await resettlePledge(org.id, pledgeId);

  revalidateMoney(slug);
  redirect(`/org/${slug}/fundraising/gifts?${note("Gift removed.")}`);
}

// Edit a pledge: who, how much, when, the campaign, and whether it is
// still being chased or written off. Fulfilled is not a choice: it
// follows from the payments.
export async function updatePledge(slug: string, pledgeId: string, _prevState: FundraisingActionState, formData: FormData): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const parsed = parsePledgeForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  const v = parsed.values;

  const writtenOff = String(formData.get("status") ?? "open") === "written_off";

  const supabase = await createClient();
  const { data: before } = await supabase.from("pledges").select("id").eq("id", pledgeId).eq("org_id", org.id).maybeSingle();
  if (!before) return { errors: { form: "That pledge is not in this organization." } };
  const { data: donor } = await supabase.from("donors").select("id").eq("id", v.donorId).eq("org_id", org.id).maybeSingle();
  if (!donor) return { errors: { donorId: "That donor is not in this organization." } };
  if (v.campaignId) {
    const { data: campaign } = await supabase.from("campaigns").select("id").eq("id", v.campaignId).eq("org_id", org.id).maybeSingle();
    if (!campaign) return { errors: { form: "That campaign is not in this organization." } };
  }

  const { error } = await supabase
    .from("pledges")
    .update({
      donor_id: v.donorId,
      campaign_id: v.campaignId,
      amount: centsToDecimalString(v.amountCents),
      promised_on: v.promisedOn,
      due_on: v.dueOn,
      notes: v.notes,
      // Open here; resettlePledge moves it to fulfilled if the payments
      // already cover the (possibly smaller) amount.
      status: writtenOff ? "written_off" : "open",
      updated_at: new Date().toISOString(),
    })
    .eq("id", pledgeId)
    .eq("org_id", org.id);
  if (error) return { errors: { form: error.message } };
  if (!writtenOff) await resettlePledge(org.id, pledgeId);

  revalidateMoney(slug);
  redirect(`/org/${slug}/fundraising/pledges?${note("Pledge saved.")}`);
}

export async function removePledge(slug: string, pledgeId: string): Promise<void> {
  const { org } = await requireFundraising(slug);

  const supabase = await createClient();
  const { data: pledge } = await supabase.from("pledges").select("id").eq("id", pledgeId).eq("org_id", org.id).maybeSingle();
  if (!pledge) redirect(`/org/${slug}/fundraising/pledges?${oops("That pledge is already gone.")}`);

  // Payments against it stay as gifts; the database unlinks them.
  const { error } = await supabase.from("pledges").delete().eq("id", pledgeId).eq("org_id", org.id);
  if (error) redirect(`/org/${slug}/fundraising/pledges/${pledgeId}/edit?${oops(`Could not remove it: ${error.message}`)}`);

  revalidateMoney(slug);
  redirect(`/org/${slug}/fundraising/pledges?${note("Pledge removed.")}`);
}

// The donor fields, shared by add and edit.
const DONOR_TYPES = ["individual", "board_member", "corporate", "foundation", "other"];

function readDonorForm(formData: FormData): { row: Record<string, string | null> } | { errors: Record<string, string> } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { errors: { name: "A donor needs a name." } };
  const donorType = String(formData.get("donorType") ?? "individual");
  if (!DONOR_TYPES.includes(donorType)) return { errors: { donorType: "Pick a type." } };
  return {
    row: {
      name,
      donor_type: donorType,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  };
}

export async function createDonor(
  slug: string,
  _prevState: FundraisingActionState,
  formData: FormData
): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const parsed = readDonorForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("donors")
    .insert({ org_id: org.id, ...parsed.row })
    .select("id")
    .single();
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/fundraising/donors`);
  redirect(created?.id ? `/org/${slug}/fundraising/donors/${created.id}` : `/org/${slug}/fundraising/donors`);
}

// Edit a donor's details (audit crud F10). Their gifts and pledges are
// untouched; totals are derived from those, never stored here.
export async function updateDonor(slug: string, donorId: string, _prevState: FundraisingActionState, formData: FormData): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const parsed = readDonorForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("donors")
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq("id", donorId)
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { errors: { form: error.message } };
  if (!data || data.length === 0) return { errors: { form: "That donor is not in this organization." } };

  revalidateMoney(slug);
  redirect(`/org/${slug}/fundraising/donors/${donorId}?${note("Donor saved.")}`);
}

// Who stewards a donor (donors.steward_user_id, migration 0012). Until
// now the column existed and nothing could see or set it; Dave's standing
// rule (2026-10-06) is that every assignment is a setting an Admin sees,
// changes and undoes in the app. The steward is an Admin of this org,
// the same rule as an athlete's advisor; an empty value clears. Logged,
// and the notice offers Undo back to whoever it was before.
export async function setDonorSteward(slug: string, donorId: string, formData: FormData): Promise<void> {
  const { org, user } = await requireFundraising(slug);
  const back = `/org/${slug}/fundraising/donors/${donorId}`;
  const stewardId = String(formData.get("stewardId") ?? "").trim() || null;

  const supabase = await createClient();
  const { data: donor } = await supabase.from("donors").select("id, name, steward_user_id").eq("id", donorId).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!donor) redirect(`/org/${slug}/fundraising/donors?${oops("That donor is not in this organization.")}`);
  const d = donor as { name: string; steward_user_id: string | null };
  if (stewardId && !(await isEligibleAdvisor(supabase, org.id, stewardId))) redirect(`${back}?${oops("Only an Admin of this organization can steward a donor.")}`);
  if (d.steward_user_id === stewardId) redirect(back);

  const { error } = await supabase.from("donors").update({ steward_user_id: stewardId }).eq("id", donorId).eq("org_id", org.id);
  if (error) redirect(`${back}?${oops(`Could not change the steward: ${error.message}`)}`);

  let stewardName = "";
  if (stewardId) {
    const { data: person } = await supabase.from("users").select("full_name, email").eq("id", stewardId).maybeSingle();
    const p = person as { full_name: string | null; email: string | null } | null;
    stewardName = p?.full_name || p?.email || "";
  }
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    action: stewardId ? "steward_set" : "steward_cleared",
    subjectType: "donor",
    subjectId: donorId,
    summary: stewardId ? activitySummary("steward_set", { name: d.name, person: stewardName }) : activitySummary("steward_cleared", { name: d.name }),
  });

  revalidatePath(back);
  redirect(`${back}?${note(stewardId ? "Steward set." : "Steward cleared.")}&undo=${d.steward_user_id ?? "none"}`);
}

// Remove a donor from the address book. A soft delete (deleted_at, which
// every donor list already filters): their gifts stay in every total,
// because the money was real, and a pledge or a board seat that names
// them keeps its history.
export async function removeDonor(slug: string, donorId: string): Promise<void> {
  const { org } = await requireFundraising(slug);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("donors")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", donorId)
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .select("id");
  if (error) redirect(`/org/${slug}/fundraising/donors/${donorId}/edit?${oops(`Could not remove the donor: ${error.message}`)}`);
  if (!data || data.length === 0) redirect(`/org/${slug}/fundraising/donors?${oops("That donor is already gone.")}`);

  revalidateMoney(slug);
  redirect(`/org/${slug}/fundraising/donors?${note("Donor removed. Their gifts still count in the totals.")}`);
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
  const rows = [];
  const errors: Record<string, string> = {};

  for (const category of categories) {
    const raw = String(formData.get(`budget_${category}`) ?? "").trim();
    const cents = raw === "" ? 0 : toCents(raw);
    // A blank is zero, which means no target. Text that is not a number
    // is a mistake, and silently filing it as zero would set a target of
    // nothing without saying so.
    if (raw !== "" && cents === 0 && !/^[$,.\s0]+$/.test(raw)) {
      errors[`budget_${category}`] = "That does not look like an amount.";
      continue;
    }
    if (cents < 0) {
      errors[`budget_${category}`] = "A budget cannot be negative.";
      continue;
    }
    rows.push({
      org_id: org.id,
      fiscal_year: fiscalYear,
      category,
      amount: centsToDecimalString(cents),
      updated_at: new Date().toISOString(),
    });
  }

  if (Object.keys(errors).length > 0) return { errors };

  const { error } = await supabase.from("fundraising_budget").upsert(rows, { onConflict: "org_id,fiscal_year,category" });
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/fundraising`);
  redirect(`/org/${slug}/fundraising`);
}

function readCampaignForm(formData: FormData): { row: Record<string, string | null> } | { errors: Record<string, string> } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { errors: { name: "A campaign needs a name." } };

  const kind = String(formData.get("kind") ?? "other");
  if (!["event", "appeal", "grant", "other"].includes(kind)) return { errors: { kind: "Pick a kind." } };

  const startsOn = String(formData.get("startsOn") ?? "").trim() || null;
  const endsOn = String(formData.get("endsOn") ?? "").trim() || null;
  if (startsOn && endsOn && endsOn < startsOn) {
    return { errors: { endsOn: "The end date is before the start." } };
  }

  const rawGoal = String(formData.get("goalAmount") ?? "").trim();
  const goalCents = rawGoal === "" ? null : toCents(rawGoal);
  if (goalCents !== null && goalCents < 0) return { errors: { goalAmount: "A goal cannot be negative." } };

  return {
    row: {
      name,
      kind,
      starts_on: startsOn,
      ends_on: endsOn,
      // Null, not zero. No goal set and a goal of nothing are different,
      // and the overview says "no goal" for the first rather than
      // dividing by the second.
      goal_amount: goalCents === null ? null : centsToDecimalString(goalCents),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  };
}

export async function createCampaign(
  slug: string,
  _prevState: FundraisingActionState,
  formData: FormData
): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const parsed = readCampaignForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("campaigns")
    .insert({ org_id: org.id, ...parsed.row })
    .select("id")
    .single();
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/fundraising`);
  redirect(created?.id ? `/org/${slug}/fundraising/campaigns/${created.id}` : `/org/${slug}/fundraising`);
}

export async function updateCampaign(slug: string, campaignId: string, _prevState: FundraisingActionState, formData: FormData): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const parsed = readCampaignForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("org_id", org.id)
    .select("id");
  if (error) return { errors: { form: error.message } };
  if (!data || data.length === 0) return { errors: { form: "That campaign is not in this organization." } };

  revalidateMoney(slug);
  redirect(`/org/${slug}/fundraising/campaigns/${campaignId}?${note("Campaign saved.")}`);
}

// Remove a campaign. Gifts, pledges and grants that named it stay, with
// no campaign: the database unlinks them, and the money still counts.
export async function removeCampaign(slug: string, campaignId: string): Promise<void> {
  const { org } = await requireFundraising(slug);

  const supabase = await createClient();
  const { data: campaign } = await supabase.from("campaigns").select("id").eq("id", campaignId).eq("org_id", org.id).maybeSingle();
  if (!campaign) redirect(`/org/${slug}/fundraising?${oops("That campaign is already gone.")}`);

  const { error } = await supabase.from("campaigns").delete().eq("id", campaignId).eq("org_id", org.id);
  if (error) redirect(`/org/${slug}/fundraising/campaigns/${campaignId}/edit?${oops(`Could not remove it: ${error.message}`)}`);

  revalidateMoney(slug);
  redirect(`/org/${slug}/fundraising?${note("Campaign removed. Its gifts still count.")}`);
}

// The grant fields, shared by track and edit. A funder whose name is
// exactly one donor's is linked to that donor record (Stage 4, B8): the
// form suggests donor names, and a pick is remembered as the link.
const GRANT_STATUSES = ["researching", "applied", "pending", "awarded", "declined", "closed"];

async function readGrantForm(supabase: Supabase, orgId: string, formData: FormData): Promise<{ row: Record<string, string | null> } | { errors: Record<string, string> }> {
  const funderName = String(formData.get("funderName") ?? "").trim();
  if (!funderName) return { errors: { funderName: "Who is the funder?" } };

  const status = String(formData.get("status") ?? "researching");
  if (!GRANT_STATUSES.includes(status)) return { errors: { status: "Pick where it stands." } };

  const money = (field: string): string | null => {
    const raw = String(formData.get(field) ?? "").trim();
    if (raw === "") return null;
    const cents = toCents(raw);
    return cents <= 0 ? null : centsToDecimalString(cents);
  };

  const date = (field: string): string | null => String(formData.get(field) ?? "").trim() || null;

  const amountAwarded = money("amountAwarded");
  // An awarded grant with no amount is a status nobody can report on,
  // and the amount is the first thing anyone asks about it.
  if (status === "awarded" && !amountAwarded) {
    return { errors: { amountAwarded: "An awarded grant needs the amount awarded." } };
  }

  const { data: donorRows } = await supabase.from("donors").select("id, name").eq("org_id", orgId).is("deleted_at", null);
  const same = ((donorRows ?? []) as { id: string; name: string }[]).filter((d) => nameKey(d.name) === nameKey(funderName));

  return {
    row: {
      funder_name: funderName,
      donor_id: same.length === 1 ? same[0]!.id : null,
      status,
      amount_requested: money("amountRequested"),
      amount_awarded: status === "awarded" ? amountAwarded : null,
      deadline_on: date("deadlineOn"),
      applied_on: date("appliedOn"),
      decision_expected_on: date("decisionExpectedOn"),
      report_due_on: date("reportDueOn"),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  };
}

export async function trackGrant(
  slug: string,
  _prevState: FundraisingActionState,
  formData: FormData
): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const supabase = await createClient();
  const parsed = await readGrantForm(supabase, org.id, formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const { error } = await supabase.from("grants").insert({ org_id: org.id, ...parsed.row });
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/fundraising/grants`);
  redirect(`/org/${slug}/fundraising/grants`);
}

// Edit a grant, status included (audit crud F10): researching, applied,
// awaiting decision, awarded and so on, moved forward as it happens.
export async function updateGrant(slug: string, grantId: string, _prevState: FundraisingActionState, formData: FormData): Promise<FundraisingActionState> {
  const { org } = await requireFundraising(slug);

  const supabase = await createClient();
  const parsed = await readGrantForm(supabase, org.id, formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const { data, error } = await supabase
    .from("grants")
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq("id", grantId)
    .eq("org_id", org.id)
    .select("id");
  if (error) return { errors: { form: error.message } };
  if (!data || data.length === 0) return { errors: { form: "That grant is not in this organization." } };

  revalidatePath(`/org/${slug}/fundraising/grants`);
  revalidatePath(`/org/${slug}/fundraising`);
  redirect(`/org/${slug}/fundraising/grants?${note("Grant saved.")}`);
}

export async function removeGrant(slug: string, grantId: string): Promise<void> {
  const { org } = await requireFundraising(slug);

  const supabase = await createClient();
  const { data: grant } = await supabase.from("grants").select("id").eq("id", grantId).eq("org_id", org.id).maybeSingle();
  if (!grant) redirect(`/org/${slug}/fundraising/grants?${oops("That grant is already gone.")}`);

  // Money it brought in is a gift row of its own and stays.
  const { error } = await supabase.from("grants").delete().eq("id", grantId).eq("org_id", org.id);
  if (error) redirect(`/org/${slug}/fundraising/grants/${grantId}/edit?${oops(`Could not remove it: ${error.message}`)}`);

  revalidatePath(`/org/${slug}/fundraising/grants`);
  revalidatePath(`/org/${slug}/fundraising`);
  redirect(`/org/${slug}/fundraising/grants?${note("Grant removed.")}`);
}
