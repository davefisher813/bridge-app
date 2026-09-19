"use client";

import { usePathname } from "next/navigation";
import { EmptyState, LinkButton, Screen } from "@/components/kit";

// A record inside an org that is not there: a deleted athlete, a target
// from a link somebody kept, a module this org has not turned on. The
// org chrome stays up, and the way out is that org's Today screen.
export default function OrgNotFound() {
  const pathname = usePathname();
  const base = pathname.match(/^\/org\/[^/]+/)?.[0] ?? "/";

  return (
    <Screen>
      <EmptyState kind="info" title="Nothing here">
        That link points at something that was removed or never existed.
      </EmptyState>
      <LinkButton href={base} variant="secondary">
        Back to Today
      </LinkButton>
    </Screen>
  );
}
