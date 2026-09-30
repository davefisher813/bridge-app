import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { ASSIGNMENT_CATEGORY_LABEL, computeOverdue, isOpenStatus, loadAssignment, todayIso } from "@/lib/data/assignments";
import { AssignmentSubmitForm } from "@/components/AssignmentSubmitForm";
import { Card, Notice, Prose, Screen, Section } from "@/components/kit";

// One assignment, as the Athlete login answers it (migration 0046). The
// family sees the instructions, the due date and, on a row sent back, the
// reviewer's comment, and nothing else the Admins keep on it. A cancelled
// row is not found. Every link stays under /family/, and the athlete must
// be one this login is linked to (requireFamilyAthlete); the assignment is
// read scoped to that athlete, so another athlete's id is not found.

export default async function FamilyAssignmentPage({ params }: { params: Promise<{ slug: string; id: string; assignmentId: string }> }) {
  const { slug, id, assignmentId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const { athlete } = await requireFamilyAthlete(org.id, user.id, id);
  const here = `/org/${slug}/family/${id}`;

  const supabase = await createClient();
  const assignment = await loadAssignment(supabase, org.id, id, assignmentId);
  if (!assignment || assignment.status === "cancelled") notFound();

  const open = isOpenStatus(assignment.status);
  const overdue = computeOverdue(assignment.dueOn, assignment.status, todayIso());
  const lede = [ASSIGNMENT_CATEGORY_LABEL[assignment.category], assignment.dueOn ? `Due ${longDate(assignment.dueOn)}` : "No due date", overdue ? "Overdue" : null].filter(Boolean).join(" · ");

  return (
    <Screen title={assignment.title} back={{ href: here, label: athlete.name }} lede={lede}>
      {assignment.instructions && (
        <Section label="Instructions" role="contact" kind="note">
          <Card isStatic>
            <Prose tone="ink">{assignment.instructions}</Prose>
          </Card>
        </Section>
      )}

      {assignment.status === "needs_revision" && assignment.reviewerComment && (
        <Notice tone="warning" title="What to Change">
          {assignment.reviewerComment}
        </Notice>
      )}

      {open ? (
        <AssignmentSubmitForm slug={slug} orgId={org.id} athleteId={id} assignmentId={assignment.id} kind={assignment.kind} resubmit={assignment.status === "needs_revision"} />
      ) : assignment.status === "submitted" ? (
        <Notice tone="info" title="Sent for Review">
          An Admin will look at it. If it needs a change, it comes back to your list.
        </Notice>
      ) : (
        <Notice tone="success" title="Complete">
          An Admin reviewed this one and it is done.
        </Notice>
      )}
    </Screen>
  );
}
