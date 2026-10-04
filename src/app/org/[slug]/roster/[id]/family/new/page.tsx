import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { inviteMember } from "@/lib/actions/members";
import { InviteForm } from "@/components/InviteForm";
import { Prose, Screen } from "@/components/kit";

// Invite Family, from the athlete's page (Dave's pick in the Family
// Access catalog, 2026-09-21). The role is family and the athlete is
// this one; staff and owners may send it. The person gets an email with
// a sign-in link and sees this athlete's record, read only, and nothing
// else.
export default async function InviteFamilyPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) notFound();
  const name = (athlete as { name: string }).name;

  // The athlete's own parent and guardian contacts (Stage 4): their
  // emails are suggested, and with exactly one the name is filled in.
  // This athlete's rows only, in this org.
  const { data: guardianContacts } = await supabase.from("contacts").select("name, email").eq("athlete_id", id).eq("org_id", org.id).eq("role", "parent_guardian");
  const parents = (guardianContacts ?? []) as { name: string; email: string | null }[];
  const suggest = {
    emails: parents.map((p) => p.email?.trim() ?? "").filter(Boolean),
    name: parents.length === 1 ? parents[0].name.trim() || undefined : undefined,
  };

  return (
    <Screen title="Invite Athlete" back={{ href: `/org/${slug}/roster/${id}`, label: name }}>
      <InviteForm action={inviteMember.bind(null, slug)} pinned={{ athleteId: id, athleteName: name, returnTo: `/org/${slug}/roster/${id}` }} suggest={suggest} />
      <Prose>The link works for 24 hours.</Prose>
    </Screen>
  );
}
