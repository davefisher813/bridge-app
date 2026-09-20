// Every course checked against its school's NCAA approved list, grouped
// by what happened.
//
// Ordered worst first: what is not on the list, then what could not be
// settled, then what is unchecked, then what is fine. A hundred approved
// rows above the two that cost credits is the wrong way round.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { loadEligibility } from "@/lib/data/loadEligibility";
import { EmptyState, LinkButton, Row, Screen, Section } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { RowKind } from "@/components/RowGlyph";
import type { Role } from "@/components/statusHue";

export const dynamic = "force-dynamic";

const GROUPS: Array<{ status: string; label: string; role: Role; kind: RowKind }> = [
  { status: "not_approved", label: "Not on the list", role: "target", kind: "blocked" },
  { status: "ambiguous", label: "Two matches", role: "offer", kind: "warning" },
  { status: "unknown", label: "Unchecked", role: "offer", kind: "note" },
  { status: "approved", label: "On the list", role: "committed", kind: "check" },
];

export default async function ApprovalsPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, ["owner", "staff", "member"]);

  const bundle = await loadEligibility(org.id, id, new Date().toISOString().slice(0, 10));
  if (!bundle) notFound();
  const { athlete, view } = bundle;

  return (
    <Screen
      title="Approved Courses"
      back={{ href: `/org/${slug}/roster/${id}/eligibility`, label: "NCAA Eligibility" }}
      lede={`${athlete.name} · ${view.approvals.length} checked`}
    >
      {view.approvals.length === 0 ? (
        <EmptyState kind="checklist" title="Nothing to Check">
          No courses on file yet.
        </EmptyState>
      ) : (
        GROUPS.map(({ status, label, role, kind }) => {
          const rows = view.approvals.filter((a) => a.match.status === status);
          if (rows.length === 0) return null;
          return (
            <Section key={status} label={label} count={rows.length} role={role} kind={kind}>
              {rows.map((a, i) => (
                <Row
                  key={a.title + i}
                  kind={kind}
                  role={role}
                  title={a.title}
                  meta={
                    status === "approved"
                      ? `${a.school} · ${a.match.how === "exact" ? "exact title" : "matched on the title"}`
                      : status === "ambiguous"
                        ? `Could be ${(a.match.candidates ?? []).join(" or ")}`
                        : status === "not_approved"
                          ? "Does not count toward the core GPA"
                          : `No list on file for ${a.school}`
                  }
                />
              ))}
            </Section>
          );
        })
      )}

      {view.approvalNotes.length > 0 && (
        <Section label="Corrections the List Made" count={view.approvalNotes.length} role="target" kind="note">
          {view.approvalNotes.map((n) => (
            <Note key={n}>{n}</Note>
          ))}
        </Section>
      )}

      {view.schoolsMissingApprovedList.length > 0 && (
        <LinkButton href={`/org/${slug}/approved-courses`} variant="secondary">
          Enter a list for {view.schoolsMissingApprovedList[0]}
        </LinkButton>
      )}
    </Screen>
  );
}
