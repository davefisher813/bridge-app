import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrg } from "@/lib/actions/org";
import { getOrgMemberships } from "@/lib/org/membership";
import { getViewAs } from "@/lib/data/viewAs";
import { viewingBanner } from "@/lib/auth/viewingBanner";
import { CreateOrgForm } from "@/components/CreateOrgForm";
import { Heading, LinkButton, Panel, Prose, Stack } from "@/components/kit";

// Create Organization (audit wired F4). A signed-in person in no org, or
// one who owns every org they belong to, may start one and becomes its
// owner: public.create_org in migration 0040 does both in one
// transaction, and refuses anyone holding a membership that is not
// owner (staff, a member, a family login). This screen says so up front
// rather than offering a form the database will refuse. The root page
// links here when the person belongs to no org yet; an owner reaches it
// from More to start another. While an Admin is viewing as someone (Stage 5
// Phase 5) the banner with Return is here too, and the form itself refuses:
// createOrg and create_org both say read only.
export default async function NewOrgPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [memberships, viewingAs] = await Promise.all([getOrgMemberships(), getViewAs()]);
  const canCreate = memberships.every((m) => m.role === "owner") && !viewingAs;

  return (
    <Panel viewing={viewingBanner(viewingAs?.orgSlug ?? "", viewingAs)}>
      <Stack gap={4}>
        <div className="text-center">
          <Heading>Create an Organization</Heading>
          <Prose>
            {canCreate
              ? "You will be its Admin. Invite everyone else once it exists."
              : viewingAs
                ? `Read only while viewing as ${viewingAs.name}. Return to Admin to start an organization.`
                : "Only an Admin, or someone not yet in any organization, can start one. Ask your organization's Admin."}
          </Prose>
        </div>
        {canCreate && <CreateOrgForm action={createOrg} />}
        <LinkButton href="/" variant="secondary">
          Back to the Start
        </LinkButton>
      </Stack>
    </Panel>
  );
}
