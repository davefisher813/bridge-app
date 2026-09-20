import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { recordPledge } from "@/lib/actions/fundraising";
import { PledgeForm } from "@/components/FundraisingForms";
import { LinkButton, Notice, Screen } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function NewPledgePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: donorRows }, { data: campaignRows }] = await Promise.all([
    supabase.from("donors").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("campaigns").select("id, name").eq("org_id", org.id).order("name"),
  ]);

  const donors = (donorRows ?? []) as Array<{ id: string; name: string }>;

  return (
    <Screen
      title="Add Pledge"
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }}
    >
      {donors.length === 0 ? (
        <>
          <Notice tone="warning" title="No Donors on File Yet">
            A pledge needs somebody behind it, so add the donor first.
          </Notice>
          <LinkButton href={`/org/${slug}/fundraising/donors/new`}>Add Donor</LinkButton>
        </>
      ) : (
        <PledgeForm
          action={recordPledge.bind(null, slug)}
          donors={donors}
          campaigns={(campaignRows ?? []) as Array<{ id: string; name: string }>}
          today={new Date().toISOString().slice(0, 10)}
        />
      )}
    </Screen>
  );
}
