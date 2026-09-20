import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateSchool } from "@/lib/actions/schools";
import { SchoolForm, type SchoolFormInitialValues } from "@/components/SchoolForm";
import { schoolRowToFitSchool, type SchoolRow } from "@/lib/data/fitAdapters";
import { Screen } from "@/components/kit";

// Owner-only, same door as /schools/new: the row is shared reference
// data every organization reads. Saving recomputes every stored fit
// against this school in every org (docs/MATCHING_CONTRACT.md).
export default async function EditSchoolPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  const supabase = await createClient();
  const { data } = await supabase
    .from("schools")
    .select("id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date, program_tier, state, majors")
    .eq("id", id)
    .single();
  if (!data) notFound();
  const school = schoolRowToFitSchool(data as SchoolRow);
  const fin = school.financials ?? {};
  const ac = school.academics ?? {};
  const at = school.athletics ?? {};

  const initialValues: SchoolFormInitialValues = {
    name: school.name,
    division: school.division,
    programTier: school.programTier,
    conference: school.conference,
    state: school.state,
    sportsSponsored: school.sportsSponsored.join(", "),
    majors: (school.majors ?? []).join(", "),
    gpaMin: ac.gpaMin,
    gpaAvg: ac.gpaAvg,
    satRange: ac.satRange,
    actRange: ac.actRange,
    athleticScholarship: fin.athleticScholarship,
    avgAthleticAid: fin.avgAthleticAid,
    avgMeritAid: fin.avgMeritAid,
    avgNeedAid: fin.avgNeedAid,
    instateTotal: fin.instateTotal,
    outstateTotal: fin.outstateTotal,
    rosterSpotsOpen: fin.rosterSpotsOpen,
    playingTimeOutlook: at.playingTimeOutlook,
    positionDepth: at.positionDepth,
  };

  const action = updateSchool.bind(null, slug, id);

  return (
    <Screen title={`Edit ${school.name}`} back={{ href: `/org/${slug}/schools/${id}`, label: school.name }}>
      <SchoolForm action={action} initialValues={initialValues} submitLabel="Save Changes" />
    </Screen>
  );
}
