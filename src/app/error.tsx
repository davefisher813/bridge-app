"use client";

import { useEffect } from "react";

// What a person sees when a screen outside an org throws: the login
// page, the org picker. Inside an org, org/[slug]/error.tsx keeps the
// tab bar so they can walk away from the broken screen.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The stack goes to the server log through Next's own reporting; this
    // is the one place the browser console gets it too.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px] rounded-[18px] border border-line bg-paper p-6 text-center">
        <div className="text-[20px] font-extrabold text-ink">Something broke on this screen</div>
        <p className="mt-2 text-[14.5px] text-muted">Your data is fine. Try again, and if it keeps happening tell your organization&apos;s owner what you tapped.</p>
        <button type="button" onClick={reset} className="mt-4 rounded-[8px] bg-solid-accent px-6 py-3 text-[15px] font-bold text-solid-accent-on">
          Try Again
        </button>
      </div>
    </main>
  );
}
