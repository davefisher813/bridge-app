import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { Avatar, Body, EmptyState, LinkButton, Row, Screen, Section, TextLink } from "@/components/kit";

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
export default async function RosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const { data: athletes } = await supabase
    .from("athletes")
    .select("id, name, sport, position, recruit_type, gpa, status")
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .order("name");

  const rows = (athletes ?? []) as AthleteRow[];

  return (
    <Screen title="Athletes" action={canEdit ? <TextLink href={`/org/${slug}/roster/new`}>+ Add</TextLink> : undefined}>
      <Section label="Roster" count={rows.length} role="people" kind="athlete">
        {rows.length === 0 ? (
          <EmptyState kind="athlete" title="No athletes yet">
            {canEdit ? "Add the first one below." : "Ask an owner or coordinator to add one."}
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
