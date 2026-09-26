import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireFamily } from "@/lib/data/family";
import { Screen } from "@/components/kit";
import { loadSchoolFacts } from "@/lib/data/schoolDirectory";
import { SchoolAcademics, SchoolMoneyAndDepth, schoolLede } from "@/components/SchoolProfile";

export const dynamic = "force-dynamic";

// One school, as a family sees it: the shared facts every role sees
// (the numbers, money with the D3 rule, the depth chart, the flags) and
// nothing of the org's own side. The school row is the only read, so no
// coach, note, target, score or athlete can appear here by construction.

export default async function FamilySchoolPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireFamily(org.id);
  const base = `/org/${slug}/family/schools`;

  const supabase = await createClient();
  const facts = await loadSchoolFacts(supabase, id);
  if (!facts) notFound();
  const { school, location } = facts;

  return (
    <Screen title={school.name} back={{ href: base, label: "Schools" }} lede={schoolLede(school, location)}>
      <SchoolAcademics school={school} viewer="family" />
      <SchoolMoneyAndDepth school={school} viewer="family" />
    </Screen>
  );
}
