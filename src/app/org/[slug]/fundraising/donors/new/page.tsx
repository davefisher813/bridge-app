import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createDonor } from "@/lib/actions/fundraising";
import { DonorForm } from "@/components/DonorForm";
import { Screen } from "@/components/kit";

export default async function NewDonorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const action = createDonor.bind(null, slug);

  return (
    <Screen
      title="Add Donor"
      back={{ href: `/org/${slug}/fundraising/donors`, label: "Donors" }}
      lede="Their giving history builds itself from the gifts you record against them. Nothing about totals is typed in here."
    >
      <DonorForm action={action} />
    </Screen>
  );
}
