// One school, as a member (Bridge: Board) sees it: the shared facts
// only (the numbers, money with the D3 rule, the depth chart, the
// flags). No coaches, no org notes, no athletes, no scores: nothing
// here is read beyond the school row itself, so none of that can
// reach the page. The one link is back to the member directory.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireMember } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { Screen } from "@/components/kit";
import { SchoolAcademics, SchoolMoneyAndDepth, schoolLede } from "@/components/SchoolProfile";
import { loadSchoolFacts } from "@/lib/data/schoolDirectory";

export const dynamic = "force-dynamic";

export default async function MemberSchoolPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireMember(org.id);
  const base = `/org/${slug}/member/schools`;

  const supabase = await createClient();
  const facts = await loadSchoolFacts(supabase, id);
  if (!facts) notFound();
  const { school, location } = facts;

  return (
    <Screen title={school.name} back={{ href: base, label: "Schools" }} lede={schoolLede(school, location)}>
      <SchoolAcademics school={school} viewer="member" />
      <SchoolMoneyAndDepth school={school} viewer="member" />
    </Screen>
  );
}
