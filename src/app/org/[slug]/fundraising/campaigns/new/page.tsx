import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createCampaign } from "@/lib/actions/fundraising";
import { CampaignForm } from "@/components/FundraisingForms";
import { Screen } from "@/components/kit";

export default async function NewCampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  return (
    <Screen
      title="New Campaign"
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }}
    >
      <CampaignForm action={createCampaign.bind(null, slug)} />
    </Screen>
  );
}
