"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Today / Athletes / Board / More. Per Dave (2026-09): no standalone
// Tasks or Calendar tab - neither is a built feature here, and that
// pattern reads as JARVIS's life-management app, not this org/recruiting
// management tool. See docs/DECISIONS.md.
const TABS = [
  {
    href: "",
    label: "Today",
    icon: (
      <path d="M3 11l9-7 9 7M5 10v9h5v-5h4v5h5v-9" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    href: "roster",
    label: "Athletes",
    icon: (
      <>
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5 20c1-4 4-6 7-6s6 2 7 6" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "board",
    label: "Board",
    icon: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2.5" />
        <path d="M4 10h16M8 3v4M16 3v4" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "more",
    label: "More",
    icon: (
      <>
        <circle cx="5" cy="12" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="19" cy="12" r="1.4" />
      </>
    ),
  },
];

export function BottomTabBar({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/org/${slug}`;

  return (
    <nav className="sticky bottom-0 flex border-t border-line bg-paper/90 px-1.5 pb-3.5 pt-2 backdrop-blur">
      {TABS.map((tab) => {
        const href = tab.href ? `${base}/${tab.href}` : base;
        const active = tab.href ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={tab.label}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 text-[10px] font-bold ${active ? "text-accent" : "text-muted"}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              {tab.icon}
            </svg>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
