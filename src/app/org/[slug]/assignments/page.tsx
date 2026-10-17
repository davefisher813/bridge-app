import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { computeDueSoon, computeOverdue, isOpenStatus, loadOrgAssignments, partitionOrgAssignments, sortByUrgency, todayIso } from "@/lib/data/assignments";
import { AssignmentRows } from "@/components/AssignmentRows";
import { SearchField } from "@/components/SearchField";
import {
  bulkCancelAssignments,
  bulkChangeDueDate,
  bulkCompleteAssignments,
  bulkDeleteAssignments,
  bulkReassignAssignments,
} from "@/lib/actions/assignmentsBulk";
import { BulkAction, BulkSelect, EmptyState, Field, Screen, Section, SelectField } from "@/components/kit";

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

  // Active athletes, for Reassign's picker.
  const { data: athleteRows } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name");
  const athletes = (athleteRows ?? []) as { id: string; name: string }[];

  const today = todayIso();
  const { submitted, overdue, dueSoon } = partitionOrgAssignments(searched, today);
  // The open rows that are neither late nor soon: due later, or no date.
  const later = sortByUrgency(
    searched.filter((r) => isOpenStatus(r.status) && !computeOverdue(r.dueOn, r.status, today) && !computeDueSoon(r.dueOn, r.status, today)),
    today,
  );

  const actions = (
    <>
      <BulkAction
        action={bulkCompleteAssignments.bind(null, slug)}
        label="Mark Complete"
        noun="assignment"
        question="Mark {n} Complete"
        confirmLabel="Mark Complete"
        hint="Open, overdue and submitted work is marked complete and stamped with your name. Work already complete or cancelled is skipped."
      />
      <BulkAction
        action={bulkReassignAssignments.bind(null, slug)}
        label="Reassign"
        noun="assignment"
        question="Reassign {n}"
        confirmLabel="Reassign"
        hint="The work moves to the athlete you pick. Submitted work and work with a file stay where they are."
        fields={
          <SelectField name="athlete_id" label="Move To" defaultValue="" required>
            <option value="" disabled>
              Pick an Athlete
            </option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
        }
      />
      <BulkAction
        action={bulkChangeDueDate.bind(null, slug)}
        label="Change Due Date"
        noun="assignment"
        question="Change the Due Date on {n}"
        confirmLabel="Change Due Date"
        hint="Leave the date blank to clear it. Complete and cancelled work keeps its date."
        fields={<Field name="due_on" label="Due Date" type="date" />}
      />
      <BulkAction
        action={bulkCancelAssignments.bind(null, slug)}
        label="Cancel"
        noun="assignment"
        question="Cancel {n}"
        confirmLabel="Cancel Assignments"
        hint="Cancelled work stays in each athlete's history. Complete work is skipped."
      />
      <BulkAction
        action={bulkDeleteAssignments.bind(null, slug)}
        label="Delete"
        noun="assignment"
        question="Delete {n}"
        confirmLabel="Delete Forever"
        destructive
        hint="This removes them for good, whatever their status. There is no undo. Cancel keeps them in the history instead."
      />
    </>
  );

  return (
    <Screen title="Assignments" back={{ href: `/org/${slug}/more`, label: "More" }}>
      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A title or an athlete" />}
      {searched.length === 0 && (
        <EmptyState kind="checklist" role="contact" title={q ? "Nothing Matches" : "Nothing Open"} />
      )}
      <BulkSelect ids={searched.map((r) => r.id)} noun="assignment" actions={actions}>
        {submitted.length > 0 && (
          <Section label="Submitted for Review" count={submitted.length} role="place" kind="document">
            <AssignmentRows selectable slug={slug} rows={submitted} today={today} showAthlete />
          </Section>
        )}
        {overdue.length > 0 && (
          <Section label="Overdue" count={overdue.length} role="danger" kind="warning">
            <AssignmentRows selectable slug={slug} rows={overdue} today={today} showAthlete />
          </Section>
        )}
        {dueSoon.length > 0 && (
          <Section label="Due Soon" count={dueSoon.length} role="time" kind="clock">
            <AssignmentRows selectable slug={slug} rows={dueSoon} today={today} showAthlete />
          </Section>
        )}
        {later.length > 0 && (
          <Section label="Open" count={later.length} role="contact" kind="checklist">
            <AssignmentRows selectable slug={slug} rows={later} today={today} showAthlete />
          </Section>
        )}
      </BulkSelect>
    </Screen>
  );
}
