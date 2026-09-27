import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { removeCampaign, updateCampaign } from "@/lib/actions/fundraising";
import { CampaignForm } from "@/components/FundraisingForms";
import { toCents } from "@/lib/fundraising/rollup";
import { centsToDecimalString } from "@/lib/validation/gift";
import { ConfirmButton, Form, Notice, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

// Edit Campaign (audit crud F10), prefilled, with Remove behind a
// confirm. Gifts and pledges that named it stay, with no campaign.
export default async function EditCampaignPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase.from("campaigns").select("id, name, kind, starts_on, ends_on, goal_amount, notes").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!data) notFound();
  const c = data as { id: string; name: string; kind: string; starts_on: string | null; ends_on: string | null; goal_amount: number | string | null; notes: string | null };

  return (
    <Screen title="Edit Campaign" back={{ href: `/org/${slug}/fundraising/campaigns/${c.id}`, label: c.name }}>
      {error && <Notice tone="danger" title={error} />}
      <CampaignForm
        action={updateCampaign.bind(null, slug, c.id)}
        submitLabel="Save Campaign"
        initial={{
          name: c.name,
          kind: c.kind,
          startsOn: c.starts_on,
          endsOn: c.ends_on,
          goalAmount: c.goal_amount === null || c.goal_amount === undefined ? null : centsToDecimalString(toCents(c.goal_amount)),
          notes: c.notes,
        }}
      />
      <Section label="Remove" role="danger" kind="blocked">
        <Form action={removeCampaign.bind(null, slug, c.id)}>
          <ConfirmButton title={`Remove ${c.name}?`} body="The campaign goes. Gifts and pledges that named it stay, and still count, with no campaign." confirmLabel="Remove">
            Remove Campaign
          </ConfirmButton>
        </Form>
      </Section>
    </Screen>
  );
}
