import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { inviteMember } from "@/lib/actions/members";
import { InviteForm } from "@/components/InviteForm";

// Owner only, like the list it comes from. The person invited gets an
// email with a sign-in link; nobody makes up a password.
export default async function InviteMemberPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  const action = inviteMember.bind(null, slug);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/members`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Members
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Invite Someone</h1>
      <p className="mb-4 text-[13.5px] text-muted">They get an email with a sign-in link. No password to make up or remember.</p>
      <InviteForm action={action} roleLabels={org.roleLabels} />
      <p className="mt-3 text-[12px] text-muted">The link works for 24 hours. If it lapses, Resend from the Invited list.</p>
    </main>
  );
}
