import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { BottomTabBar } from "@/components/BottomTabBar";

// Shared chrome for every /org/[slug]/* screen: org name up top, bottom
// tab bar for navigation. Individual pages still fetch their own data
// (each needs a different query) but no longer each render their own
// header/nav. Sign out moved to the More tab - see more/page.tsx.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  return (
    <div data-theme="dark" className="flex min-h-screen flex-col bg-bg">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="text-[17px] font-extrabold text-ink">{org.name}</div>
      </div>

      <div className="flex-1 pb-2">{children}</div>

      <BottomTabBar slug={slug} />
    </div>
  );
}
