import { orgToday } from "@/lib/datetime/today";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { removePledge, updatePledge } from "@/lib/actions/fundraising";
import { PledgeForm } from "@/components/FundraisingForms";
import { loadSeatOptions } from "@/lib/data/seatOptions";
import { formatMoney, toCents } from "@/lib/fundraising/rollup";
import { longDate } from "@/lib/copy/dates";
import { centsToDecimalString } from "@/lib/validation/gift";
import { Body, Card, Chevron, ConfirmButton, Form, Label, Notice, Row, Screen, Section } from "@/components/kit";

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
    supabase.from("pledges").select("id, donor_id, campaign_id, solicited_by, amount, promised_on, due_on, status, notes").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("donors").select("id, name, deleted_at").eq("org_id", org.id).order("name"),
    supabase.from("campaigns").select("id, name").eq("org_id", org.id).order("name"),
  ]);
  if (!data) notFound();
  const p = data as { id: string; donor_id: string; campaign_id: string | null; solicited_by: string | null; amount: number | string; promised_on: string; due_on: string | null; status: string; notes: string | null };
  const donors = ((donorRows ?? []) as { id: string; name: string; deleted_at: string | null }[]).filter((d) => !d.deleted_at || d.id === p.donor_id).map((d) => ({ id: d.id, name: d.name }));
  const boardMembers = await loadSeatOptions(supabase, org, p.solicited_by);
  const who = donors.find((d) => d.id === p.donor_id)?.name ?? "Pledge";

  // Payments applied (live test F1): the gifts recorded against this
  // pledge, what they add up to, what is left, and this donor's other
  // gifts that no pledge claims yet, each one tap from linking.
  const { data: giftRows } = await supabase.from("gifts").select("id, amount, received_on, pledge_id").eq("org_id", org.id).eq("donor_id", p.donor_id).order("received_on", { ascending: false });
  const donorGifts = ((giftRows ?? []) as { id: string; amount: number | string; received_on: string; pledge_id: string | null }[]).map((g) => ({ id: g.id, cents: toCents(g.amount), on: g.received_on, pledgeId: g.pledge_id }));
  const applied = donorGifts.filter((g) => g.pledgeId === p.id);
  const unlinked = donorGifts.filter((g) => g.pledgeId === null);
  const promisedCents = toCents(p.amount);
  const appliedCents = applied.reduce((sum, g) => sum + g.cents, 0);
  const remainingCents = p.status === "written_off" || p.status === "fulfilled" ? 0 : Math.max(0, promisedCents - appliedCents);

  return (
    <Screen title="Edit Pledge" back={{ href: `/org/${slug}/fundraising/pledges`, label: "Pledges" }} lede={who}>
      {error && <Notice tone="danger" title={error} />}
      <PledgeForm
        action={updatePledge.bind(null, slug, p.id)}
        donors={donors}
        campaigns={(campaignRows ?? []) as Array<{ id: string; name: string }>}
        boardMembers={boardMembers}
        today={orgToday()}
        submitLabel="Save Pledge"
        initial={{ donorId: p.donor_id, amount: centsToDecimalString(toCents(p.amount)), promisedOn: p.promised_on, dueOn: p.due_on, campaignId: p.campaign_id, solicitedBy: p.solicited_by, notes: p.notes, status: p.status }}
      />
      <Section label="Payments" role="committed" kind="money">
        <Card isStatic>
          <Body weight="semibold">{`${formatMoney(remainingCents)} remaining`}</Body>
          <Label>{`${formatMoney(promisedCents)} promised · ${formatMoney(appliedCents)} applied from ${applied.length} ${applied.length === 1 ? "gift" : "gifts"}`}</Label>
        </Card>
        {applied.map((g) => (
          <Row key={g.id} href={`/org/${slug}/fundraising/gifts/${g.id}/edit`} kind="money" role="committed" title={formatMoney(g.cents)} meta={longDate(g.on)} trailing={<Chevron />} wrap />
        ))}
        {unlinked.length > 0 && (
          <Label>{`${unlinked.length} other ${unlinked.length === 1 ? "gift" : "gifts"} from this donor ${unlinked.length === 1 ? "is" : "are"} not applied to any pledge. Open one and choose this pledge to apply it.`}</Label>
        )}
        {unlinked.map((g) => (
          <Row key={g.id} href={`/org/${slug}/fundraising/gifts/${g.id}/edit`} kind="money" role="contact" title={formatMoney(g.cents)} meta={`${longDate(g.on)} · Not applied to a pledge`} trailing={<Chevron />} wrap />
        ))}
      </Section>
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
