import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { cancelAssignment, completeAssignment, reviewAssignmentForm } from "@/lib/actions/assignments";
import { ASSIGNMENT_CATEGORY_LABEL, ASSIGNMENT_KIND_LABEL, loadAssignment, loadAssignmentDocument, todayIso } from "@/lib/data/assignments";
import { AssignmentReview } from "@/components/AssignmentReview";
import { AssignmentStatusChips, dueLabel } from "@/components/AssignmentRows";
import { Body, Card, Chevron, ConfirmButton, Form, Label, Notice, Row, Screen, Section, Stack } from "@/components/kit";

export const dynamic = "force-dynamic";

// The size as a person reads it: "240 KB", "1.2 MB".
function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// One assignment, and its review (migration 0046). Admins only.
//
// A submitted assignment is reviewed here: Complete, or Needs Revision
// with the comment the athlete login will read. Cancel is offered on
// anything not yet done and asks first. A file the athlete sent is a Row
// to the document screen, where an Admin can run the existing Doc AI
// read as they can on any document; nothing reads it on its own.
export default async function AssignmentDetailPage({ params }: { params: Promise<{ slug: string; id: string; assignmentId: string }> }) {
  const { slug, id, assignmentId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, assignment] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    loadAssignment(supabase, org.id, id, assignmentId),
  ]);
  if (!athlete || !assignment) notFound();
  const document = await loadAssignmentDocument(supabase, org.id, id, assignment.documentId);

  const today = todayIso();
  const listHref = `/org/${slug}/roster/${id}/assignments`;
  const canCancel = assignment.status === "assigned" || assignment.status === "submitted" || assignment.status === "needs_revision";
  const category = ASSIGNMENT_CATEGORY_LABEL[assignment.category];
  const kind = ASSIGNMENT_KIND_LABEL[assignment.kind];
  // "Other" for both would read twice, so a repeated word is said once.
  const details = [category, kind === category ? null : kind, dueLabel(assignment.dueOn)].filter(Boolean).join(" · ");

  return (
    <Screen title={assignment.title} back={{ href: listHref, label: "Assignments" }} lede={athlete.name}>
      <Card isStatic>
        <Stack gap={2}>
          <div className="flex flex-wrap items-center gap-3">
            <AssignmentStatusChips status={assignment.status} dueOn={assignment.dueOn} today={today} />
          </div>
          <Label>{details}</Label>
          {assignment.instructions && <Body>{assignment.instructions}</Body>}
        </Stack>
      </Card>

      {assignment.status === "assigned" && (
        <Notice tone="info" title="Waiting on the Athlete">
          The athlete login sees this and sends it back here when it is done.
        </Notice>
      )}

      {assignment.submittedAt && (
        <Section label="Submission" role="place" kind="document">
          <Card isStatic>
            <Stack gap={2}>
              <Label>{`Sent ${longDate(assignment.submittedAt.slice(0, 10))}`}</Label>
              {assignment.familyNote ? <Body>{assignment.familyNote}</Body> : <Label>No note with it.</Label>}
            </Stack>
          </Card>
          {document && (
            <Row
              href={`/org/${slug}/documents/${document.id}`}
              kind="document"
              role="place"
              title={document.fileName}
              meta={`${document.mediaType === "application/pdf" ? "PDF" : "Image"} · ${sizeLabel(document.fileSize)} · Family Upload`}
              trailing={<Chevron />}
              wrap
            />
          )}
        </Section>
      )}

      {assignment.reviewerComment && (
        <Section label="Reviewer Comment" role="accent" kind="note">
          <Card isStatic>
            <Stack gap={2}>
              {assignment.reviewedAt && <Label>{`Reviewed ${longDate(assignment.reviewedAt.slice(0, 10))}`}</Label>}
              <Body>{assignment.reviewerComment}</Body>
            </Stack>
          </Card>
        </Section>
      )}

      {assignment.status === "submitted" && (
        <Section label="Review" role="accent" kind="check">
          <AssignmentReview complete={completeAssignment.bind(null, slug, id, assignmentId)} revise={reviewAssignmentForm.bind(null, slug, id, assignmentId, "needs_revision")} />
        </Section>
      )}

      {canCancel && (
        <Form action={cancelAssignment.bind(null, slug, id, assignmentId)}>
          <ConfirmButton title="Cancel This Assignment?" body="It comes off the athlete's list. The history stays." confirmLabel="Cancel Assignment">
            Cancel Assignment
          </ConfirmButton>
        </Form>
      )}
    </Screen>
  );
}
