"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RowGlyph, type RowKind } from "@/components/RowGlyph";

// Today / Athletes / Board / More. Fixed to the screen above the iPhone's
// home indicator (Dave's pick, 2026-09-19): the old bar scrolled with
// the page and rode Safari's own bar up and down as it collapsed. Every Screen pads
// its bottom by the bar's height plus the safe area, so nothing hides
// behind it.
const TABS: { href: string; label: string; kind: RowKind }[] = [
  { href: "", label: "Today", kind: "org" },
  { href: "roster", label: "Athletes", kind: "athlete" },
  { href: "board", label: "Board", kind: "school" },
  { href: "more", label: "More", kind: "settings" },
];

export function TabBar({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/org/${slug}`;

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper" aria-label="Main">
      <div className="mx-auto flex h-14 max-w-2xl">
        {TABS.map((tab) => {
          const href = tab.href ? `${base}/${tab.href}` : base;
          const active = tab.href ? pathname.startsWith(href) : pathname === base;
          return (
            <Link key={tab.label} href={href} aria-current={active ? "page" : undefined} className={`flex flex-1 flex-col items-center justify-center gap-1 text-label font-bold ${active ? "text-ink" : "text-muted"}`}>
              <span className={`flex h-6 w-8 items-center justify-center rounded ${active ? "bg-solid-accent text-solid-accent-on" : ""}`}>
                <RowGlyph kind={tab.kind} role="neutral" className={`h-4 w-4 ${active ? "text-solid-accent-on" : "text-muted"}`} />
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
