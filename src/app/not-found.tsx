import Link from "next/link";

// A link into nothing, outside any org: a slug that does not exist or
// that the signed-in person is not a member of. Both are "not here"
// rather than "not allowed", because the row is invisible to them, not
// merely protected (see src/lib/org/membership.ts).
export default function RootNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px] rounded-[18px] border border-line bg-paper p-6 text-center">
        <div className="text-[20px] font-extrabold text-ink">Nothing here</div>
        <p className="mt-2 text-[14.5px] text-muted">That link points at something that was removed, or that this account cannot see.</p>
        <Link href="/" className="mt-4 inline-flex min-h-[44px] items-center text-[14.5px] font-bold text-accent">
          Back to the start &rarr;
        </Link>
      </div>
    </main>
  );
}
