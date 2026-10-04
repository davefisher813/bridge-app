// Every school on file, as a member (Bridge: Board) sees it: the same
// directory staff and families browse, with search and the four
// filters. Only the shared reference table is read here, never an org
// row (see the note at the top of src/lib/data/member.ts), and every
// link stays under /member.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireMember } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { Screen } from "@/components/kit";
import { SchoolDirectory } from "@/components/SchoolDirectory";
import { loadDirectory } from "@/lib/data/schoolDirectory";

export const dynamic = "force-dynamic";

export default async function MemberSchoolsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; division?: string; state?: string; conference?: string; major?: string }> }) {
  const { slug } = await params;
  const { q, division, state, conference, major } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireMember(org.id);
  const home = `/org/${slug}/member`;
  const base = `${home}/schools`;

  const supabase = await createClient();
  const d = await loadDirectory(supabase, { q, division, state, conference, major });

  return (
    <Screen title="Schools" back={{ href: home, label: "Home" }}>
      <SchoolDirectory base={base} viewer="member" filters={d.filters} options={d.options} groups={d.groups} total={d.total} />
    </Screen>
  );
}
