"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RowGlyph, type RowKind } from "@/components/RowGlyph";

// Today / Athletes / Targets / More. Fixed to the screen above the iPhone's
// home indicator (Dave's pick, 2026-09-19): the old bar scrolled with
// the page and rode Safari's own bar up and down as it collapsed. Every Screen pads
// its bottom by the bar's height plus the safe area, so nothing hides
// behind it.
//
// A family login gets three tabs instead (Dave's pick in the Family
// Access catalog, 2026-09-21): their athlete is home, Colleges is their
// list, More has who to ask and the way out. Same bar, different tabs.
// A member (Bridge: Board) gets Home, Program, Giving, More (Dave's pick
// in the Board Access catalog, 2026-09-21); an org without the
// fundraising module drops Giving.
export type TabBarVariant = "org" | "family" | "member" | "member-lite";

const ORG_TABS: { href: string; label: string; kind: RowKind }[] = [
  { href: "", label: "Today", kind: "org" },
  { href: "roster", label: "Athletes", kind: "athlete" },
  // Targets, not Board: "most won't get what that means" (Dave,
  // 2026-09-21). The route stays /board.
  { href: "board", label: "Targets", kind: "school" },
  { href: "more", label: "More", kind: "settings" },
];

const FAMILY_TABS: { href: string; label: string; kind: RowKind }[] = [
  { href: "family", label: "Athlete", kind: "athlete" },
  { href: "family/colleges", label: "Colleges", kind: "school" },
  { href: "family/more", label: "More", kind: "settings" },
];

const MEMBER_TABS: { href: string; label: string; kind: RowKind }[] = [
  { href: "member", label: "Home", kind: "org" },
  { href: "member/program", label: "Program", kind: "athlete" },
  { href: "member/giving", label: "Giving", kind: "money" },
  { href: "member/more", label: "More", kind: "settings" },
];

export function TabBar({ slug, variant = "org" }: { slug: string; variant?: TabBarVariant }) {
  const pathname = usePathname();
  const base = `/org/${slug}`;
  const tabs = variant === "family" ? FAMILY_TABS : variant === "member" ? MEMBER_TABS : variant === "member-lite" ? MEMBER_TABS.filter((t) => t.href !== "member/giving") : ORG_TABS;

  // The active tab is the one whose path is the longest prefix of where
  // we are, so /family/colleges lights Colleges and not Athlete.
  const hrefOf = (tab: { href: string }) => (tab.href ? `${base}/${tab.href}` : base);
  const matches = (tab: { href: string }) => (tab.href ? pathname === hrefOf(tab) || pathname.startsWith(`${hrefOf(tab)}/`) : pathname === base);
  const activeHref = tabs.filter(matches).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-10 border-t border-line bg-paper" aria-label="Main">
      <div className="mx-auto flex h-14 max-w-2xl">
        {tabs.map((tab) => {
          const href = hrefOf(tab);
          const active = activeHref === tab.href;
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
