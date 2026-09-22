import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { AddButton, Avatar, Body, EmptyState, LinkButton, Row, Screen, Section } from "@/components/kit";
import { SearchField } from "@/components/SearchField";

interface AthleteRow {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  recruit_type: string;
  gpa: number | null;
  status: string;
}

const RECRUIT_TYPE_LABEL: Record<string, string> = {
  hs: "High School",
  transfer_4to4: "Transfer (4-to-4)",
  transfer_juco: "Transfer (JUCO)",
  transfer_grad: "Transfer (Grad)",
};

// The roster. Staff and owners add and edit; members read.
export default async function RosterPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const q = (searchParams ? (await searchParams).q : "")?.trim().toLowerCase() ?? "";
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const { data: athletes } = await supabase
    .from("athletes")
    .select("id, name, sport, position, recruit_type, gpa, status")
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .order("name");

  const all = (athletes ?? []) as AthleteRow[];
  // Name, sport or position. Filtered here rather than in the query so
  // the list, the count and the empty state agree with each other.
  const rows = q ? all.filter((a) => `${a.name} ${a.sport} ${a.position ?? ""}`.toLowerCase().includes(q)) : all;

  return (
    <Screen title="Athletes" action={canEdit ? <AddButton href={`/org/${slug}/roster/new`} label="Add" /> : undefined}>
      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A name, a sport or a position" />}
      <Section label="Roster" count={rows.length} role="people" kind="athlete">
        {rows.length === 0 ? (
          <EmptyState kind="athlete" title={q ? "Nobody Matches" : "No Athletes Yet"}>
            {q ? "Try a shorter name, or clear the search." : canEdit ? "Add the first one below." : "Ask an owner or coordinator to add one."}
          </EmptyState>
        ) : (
          rows.map((a) => (
            <Row
              key={a.id}
              href={`/org/${slug}/roster/${a.id}`}
              leading={<Avatar name={a.name} />}
              title={a.name}
              meta={`${a.sport}${a.position ? ` · ${a.position}` : ""} · ${RECRUIT_TYPE_LABEL[a.recruit_type] ?? a.recruit_type}`}
              trailing={
                <>
                  <Body weight="semibold" numeric>
                    {a.gpa != null ? Number(a.gpa).toFixed(2) : "–"}
                  </Body>
                  <StatusPill status={a.status} />
                </>
              }
            />
          ))
        )}
      </Section>
      {canEdit && rows.length === 0 && <LinkButton href={`/org/${slug}/roster/new`}>Add Your First Athlete</LinkButton>}
    </Screen>
  );
}
