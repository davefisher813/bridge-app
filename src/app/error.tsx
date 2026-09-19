"use client";

import { useEffect } from "react";
import { Button, Heading, Panel, Prose, Stack } from "@/components/kit";

// What a person sees when a screen outside an org throws: the login
// page, the org picker. Inside an org, org/[slug]/error.tsx keeps the
// tab bar so they can walk away from the broken screen.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Panel>
      <Stack gap={4}>
        <div className="text-center">
          <Heading>Something broke on this screen</Heading>
          <Prose>Your data is fine. Try again, and if it keeps happening tell your organization&apos;s owner what you tapped.</Prose>
        </div>
        <Button type="button" onClick={reset}>
          Try Again
        </Button>
      </Stack>
    </Panel>
  );
}
