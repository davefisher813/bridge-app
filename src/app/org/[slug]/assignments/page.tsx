import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { computeDueSoon, computeOverdue, isOpenStatus, loadOrgAssignments, partitionOrgAssignments, sortByUrgency, todayIso } from "@/lib/data/assignments";
import { AssignmentRows } from "@/components/AssignmentRows";
import { SearchField } from "@/components/SearchField";
import { EmptyState, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

// Every athlete's open work in one place (migration 0046): what is
// waiting on a review, what is overdue, what is due soon, and the rest of
// the open rows after that. Admins only. Search runs over the title and
// the athlete's name, kept in the address (?q=), and appears once there
// are more than five to look through. Overdue and Due Soon are computed
// from the due date on every load; nothing stored says so.
export default async function OrgAssignmentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const q = sp.q?.trim().toLowerCase() ?? "";
  const supabase = await createClient();
  const all = await loadOrgAssignments(supabase, org.id, { openOnly: true });
  const searched = q ? all.filter((r) => `${r.title} ${r.athleteName}`.toLowerCase().includes(q)) : all;

  const today = todayIso();
  const { submitted, overdue, dueSoon } = partitionOrgAssignments(searched, today);
  // The open rows that are neither late nor soon: due later, or no date.
  const later = sortByUrgency(
    searched.filter((r) => isOpenStatus(r.status) && !computeOverdue(r.dueOn, r.status, today) && !computeDueSoon(r.dueOn, r.status, today)),
    today,
  );

  return (
    <Screen title="Assignments" back={{ href: `/org/${slug}/more`, label: "More" }} lede="Open and submitted work, across every athlete">
      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A title or an athlete" />}
      {searched.length === 0 && (
        <EmptyState kind="checklist" role="contact" title={q ? "Nothing Matches" : "Nothing Open"} />
      )}
      {submitted.length > 0 && (
        <Section label="Submitted for Review" count={submitted.length} role="place" kind="document">
          <AssignmentRows slug={slug} rows={submitted} today={today} showAthlete />
        </Section>
      )}
      {overdue.length > 0 && (
        <Section label="Overdue" count={overdue.length} role="danger" kind="warning">
          <AssignmentRows slug={slug} rows={overdue} today={today} showAthlete />
        </Section>
      )}
      {dueSoon.length > 0 && (
        <Section label="Due Soon" count={dueSoon.length} role="time" kind="clock">
          <AssignmentRows slug={slug} rows={dueSoon} today={today} showAthlete />
        </Section>
      )}
      {later.length > 0 && (
        <Section label="Open" count={later.length} role="contact" kind="checklist">
          <AssignmentRows slug={slug} rows={later} today={today} showAthlete />
        </Section>
      )}
    </Screen>
  );
}
