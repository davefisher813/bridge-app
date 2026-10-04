// Every campaign the org runs: what each has raised against its goal.
// Admins only, and only where the fundraising module is on. The same
// cards as the Fundraising overview; this is the screen that exists when
// there are none yet, with the way to start the first.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { CampaignCards, type CampaignRow } from "@/components/CampaignCards";
import { AddButton, EmptyState, LinkButton, Notice, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const { slug } = await params;
  const { notice, error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: campaignRows }, { data: giftRows }, { data: pledgeRows }] = await Promise.all([
    supabase.from("campaigns").select("id, name, kind, goal_amount, ends_on").eq("org_id", org.id).order("ends_on", { ascending: false }),
    supabase.from("gifts").select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id").eq("org_id", org.id),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
  ]);
  const campaigns = (campaignRows ?? []) as CampaignRow[];

  return (
    <Screen
      title="Campaigns"
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }}
      action={<AddButton href={`/org/${slug}/fundraising/campaigns/new`} label="Add" />}
    >
      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}
      <Section label="Campaigns" count={campaigns.length} role="visit" kind="campaign">
        {campaigns.length === 0 ? (
          <EmptyState kind="campaign" title="No Campaigns Yet" action={<LinkButton href={`/org/${slug}/fundraising/campaigns/new`}>Add the First One</LinkButton>} />
        ) : (
          <CampaignCards slug={slug} campaigns={campaigns} gifts={toGifts(giftRows as GiftRow[] | null)} pledges={toPledges(pledgeRows as PledgeRow[] | null)} />
        )}
      </Section>
    </Screen>
  );
}
