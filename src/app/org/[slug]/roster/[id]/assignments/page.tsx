import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { groupAssignments, loadAthleteAssignments, sortByUrgency, todayIso } from "@/lib/data/assignments";
import { AssignmentRows } from "@/components/AssignmentRows";
import { AddButton, EmptyState, LinkButton, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

// One athlete's whole assignment list (migration 0046), grouped Open,
// Submitted and Done. Admins only: the athlete login has its own,
// smaller view on the family screens, and a Viewer sees none. Within a
// group the order is by urgency, so what is late is first.
export default async function AthleteAssignmentsPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) notFound();

  const today = todayIso();
  const rows = sortByUrgency(await loadAthleteAssignments(supabase, org.id, id), today);
  const { open, submitted, done } = groupAssignments(rows);
  const newHref = `/org/${slug}/roster/${id}/assignments/new`;

  return (
    <Screen
      title="Assignments"
      back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}
      lede={rows.length === 0 ? "Nothing assigned yet" : `${open.length} open, ${submitted.length} waiting on review`}
      action={<AddButton href={newHref} label="New Assignment" />}
    >
      {rows.length === 0 && (
        <EmptyState kind="checklist" role="contact" title="No Assignments Yet" action={<LinkButton href={newHref}>New Assignment</LinkButton>} />
      )}
      {open.length > 0 && (
        <Section label="Open" count={open.length} role="contact" kind="checklist">
          <AssignmentRows slug={slug} rows={open} today={today} />
        </Section>
      )}
      {submitted.length > 0 && (
        <Section label="Submitted" count={submitted.length} role="place" kind="document">
          <AssignmentRows slug={slug} rows={submitted} today={today} />
        </Section>
      )}
      {done.length > 0 && (
        <Section label="Done" count={done.length} role="committed" kind="check">
          <AssignmentRows slug={slug} rows={done} today={today} />
        </Section>
      )}
    </Screen>
  );
}
