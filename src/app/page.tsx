import { redirect } from "next/navigation";
import { getOrgMemberships } from "@/lib/org/membership";
import { signout } from "@/lib/auth/actions";
import { Button, Form, Heading, LinkButton, OrgMark, Panel, Prose, Row, Stack } from "@/components/kit";

// Post-login landing: a person can belong to more than one org (a coach
// at Elite Squad who also volunteers for Bridge), so this is where that
// gets resolved - straight through for exactly one org, a picker for
// more than one, same page can't guess for zero. Zero offers to start an
// organization (audit wired F4): the person who signs in first on a new
// install is the one who creates it. The offer is only made to someone
// create_org would let through (migration 0040): in no org, or owner in
// every org they belong to. Staff, a member or a family login is not
// offered it.
export default async function HomePage() {
  const memberships = await getOrgMemberships();
  const canCreate = memberships.every((m) => m.role === "owner");

  if (memberships.length === 1) {
    redirect(`/org/${memberships[0]!.orgSlug}`);
  }

  if (memberships.length === 0) {
    return (
      <Panel>
        <Stack gap={4}>
          <div className="text-center">
            <Heading>No Organization Access Yet</Heading>
            <Prose>Your account isn&apos;t a member of any organization. Ask your organization&apos;s Admin to add you, or start a new one.</Prose>
          </div>
          <LinkButton href="/orgs/new">Create an Organization</LinkButton>
          <Form action={signout}>
            <Button variant="quiet">Sign Out</Button>
          </Form>
        </Stack>
      </Panel>
    );
  }

  return (
    <Panel>
      <Stack gap={4}>
        <Heading>Choose an Organization</Heading>
        <Stack gap={3}>
          {memberships.map((m) => (
            <Row key={m.orgId} href={`/org/${m.orgSlug}`} kind="org" role="place" leading={m.logo ? <OrgMark src={m.logo} size="lg" /> : undefined} title={m.orgName} meta={m.role} />
          ))}
        </Stack>
        {canCreate && (
          <LinkButton href="/orgs/new" variant="secondary">
            Create an Organization
          </LinkButton>
        )}
      </Stack>
    </Panel>
  );
}
