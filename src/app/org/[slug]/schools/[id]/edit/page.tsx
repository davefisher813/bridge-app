import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireDirectoryEditor } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { deleteSchool, mergeSchool, updateSchool } from "@/lib/actions/schools";
import { SchoolForm, type SchoolFormInitialValues } from "@/components/SchoolForm";
import { schoolRowToFitSchool, type SchoolRow } from "@/lib/data/fitAdapters";
import { loadDirectory } from "@/lib/data/schoolDirectory";
import { ConfirmButton, Form, Notice, Screen, Section, SelectField } from "@/components/kit";

export const dynamic = "force-dynamic";

// Directory editors only, same door as /schools/new: the row is shared reference
// data every organization reads. Saving recomputes every stored fit
// against this school in every org (docs/MATCHING_CONTRACT.md).
//
// Below the form, the two ways a school leaves the directory (crud F3):
// merge a duplicate into the row to keep, which moves every target,
// note, coach and contact across first, or remove a row nobody uses.
// Remove is refused while anything in any org still points at it.
export default async function EditSchoolPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = (await searchParams) ?? {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireDirectoryEditor(org.id);

  const supabase = await createClient();
  const [{ data }, directory] = await Promise.all([
    supabase
      .from("schools")
      .select("id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date, program_tier, state, majors, location")
      .eq("id", id)
      .single(),
    loadDirectory(supabase),
  ]);
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
    location: (data as { location?: string | null }).location ?? undefined,
    sportsSponsored: school.sportsSponsored.join(", "),
    majors: (school.majors ?? []).join(", "),
    gpaMin: ac.gpaMin,
    gpaAvg: ac.gpaAvg,
    satRange: ac.satRange,
    actRange: ac.actRange,
    majorsNote: ac.majorsNote,
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
  const others = directory.rows.filter((s) => s.id !== id);

  return (
    <Screen title={`Edit ${school.name}`} back={{ href: `/org/${slug}/schools/${id}`, label: school.name }}>
      {error && (
        <Notice tone="danger" title="Could Not Change the School">
          {error}
        </Notice>
      )}
      <SchoolForm action={action} initialValues={initialValues} submitLabel="Save Changes" slug={slug} conferences={directory.options.conferences} />

      <Section label="Duplicate or Mistake" role="danger" kind="warning">
        {others.length > 0 && (
          <Form action={mergeSchool.bind(null, slug, id)}>
            <SelectField name="mergeInto" label="Merge Into" defaultValue="" hint="The school to keep. Every target, note, coach and contact here moves to it, in every organization.">
              <option value="" disabled>
                Pick the School to Keep
              </option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {[s.name, s.division, s.state].filter(Boolean).join(" · ")}
                </option>
              ))}
            </SelectField>
            <ConfirmButton
              title={`Merge ${school.name}?`}
              body="Everything that points at this school moves to the one you picked, then this row is deleted for every organization. It cannot be undone."
              confirmLabel="Merge"
            >
              Merge
            </ConfirmButton>
          </Form>
        )}
        <Form action={deleteSchool.bind(null, slug, id)}>
          <ConfirmButton
            title={`Remove ${school.name}?`}
            body="It leaves the directory for every organization. Refused while any target, note, coach or contact still points at it."
            confirmLabel="Remove School"
          >
            Remove School
          </ConfirmButton>
        </Form>
      </Section>
    </Screen>
  );
}
