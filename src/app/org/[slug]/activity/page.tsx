// The organization's activity log (migration 0044): who did what to
// whom across every athlete, newest first. Admins only. Search runs over
// the summary and the person's name, kept in the address (?q=), and the
// list shows 50 entries and then Show More (?show=). The entries carry
// names, statuses, kinds and dates and never the text of a note, a
// message or a document.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadOrgActivity } from "@/lib/data/activity";
import { ActivityRows } from "@/components/ActivityRows";
import { SearchField } from "@/components/SearchField";
import { EmptyState, Inline, Label, Screen, Section, TextLink } from "@/components/kit";

export const dynamic = "force-dynamic";

// Entries before Show More.
const PAGE = 50;

export default async function OrgActivityPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ q?: string; show?: string }> }) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const q = sp.q?.trim() ?? "";
  const asked = Number(sp.show);
  const cap = Number.isFinite(asked) && asked > PAGE ? Math.min(Math.floor(asked), 5000) : PAGE;

  const supabase = await createClient();
  const { rows, hasMore, total } = await loadOrgActivity(supabase, org.id, { q, limit: cap });

  // An entry opens its athlete only while that athlete is still on the
  // roster; a removed athlete's pages are gone.
  const athleteIds = [...new Set(rows.map((r) => r.athleteId).filter((v): v is string => !!v))];
  const { data: live } = athleteIds.length ? await supabase.from("athletes").select("id").eq("org_id", org.id).is("deleted_at", null).in("id", athleteIds) : { data: [] as { id: string }[] };
  const liveAthletes = new Set((live ?? []).map((a) => a.id));

  const moreHref = (() => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    next.set("show", String(cap + PAGE));
    return `/org/${slug}/activity?${next.toString()}`;
  })();

  return (
    <Screen title="Activity" back={{ href: `/org/${slug}/more`, label: "More" }} lede="Who did what, across every athlete, newest first">
      {(total > 5 || q) && <SearchField initial={q} placeholder="A name or something that was done" />}
      <Section label="Activity" count={total} role="accent" kind="clock">
        {rows.length === 0 ? (
          <EmptyState kind="clock" title={q ? "Nothing Matches" : "No Activity Yet"}>
            {q ? "Try part of a name, or clear the search." : "Changes are recorded here as they happen."}
          </EmptyState>
        ) : (
          <ActivityRows slug={slug} rows={rows} liveAthletes={liveAthletes} />
        )}
        {hasMore && (
          <Inline>
            <Label>{`Showing ${rows.length} of ${total}`}</Label>
            <TextLink href={moreHref}>Show More</TextLink>
          </Inline>
        )}
      </Section>
    </Screen>
  );
}
