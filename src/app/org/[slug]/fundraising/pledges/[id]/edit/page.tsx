import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { removePledge, updatePledge } from "@/lib/actions/fundraising";
import { PledgeForm } from "@/components/FundraisingForms";
import { toCents } from "@/lib/fundraising/rollup";
import { centsToDecimalString } from "@/lib/validation/gift";
import { ConfirmButton, Form, Notice, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

// Edit Pledge (audit crud F10): who, how much, when, and whether it is
// still expected. Paid in full follows from the payments. Remove is
// behind a confirm; payments against it stay as gifts.
export default async function EditPledgePage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data }, { data: donorRows }, { data: campaignRows }] = await Promise.all([
    supabase.from("pledges").select("id, donor_id, campaign_id, amount, promised_on, due_on, status, notes").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("donors").select("id, name, deleted_at").eq("org_id", org.id).order("name"),
    supabase.from("campaigns").select("id, name").eq("org_id", org.id).order("name"),
  ]);
  if (!data) notFound();
  const p = data as { id: string; donor_id: string; campaign_id: string | null; amount: number | string; promised_on: string; due_on: string | null; status: string; notes: string | null };
  const donors = ((donorRows ?? []) as { id: string; name: string; deleted_at: string | null }[]).filter((d) => !d.deleted_at || d.id === p.donor_id).map((d) => ({ id: d.id, name: d.name }));
  const who = donors.find((d) => d.id === p.donor_id)?.name ?? "Pledge";

  return (
    <Screen title="Edit Pledge" back={{ href: `/org/${slug}/fundraising/pledges`, label: "Pledges" }} lede={who}>
      {error && <Notice tone="danger" title={error} />}
      <PledgeForm
        action={updatePledge.bind(null, slug, p.id)}
        donors={donors}
        campaigns={(campaignRows ?? []) as Array<{ id: string; name: string }>}
        today={new Date().toISOString().slice(0, 10)}
        submitLabel="Save Pledge"
        initial={{ donorId: p.donor_id, amount: centsToDecimalString(toCents(p.amount)), promisedOn: p.promised_on, dueOn: p.due_on, campaignId: p.campaign_id, notes: p.notes, status: p.status }}
      />
      <Section label="Remove" role="danger" kind="blocked">
        <Form action={removePledge.bind(null, slug, p.id)}>
          <ConfirmButton title="Remove This Pledge?" body="The promise goes. Any payments already made against it stay as gifts and still count." confirmLabel="Remove">
            Remove Pledge
          </ConfirmButton>
        </Form>
      </Section>
    </Screen>
  );
}
