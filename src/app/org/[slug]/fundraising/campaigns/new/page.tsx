import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createCampaign } from "@/lib/actions/fundraising";
import { CampaignForm } from "@/components/FundraisingForms";

export default async function NewCampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/fundraising`} className="text-[13px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">New campaign</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">An event, an appeal, or anything with a goal and an end date.</p>
      <CampaignForm action={createCampaign.bind(null, slug)} />
    </main>
  );
}
