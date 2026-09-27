import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireDirectoryEditor } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createSchool } from "@/lib/actions/schools";
import { loadDirectory } from "@/lib/data/schoolDirectory";
import { SchoolForm } from "@/components/SchoolForm";
import { Screen } from "@/components/kit";

// Directory editors only (an owner of an org with
// orgs.edits_shared_directory on, migration 0040): schools is shared
// reference data across every org, not
// scoped to this one, so this isn't "staff can manage their org's
// schools" - it's a deliberately narrow door into data every other org
// also reads. See docs/DECISIONS.md and src/lib/actions/schools.ts.
export default async function NewSchoolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireDirectoryEditor(org.id);

  // The conferences already on file, for the Conference suggestions.
  const supabase = await createClient();
  const { options } = await loadDirectory(supabase);

  const action = createSchool.bind(null, slug);

  return (
    <Screen title="Add School" back={{ href: `/org/${slug}/schools`, label: "Schools" }}>
      <SchoolForm action={action} submitLabel="Add School" slug={slug} conferences={options.conferences} />
    </Screen>
  );
}
