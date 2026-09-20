import { redirect } from "next/navigation";
import { getOrgMemberships } from "@/lib/org/membership";
import { signout } from "@/lib/auth/actions";
import { Button, Form, Heading, Panel, Prose, Row, Stack } from "@/components/kit";

// Post-login landing: a person can belong to more than one org (a coach
// at Elite Squad who also volunteers for Bridge), so this is where that
// gets resolved - straight through for exactly one org, a picker for
// more than one, same page can't guess for zero.
export default async function HomePage() {
  const memberships = await getOrgMemberships();

  if (memberships.length === 1) {
    redirect(`/org/${memberships[0]!.orgSlug}`);
  }

  if (memberships.length === 0) {
    return (
      <Panel>
        <Stack gap={4}>
          <div className="text-center">
            <Heading>No organization access yet</Heading>
            <Prose>Your account isn&apos;t a member of any organization. Ask your organization&apos;s owner to add you.</Prose>
          </div>
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
        <Heading>Choose an organization</Heading>
        <Stack gap={3}>
          {memberships.map((m) => (
            <Row key={m.orgId} href={`/org/${m.orgSlug}`} kind="org" role="place" title={m.orgName} meta={m.role} />
          ))}
        </Stack>
      </Stack>
    </Panel>
  );
}
