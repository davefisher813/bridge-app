import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { advisorOptionLabel, loadStaff } from "@/lib/data/staff";
import { loadAthleteFormOptions } from "@/lib/data/athleteFormOptions";
import { createAthlete } from "@/lib/actions/athletes";
import { AthleteForm } from "@/components/AthleteForm";
import { Screen } from "@/components/kit";

export default async function NewAthletePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [staff, options] = await Promise.all([loadStaff(supabase, org.id), loadAthleteFormOptions(supabase, org.id)]);
  const advisors = staff.map((s) => ({ id: s.id, name: advisorOptionLabel(s) }));
  const action = createAthlete.bind(null, slug);

  return (
    <Screen title="Add Athlete" back={{ href: `/org/${slug}/roster`, label: "Athletes" }}>
      <AthleteForm action={action} submitLabel="Add Athlete" firstMetrics advisors={advisors} options={options} />
    </Screen>
  );
}
