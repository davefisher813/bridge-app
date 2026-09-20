import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createSchool } from "@/lib/actions/schools";
import { SchoolForm } from "@/components/SchoolForm";
import { Screen } from "@/components/kit";

// Owner-only: schools is shared reference data across every org, not
// scoped to this one, so this isn't "staff can manage their org's
// schools" - it's a deliberately narrow door into data every other org
// also reads. See docs/DECISIONS.md and src/lib/actions/schools.ts.
export default async function NewSchoolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  const action = createSchool.bind(null, slug);

  return (
    <Screen title="Add School" back={{ href: `/org/${slug}/schools`, label: "Schools" }}>
      <SchoolForm action={action} submitLabel="Add School" />
    </Screen>
  );
}
