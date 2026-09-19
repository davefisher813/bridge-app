import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { inviteMember } from "@/lib/actions/members";
import { InviteForm } from "@/components/InviteForm";
import { Prose, Screen } from "@/components/kit";

// Owner only, like the list it comes from. The person invited gets an
// email with a sign-in link; nobody makes up a password.
export default async function InviteMemberPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  const action = inviteMember.bind(null, slug);

  return (
    <Screen title="Invite Someone" back={{ href: `/org/${slug}/members`, label: "Members" }} lede="They get an email with a sign-in link. No password to make up or remember.">
      <InviteForm action={action} roleLabels={org.roleLabels} />
      <Prose>The link works for 24 hours. If it lapses, Resend from the Invited list.</Prose>
    </Screen>
  );
}
