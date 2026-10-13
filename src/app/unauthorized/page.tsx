import { homeFor } from "@/lib/auth/guard";
import { getOrgMemberships } from "@/lib/org/membership";
import { Heading, LinkButton, Panel, Prose, Stack } from "@/components/kit";

// Where a guard sends someone whose role does not open the page they
// asked for. A signed-in person is sent on to their own home in each org
// they belong to (homeFor: an Admin to Today, a Viewer to /member, an
// Athlete login to /family), not to the start, which for a Viewer or an
// Athlete login was a dead end on a phone. Signed out, or in no org, it
// keeps the one way back to the start.
export default async function UnauthorizedPage() {
  const memberships = await getOrgMemberships();

  return (
    <Panel>
      <Stack gap={4}>
        <div className="text-center">
          <Heading>Not Authorized</Heading>
          <Prose>Your account does not have access to this page. Contact your organization&apos;s Admin if you think this is wrong.</Prose>
        </div>
        {memberships.length === 0 ? (
          <LinkButton href="/" variant="secondary">
            Back to the Start
          </LinkButton>
        ) : memberships.length === 1 ? (
          <LinkButton href={homeFor(memberships[0]!.orgSlug, memberships[0]!.role)}>Back to Your Home</LinkButton>
        ) : (
          memberships.map((m) => (
            <LinkButton key={m.orgId} href={homeFor(m.orgSlug, m.role)} variant="secondary">
              {`Back to ${m.orgName}`}
            </LinkButton>
          ))
        )}
      </Stack>
    </Panel>
  );
}
