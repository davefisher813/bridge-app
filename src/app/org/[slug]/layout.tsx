import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { getCurrentUser } from "@/lib/auth/guard";
import { Chrome } from "@/components/kit";

// Shared chrome for every /org/[slug]/* screen: org name up top, the
// fixed tab bar below. The theme follows the phone (src/app/layout.tsx);
// nothing here forces one. A family login gets the family bar; the
// pages themselves decide who may open them.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await getCurrentUser(org.id);

  return (
    <Chrome orgName={org.name} slug={slug} logo={org.logo} tabs={user?.role === "family" ? "family" : user?.role === "member" ? (org.modules.donor_fundraising ? "member" : "member-lite") : "org"}>
      {children}
    </Chrome>
  );
}
