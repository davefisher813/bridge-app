import { getViewAs } from "@/lib/data/viewAs";
import { viewingBanner } from "@/lib/auth/viewingBanner";
import { Heading, LinkButton, Notice, Panel, Prose, Stack } from "@/components/kit";

// Where a role check lands. An Admin who is viewing as someone lands here
// too, whenever the person they are viewing may not open a page (an
// Athlete has no Members screen), so the banner with Return is here: it
// is the one way out that needs no other screen to work (Stage 5 Phase 5).
// `error` is the one message a failed Return leaves.
export default async function UnauthorizedPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const { error } = searchParams ? await searchParams : {};
  const viewingAs = await getViewAs();

  return (
    <Panel viewing={viewingBanner(viewingAs?.orgSlug ?? "", viewingAs)}>
      <Stack gap={4}>
        {error && <Notice tone="danger" title={error} />}
        <div className="text-center">
          <Heading>Not Authorized</Heading>
          <Prose>{viewingAs ? `${viewingAs.name} cannot open that page, so you cannot either while viewing as them.` : "Your account does not have access to this page. Contact your organization's Admin if you think this is wrong."}</Prose>
        </div>
        <LinkButton href="/" variant="secondary">
          Back to the Start
        </LinkButton>
      </Stack>
    </Panel>
  );
}
