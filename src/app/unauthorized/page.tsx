import { Heading, LinkButton, Panel, Prose, Stack } from "@/components/kit";

export default function UnauthorizedPage() {
  return (
    <Panel>
      <Stack gap={4}>
        <div className="text-center">
          <Heading>Not Authorized</Heading>
          <Prose>Your account does not have access to this page. Contact your organization&apos;s owner if you think this is wrong.</Prose>
        </div>
        <LinkButton href="/" variant="secondary">
          Back to the Start
        </LinkButton>
      </Stack>
    </Panel>
  );
}
