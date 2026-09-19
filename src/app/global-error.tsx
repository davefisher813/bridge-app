"use client";

import "./globals.css";

// Only reached when the root layout itself fails, which is why this has
// to carry its own html and body. Plain by design: nothing it depends on
// can be trusted to have loaded.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-bg px-4">
          <div className="w-full max-w-[380px] rounded-[18px] border border-line bg-paper p-6 text-center">
            <div className="text-[20px] font-extrabold text-ink">Something broke</div>
            <p className="mt-2 text-[14.5px] text-muted">The app could not start. Try again in a moment.</p>
            <button type="button" onClick={reset} className="mt-4 rounded-[8px] bg-solid-accent px-6 py-3 text-[15px] font-bold text-solid-accent-on">
              Try Again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
