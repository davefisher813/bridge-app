import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadStaff } from "@/lib/data/staff";
import { createAthlete } from "@/lib/actions/athletes";
import { AthleteForm } from "@/components/AthleteForm";
import { Screen } from "@/components/kit";

export default async function NewAthletePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const advisors = (await loadStaff(supabase, org.id)).map((s) => ({ id: s.id, name: s.name }));
  const action = createAthlete.bind(null, slug);

  return (
    <Screen title="Add Athlete" back={{ href: `/org/${slug}/roster`, label: "Athletes" }}>
      <AthleteForm action={action} submitLabel="Add Athlete" firstMetrics advisors={advisors} />
    </Screen>
  );
}
