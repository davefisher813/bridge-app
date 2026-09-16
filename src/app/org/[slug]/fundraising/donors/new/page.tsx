import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createDonor } from "@/lib/actions/fundraising";
import { DonorForm } from "@/components/DonorForm";

export default async function NewDonorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const action = createDonor.bind(null, slug);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/fundraising/donors`} className="text-[13px] font-bold text-muted">
          &larr; Donors
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Add a donor</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        Their giving history builds itself from the gifts you record against them. Nothing about totals is typed in here.
      </p>
      <DonorForm action={action} />
    </main>
  );
}
