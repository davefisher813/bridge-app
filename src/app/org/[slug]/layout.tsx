import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { Chrome } from "@/components/kit";

// Shared chrome for every /org/[slug]/* screen: org name up top, the
// fixed tab bar below. The theme follows the phone (src/app/layout.tsx);
// nothing here forces one.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  return (
    <Chrome orgName={org.name} slug={slug} logo={org.logo}>
      {children}
    </Chrome>
  );
}
