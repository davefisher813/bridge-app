// One athlete's full activity log (migration 0044): who did what to
// them, newest first, 50 entries and then Show More. Admins only; the
// entries carry names, statuses, kinds and dates and never the text of
// a note, a message or a document.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadAthleteActivity } from "@/lib/data/activity";
import { ActivityRows } from "@/components/ActivityRows";
import { EmptyState, Inline, Label, Screen, Section, TextLink } from "@/components/kit";

export const dynamic = "force-dynamic";

// Entries before Show More.
const PAGE = 50;

export default async function AthleteActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams?: Promise<{ show?: string }>;
}) {
  const { slug, id } = await params;
  const sp = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  // 50, or what the address asks for after Show More, never fewer than
  // 50 and never past a sane ceiling.
  const asked = Number(sp.show);
  const cap = Number.isFinite(asked) && asked > PAGE ? Math.min(Math.floor(asked), 5000) : PAGE;

  const supabase = await createClient();
  const [{ data: athlete }, loaded] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).single(),
    // One more than shown, so Show More knows whether there is more.
    loadAthleteActivity(supabase, org.id, id, cap + 1),
  ]);
  if (!athlete) notFound();

  const rows = loaded.slice(0, cap);
  const hasMore = loaded.length > cap;

  return (
    <Screen title="Activity" back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }} lede={`Every change recorded for ${athlete.name}, newest first`}>
      <Section label="Activity" count={hasMore ? undefined : rows.length} role="accent" kind="clock">
        {rows.length === 0 ? (
          <EmptyState kind="clock" title="No Activity Yet">
            Changes to this athlete are recorded here as they happen.
          </EmptyState>
        ) : (
          <ActivityRows slug={slug} rows={rows} liveAthletes={new Set([id])} profileLinks={false} />
        )}
        {hasMore && (
          <Inline>
            <Label>{`Showing ${rows.length}`}</Label>
            <TextLink href={`/org/${slug}/roster/${id}/activity?show=${cap + PAGE}`}>Show More</TextLink>
          </Inline>
        )}
      </Section>
    </Screen>
  );
}
