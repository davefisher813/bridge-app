import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
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

  // The roster, so a family invite can name its athlete.
  const supabase = await createClient();
  const { data: athleteRows } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name", { ascending: true });
  const athletes = ((athleteRows ?? []) as { id: string; name: string }[]).map((a) => ({ id: a.id, name: a.name }));

  const action = inviteMember.bind(null, slug);

  return (
    <Screen title="Invite Someone" back={{ href: `/org/${slug}/members`, label: "Members" }}>
      <InviteForm action={action} roleLabels={org.roleLabels} athletes={athletes} />
      <Prose>The link works for 24 hours. If it lapses, Resend from the Invited list.</Prose>
    </Screen>
  );
}
