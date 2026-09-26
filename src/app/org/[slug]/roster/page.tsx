import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { AddButton, Avatar, Body, EmptyState, LinkButton, Row, Screen, Section, TextLink } from "@/components/kit";
import { SearchField } from "@/components/SearchField";
import { effectiveStatus, placementAthlete, placementLine, placementOf } from "@/lib/placement";
import { ATHLETE_STATUSES } from "@/lib/validation/athlete";

interface AthleteRow {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  recruit_type: string;
  gpa: number | null;
  status: string;
  detail: unknown;
  draft_team: string | null;
  draft_round: number | null;
  draft_year: number | null;
}

interface CommittedRow {
  id: string;
  athlete_id: string;
  status: string;
  schools: { name: string } | { name: string }[] | null;
}

const RECRUIT_TYPE_LABEL: Record<string, string> = {
  hs: "High School",
  transfer_4to4: "Transfer (4-to-4)",
  transfer_juco: "Transfer (JUCO)",
  transfer_grad: "Transfer (Grad)",
};

// The roster. Staff and owners add and edit; members read.
export default async function RosterPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ q?: string; status?: string }> }) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const q = sp.q?.trim().toLowerCase() ?? "";
  // Only a status the vocabulary knows narrows the list; anything else
  // shows everyone rather than an empty screen.
  const status = (ATHLETE_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "";
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: athletes }, { data: committedRows }] = await Promise.all([
    supabase.from("athletes").select("id, name, sport, position, recruit_type, gpa, status, detail, draft_team, draft_round, draft_year").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("recruiting_targets").select("id, athlete_id, status, schools(name)").eq("org_id", org.id).eq("status", "Committed"),
  ]);
  const committedByAthlete = new Map<string, { id: string; status: string; schoolName: string | null }[]>();
  for (const t of (committedRows ?? []) as CommittedRow[]) {
    const school = Array.isArray(t.schools) ? t.schools[0] : t.schools;
    committedByAthlete.set(t.athlete_id, [...(committedByAthlete.get(t.athlete_id) ?? []), { id: t.id, status: t.status, schoolName: school?.name ?? null }]);
  }

  // Placed: where they went, in place of the recruit type, which no
  // longer describes what is going on. Worked out once per athlete so
  // the status filter and the pill read the same value.
  const all = ((athletes ?? []) as AthleteRow[]).map((a) => {
    const placement = placementOf(placementAthlete(a), committedByAthlete.get(a.id) ?? []);
    return { ...a, placement, effective: effectiveStatus(placementAthlete(a), committedByAthlete.get(a.id) ?? []) };
  });
  // Name, sport or position, on top of the status. Filtered here rather
  // than in the query so the list, the count and the empty state agree
  // with each other, and with the tile on Today that opened this.
  const searched = q ? all.filter((a) => `${a.name} ${a.sport} ${a.position ?? ""}`.toLowerCase().includes(q)) : all;
  const rows = status ? searched.filter((a) => a.effective === status) : searched;

  return (
    <Screen title="Athletes" lede={status ? `${rows.length} of ${all.length}, ${status}` : undefined} action={canEdit ? <AddButton href={`/org/${slug}/roster/new`} label="Add" /> : undefined}>
      {status && <TextLink href={`/org/${slug}/roster`}>Show Every Athlete</TextLink>}
      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A name, a sport or a position" />}
      <Section label="Roster" count={rows.length} role="people" kind="athlete">
        {rows.length === 0 ? (
          <EmptyState kind="athlete" title={q ? "Nobody Matches" : status ? "Nothing Matches" : "No Athletes Yet"}>
            {q ? "Try a shorter name, or clear the search." : status ? "Nobody is at this status. Show every athlete to see the rest." : canEdit ? "Add the first one below." : "Ask an owner or coordinator to add one."}
          </EmptyState>
        ) : (
          rows.map((a) => (
            <Row
              key={a.id}
              href={`/org/${slug}/roster/${a.id}`}
              leading={<Avatar name={a.name} />}
              title={a.name}
              meta={`${a.sport}${a.position ? ` · ${a.position}` : ""} · ${a.placement ? placementLine(a.placement) : (RECRUIT_TYPE_LABEL[a.recruit_type] ?? a.recruit_type)}`}
              trailing={
                <>
                  <Body weight="semibold" numeric>
                    {a.gpa != null ? Number(a.gpa).toFixed(2) : "–"}
                  </Body>
                  <StatusPill status={a.effective} />
                </>
              }
            />
          ))
        )}
      </Section>
      {canEdit && all.length === 0 && <LinkButton href={`/org/${slug}/roster/new`}>Add Your First Athlete</LinkButton>}
    </Screen>
  );
}
