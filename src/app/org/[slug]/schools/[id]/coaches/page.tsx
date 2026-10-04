// A school's coaches in the shared directory, to correct, remove or add
// to (crud F2). Directory editors only: every org's staff read this list, so a wrong
// email or a coach who left is fixed here once, for everyone. The
// school's own page keeps the list as tap-to-email rows.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireDirectoryEditor } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadCoachesForSchool } from "@/lib/data/coaches";
import { AddButton, EmptyState, LinkButton, Row, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function SchoolCoachesPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireDirectoryEditor(org.id);

  const supabase = await createClient();
  const [{ data: school }, coaches] = await Promise.all([supabase.from("schools").select("id, name").eq("id", id).maybeSingle(), loadCoachesForSchool(supabase, id)]);
  if (!school) notFound();
  const base = `/org/${slug}/schools/${id}/coaches`;

  return (
    <Screen
      title="Coaches"
      back={{ href: `/org/${slug}/schools/${id}`, label: school.name }}
      action={<AddButton href={`${base}/new`} label="Add a Coach" />}
    >
      <Section label="Listed" count={coaches.length} role="people" kind="people">
        {coaches.length === 0 ? (
          <EmptyState kind="people" role="people" title="No Coaches Listed" action={<LinkButton href={`${base}/new`}>Add a Coach</LinkButton>} />
        ) : (
          coaches.map((c) => (
            <Row
              key={c.id}
              href={`${base}/${c.id}`}
              kind="people"
              role="people"
              title={c.name}
              meta={[c.title, c.isRecruitingCoordinator ? "Recruiting coordinator" : null, c.email, c.phone].filter(Boolean).join(" · ") || undefined}
              wrap
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
