import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { signout } from "@/lib/auth/actions";

const NAV_ITEMS = [
  { href: "roster", label: "Roster" },
  { href: "board", label: "Board" },
];

// Shared chrome for every /org/[slug]/* screen: org name, section nav,
// sign out. Individual pages still fetch their own data (each needs a
// different query) but no longer each render their own header.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  return (
    <div className="min-h-screen bg-bg pb-10">
      <div className="border-b border-line bg-paper px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="text-[20px] font-extrabold text-ink">{org.name}</div>
          <form action={signout}>
            <button type="submit" className="text-[12px] font-semibold text-muted">
              Sign out
            </button>
          </form>
        </div>
        <div className="mt-3 flex gap-4">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={`/org/${slug}/${item.href}`} className="text-[13px] font-semibold text-muted hover:text-ink">
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      {children}
    </div>
  );
}
