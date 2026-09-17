import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { trackGrant } from "@/lib/actions/fundraising";
import { GrantForm } from "@/components/FundraisingForms";

export default async function NewGrantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/fundraising/grants`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Grants
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Track a grant</h1>
      <p className="mb-5 text-[13.5px] leading-tight text-muted">
        The application. Money arrives later as an ordinary gift in the Foundation Grants category.
      </p>
      <GrantForm action={trackGrant.bind(null, slug)} />
    </main>
  );
}
