import { homeFor } from "@/lib/auth/guard";
import { getOrgMemberships } from "@/lib/org/membership";
import { getViewAs } from "@/lib/data/viewAs";
import { viewingBanner } from "@/lib/auth/viewingBanner";
import { Heading, LinkButton, Notice, Panel, Prose, Stack } from "@/components/kit";

// Where a guard sends someone whose role does not open the page they
// asked for. A signed-in person is sent on to their own home in each org
// they belong to (homeFor: an Admin to Today, a Viewer to /member, an
// Athlete login to /family), not to the start, which for a Viewer or an
// Athlete login was a dead end on a phone. Signed out, or in no org, it
// keeps the one way back to the start.
//
// An Admin who is viewing as someone lands here too, whenever the person
// they are viewing may not open a page (an Athlete has no Members
// screen), so the banner with Return is here: it is the one way out that
// needs no other screen to work (Stage 5 Phase 5). `error` is the one
// message a failed Return leaves.
export default async function UnauthorizedPage({ searchParams }: { searchParams?: Promise<{ error?: string }> } = {}) {
  const { error } = searchParams ? await searchParams : {};
  const viewingAs = await getViewAs();
  const memberships = await getOrgMemberships();

  return (
    <Panel viewing={viewingBanner(viewingAs?.orgSlug ?? "", viewingAs)}>
      <Stack gap={4}>
        {error && <Notice tone="danger" title={error} />}
        <div className="text-center">
          <Heading>Not Authorized</Heading>
          <Prose>{viewingAs ? `${viewingAs.name} cannot open that page, so you cannot either while viewing as them.` : "Your account does not have access to this page. Contact your organization's Admin if you think this is wrong."}</Prose>
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
