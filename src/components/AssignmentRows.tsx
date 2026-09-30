import { longDate } from "@/lib/copy/dates";
import {
  ASSIGNMENT_CATEGORY_LABEL,
  ASSIGNMENT_STATUS_LABEL,
  computeOverdue,
  type Assignment,
  type AssignmentStatus,
  type OrgAssignment,
} from "@/lib/data/assignments";
import type { RowKind } from "@/components/RowGlyph";
import type { Role } from "@/components/statusHue";
import { Chevron, Chip, Row } from "@/components/kit";

// An assignment as a list row (migration 0046), shared by the profile's
// Assignments section, the athlete's full list and the org-wide list.
// The title is the row's title, "who or what kind, and when it is due"
// is its meta, and the status is the Chip at the right.
//
// Assignments have their own status language: the five values are not
// athlete or target stages, so they do not go through StatusPill or
// STATUS_ROLE (src/components/statusHue.ts, which the render law counts
// against the athlete statuses). The map is here, beside its only
// readers. Overdue is not a status and is never stored: it is computed
// from the due date and the status (computeOverdue) each time a row is
// drawn, and shows as one more Chip above the status.

export const ASSIGNMENT_STATUS_CHIP: Record<AssignmentStatus, { kind: RowKind; role: Role }> = {
  assigned: { kind: "checklist", role: "contact" },
  submitted: { kind: "document", role: "place" },
  needs_revision: { kind: "flag", role: "offer" },
  complete: { kind: "check", role: "committed" },
  cancelled: { kind: "blocked", role: "neutral" },
};

const OVERDUE_CHIP: { kind: RowKind; role: Role } = { kind: "warning", role: "danger" };

// The status as a Chip. Overdue, when it applies, is shown beside it and
// not instead of it: a sent-back row that is also late is both.
export function AssignmentStatusChips({ status, dueOn, today }: { status: AssignmentStatus; dueOn: string | null; today: string }) {
  const chip = ASSIGNMENT_STATUS_CHIP[status];
  return (
    <>
      {computeOverdue(dueOn, status, today) && <Chip label="Overdue" kind={OVERDUE_CHIP.kind} role={OVERDUE_CHIP.role} />}
      <Chip label={ASSIGNMENT_STATUS_LABEL[status]} kind={chip.kind} role={chip.role} />
    </>
  );
}

// "Due Sep 1, 2026", or that it has no date. A meta line is a sentence,
// so only the first word is capitalised.
export function dueLabel(dueOn: string | null): string {
  return dueOn ? `Due ${longDate(dueOn)}` : "No due date";
}

// The glyph on the left: what the row is about, in the status's hue, so
// a page of them scans by colour before it is read.
export function AssignmentRow({ slug, row, today, showAthlete = false }: { slug: string; row: Assignment | OrgAssignment; today: string; showAthlete?: boolean }) {
  const chip = ASSIGNMENT_STATUS_CHIP[row.status];
  const athlete = showAthlete && "athleteName" in row ? row.athleteName : null;
  const meta = [athlete, ASSIGNMENT_CATEGORY_LABEL[row.category], dueLabel(row.dueOn)].filter(Boolean).join(" · ");
  return (
    <Row
      href={`/org/${slug}/roster/${row.athleteId}/assignments/${row.id}`}
      kind="checklist"
      role={chip.role}
      title={row.title}
      meta={meta}
      trailing={
        <>
          <AssignmentStatusChips status={row.status} dueOn={row.dueOn} today={today} />
          <Chevron />
        </>
      }
      wrap
    />
  );
}

export function AssignmentRows({ slug, rows, today, showAthlete = false }: { slug: string; rows: readonly (Assignment | OrgAssignment)[]; today: string; showAthlete?: boolean }) {
  return (
    <>
      {rows.map((r) => (
        <AssignmentRow key={r.id} slug={slug} row={r} today={today} showAthlete={showAthlete} />
      ))}
    </>
  );
}
