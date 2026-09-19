"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";

// A record inside an org that is not there: a deleted athlete, a target
// from a link somebody kept, a module this org has not turned on. The
// org chrome stays up, and the way out is that org's Today screen.
export default function OrgNotFound() {
  const pathname = usePathname();
  const base = pathname.match(/^\/org\/[^/]+/)?.[0] ?? "/";

  return (
    <main className="px-4 pt-6">
      <EmptyState icon={<RowGlyph kind="info" role="neutral" className="h-7 w-7" />} title="Nothing here">
        That link points at something that was removed or never existed.
        <div className="mt-3">
          <Link href={base} className="inline-flex min-h-[44px] items-center font-bold text-accent">
            Back to Today &rarr;
          </Link>
        </div>
      </EmptyState>
    </main>
  );
}
