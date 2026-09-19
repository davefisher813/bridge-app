"use client";

import { useEffect } from "react";
import { Button, EmptyState, Screen } from "@/components/kit";

// A screen inside an org threw. The org chrome, with its tab bar, is
// still standing around this, so the person can go to another tab
// rather than being stranded on a white page.
export default function OrgError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Screen>
      <EmptyState kind="warning" role="danger" title="Something broke on this screen">
        Your data is fine. Try again, and if it keeps happening tell your organization&apos;s owner what you tapped.
      </EmptyState>
      <Button type="button" onClick={reset}>
        Try Again
      </Button>
    </Screen>
  );
}
