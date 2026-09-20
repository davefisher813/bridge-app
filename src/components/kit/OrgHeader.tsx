"use client";

import { usePathname } from "next/navigation";
import { OrgMark } from "@/components/kit";

// The top of every org screen. The wordmark alone when the org has one
// (Dave, 2026-09-20: "use the word mark for the logo and words, get rid
// of that default title"), the mark and the name otherwise. Centered on
// Today, the home screen (Dave, same day); left with the title on every
// other screen. A client component only because it reads the path.
export function OrgHeader({ slug, orgName, logo, lockup }: { slug: string; orgName: string; logo?: string | null; lockup?: string | null }) {
  const home = usePathname() === `/org/${slug}`;
  return (
    <div className={`flex min-h-11 items-center gap-3 px-4 pt-3 ${home ? "justify-center" : ""}`}>
      {lockup ? (
        <>
          <OrgMark src={lockup} size="xl" />
          <span className="sr-only">{orgName}</span>
        </>
      ) : (
        <>
          {logo && <OrgMark src={logo} size="md" />}
          <span className="text-body font-extrabold text-ink">{orgName}</span>
        </>
      )}
    </div>
  );
}
