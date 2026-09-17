// Every course checked against its school's NCAA approved list, grouped
// by what happened.
//
// Ordered worst first: what is not on the list, then what could not be
// settled, then what is unchecked, then what is fine. A hundred approved
// rows above the two that cost credits is the wrong way round.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { loadEligibility } from "@/lib/data/loadEligibility";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph, type RowKind } from "@/components/RowGlyph";
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
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link
          href={`/org/${slug}/roster/${id}/eligibility`}
          className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted"
        >
          &larr; NCAA eligibility
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Approved courses</h1>
      <div className="mb-5 text-[12.5px] font-bold text-muted">
        {athlete.name} &middot; {view.approvals.length} checked
      </div>

      {view.approvals.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="checklist" role="neutral" className="h-7 w-7" />} title="Nothing to check">
          No courses on file yet.
        </EmptyState>
      ) : (
        GROUPS.map(({ status, label, role, kind }) => {
          const rows = view.approvals.filter((a) => a.match.status === status);
          if (rows.length === 0) return null;
          return (
            <div key={status} className="mb-4">
              <div className="mb-2">
                <SectionHeader label={label} count={rows.length} role={role} kind={kind} />
              </div>
              <div className="flex flex-col gap-2">
                {rows.map((a, i) => (
                  <RailCard key={a.title + i} role={role} kind={kind}>
                    <div className="text-[13px] font-bold leading-tight text-ink">{a.title}</div>
                    <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                      {status === "approved"
                        ? `${a.school} · ${a.match.how === "exact" ? "exact title" : "matched on the title"}`
                        : status === "ambiguous"
                          ? `Could be ${(a.match.candidates ?? []).join(" or ")}`
                          : status === "not_approved"
                            ? "Does not count toward the core GPA"
                            : `No list on file for ${a.school}`}
                    </div>
                  </RailCard>
                ))}
              </div>
            </div>
          );
        })
      )}

      {view.approvalNotes.length > 0 && (
        <>
          <div className="mb-2 mt-5">
            <SectionHeader label="Corrections the list made" count={view.approvalNotes.length} role="target" kind="note" />
          </div>
          <div className="flex flex-col gap-2">
            {view.approvalNotes.map((n) => (
              <RailCard key={n} role="target" kind="note">
                <div className="text-[12.5px] leading-relaxed text-ink">{n}</div>
              </RailCard>
            ))}
          </div>
        </>
      )}

      {view.schoolsMissingApprovedList.length > 0 && (
        <Link
          href={`/org/${slug}/approved-courses`}
          className="mt-5 flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[14px] font-bold text-ink"
        >
          Enter a list for {view.schoolsMissingApprovedList[0]}
        </Link>
      )}
    </main>
  );
}
