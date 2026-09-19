"use client";

import "./globals.css";
import { Button, Heading, Panel, Prose, Stack } from "@/components/kit";

// Only reached when the root layout itself fails, which is why this has
// to carry its own html and body.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <Panel>
          <Stack gap={4}>
            <div className="text-center">
              <Heading>Something broke</Heading>
              <Prose>The app could not start. Try again in a moment.</Prose>
            </div>
            <Button type="button" onClick={reset}>
              Try Again
            </Button>
          </Stack>
        </Panel>
      </body>
    </html>
  );
}
