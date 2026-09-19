import { Heading, Panel, Prose } from "@/components/kit";

export default function UnauthorizedPage() {
  return (
    <Panel>
      <div className="text-center">
        <Heading>Not authorized</Heading>
        <Prose>Your account does not have access to this page. Contact your organization&apos;s owner if you think this is wrong.</Prose>
      </div>
    </Panel>
  );
}
