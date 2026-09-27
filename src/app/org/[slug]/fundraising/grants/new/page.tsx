import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { trackGrant } from "@/lib/actions/fundraising";
import { GrantForm } from "@/components/FundraisingForms";
import { Screen } from "@/components/kit";

export default async function NewGrantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  // Donor names on file, suggested as the funder (Stage 4, B8).
  const supabase = await createClient();
  const { data: donorRows } = await supabase.from("donors").select("name").eq("org_id", org.id).is("deleted_at", null).order("name");

  return (
    <Screen
      title="Track Grant"
      back={{ href: `/org/${slug}/fundraising/grants`, label: "Grants" }}
    >
      <GrantForm action={trackGrant.bind(null, slug)} funders={((donorRows ?? []) as { name: string }[]).map((d) => d.name)} />
    </Screen>
  );
}
