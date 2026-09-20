import { Heading, LinkButton, Panel, Prose, Stack } from "@/components/kit";

// A link into nothing, outside any org: a slug that does not exist or
// that the signed-in person is not a member of. Both are "not here"
// rather than "not allowed", because the row is invisible to them, not
// merely protected (see src/lib/org/membership.ts).
export default function RootNotFound() {
  return (
    <Panel>
      <Stack gap={4}>
        <div className="text-center">
          <Heading>Nothing Here</Heading>
          <Prose>That link points at something that was removed, or that this account cannot see.</Prose>
        </div>
        <LinkButton href="/" variant="secondary">
          Back to the Start
        </LinkButton>
      </Stack>
    </Panel>
  );
}
