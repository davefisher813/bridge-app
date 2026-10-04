import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireFamily } from "@/lib/data/family";
import { Screen } from "@/components/kit";
import { SchoolDirectory } from "@/components/SchoolDirectory";
import { loadDirectory } from "@/lib/data/schoolDirectory";

export const dynamic = "force-dynamic";

// Every school on file, as a family sees the list: the same search,
// filters and A to Z the staff directory uses, with every link kept on
// the family side. Nothing about the org's recruiting is read here, so
// no athlete, target or note can reach this screen.

export default async function FamilySchoolsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; division?: string; state?: string; conference?: string; major?: string }> }) {
  const { slug } = await params;
  const { q, division, state, conference, major } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireFamily(org.id);
  const base = `/org/${slug}/family/schools`;

  const supabase = await createClient();
  const d = await loadDirectory(supabase, { q, division, state, conference, major });

  return (
    <Screen title="Schools">
      <SchoolDirectory base={base} viewer="family" filters={d.filters} options={d.options} groups={d.groups} total={d.total} />
    </Screen>
  );
}
