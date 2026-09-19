"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";

// A screen inside an org threw. The org layout, with its tab bar, is
// still standing around this, so the person can go to another tab
// rather than being stranded on a white page.
export default function OrgError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="px-4 pt-6">
      <EmptyState icon={<RowGlyph kind="warning" role="danger" className="h-7 w-7" />} title="Something broke on this screen">
        Your data is fine. Try again, and if it keeps happening tell your organization&apos;s owner what you tapped.
        <div className="mt-4">
          <button type="button" onClick={reset} className="rounded-[8px] bg-solid-accent px-6 py-2.5 text-[14.5px] font-bold text-solid-accent-on">
            Try Again
          </button>
        </div>
      </EmptyState>
    </main>
  );
}
