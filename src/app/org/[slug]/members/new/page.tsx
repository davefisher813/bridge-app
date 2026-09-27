import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { inviteMember } from "@/lib/actions/members";
import { parseRole } from "@/lib/validation/member";
import { canAdvise } from "@/lib/org/advisors";
import { InviteForm } from "@/components/InviteForm";
import { Prose, Screen } from "@/components/kit";

// Owner only, like the list it comes from. The person invited gets an
// email with a sign-in link; nobody makes up a password.
//
// With ?assignAthleteId (Stage 5, Phase 2) this is Add Admin from that
// athlete's Advisor sheet: the role is preset to Admin, the screen says
// who they will advise, and the invite comes back to the athlete's page
// with the new person assigned. The athlete must be this org's, read
// through the Admin's own client; anything else is the plain invite.
export default async function InviteMemberPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ role?: string; assignAthleteId?: string; returnTo?: string }> }) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  // The roster, so a family invite can name its athlete.
  const supabase = await createClient();
  const { data: athleteRows } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name", { ascending: true });
  const athletes = ((athleteRows ?? []) as { id: string; name: string }[]).map((a) => ({ id: a.id, name: a.name }));

  const action = inviteMember.bind(null, slug);
  const back = { href: `/org/${slug}/members`, label: "Members" };

  const advisee = query.assignAthleteId ? athletes.find((a) => a.id === query.assignAthleteId) ?? null : null;
  // Only a role that may advise is preset; the default is Admin.
  const presetRole = parseRole(query.role ?? "owner");
  if (advisee && presetRole && canAdvise(presetRole)) {
    const returnTo = `/org/${slug}/roster/${advisee.id}`;
    return (
      <Screen title="Add Admin" back={{ href: returnTo, label: advisee.name }} lede={`They will be assigned as ${advisee.name}'s advisor.`}>
        <InviteForm action={action} preset={{ role: presetRole, assignAthleteId: advisee.id, returnTo }} />
        <Prose>The link works for 24 hours.</Prose>
      </Screen>
    );
  }

  return (
    <Screen title="Invite Someone" back={back}>
      <InviteForm action={action} athletes={athletes} />
      <Prose>The link works for 24 hours.</Prose>
    </Screen>
  );
}
