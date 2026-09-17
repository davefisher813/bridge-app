// Grant applications, which is a different thing from grant money.
//
// Dave, 2026-09: "We don't have grants yet but build it for when we do."
// So this is deliberately built around the part that exists before any
// money does. A grant's life is mostly dates: a deadline to apply, a
// decision expected, a report due months after the cheque clears. Those
// are what get missed, and they are what this screen is for.
//
// The money itself is still an ordinary gift row in the Foundation
// Grants category, linked back to the application, so an award is never
// counted both as a win here and as revenue there.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { Chip } from "@/components/catalog";
import type { RowKind } from "@/components/RowGlyph";
import { formatMoneyShort } from "@/lib/fundraising/rollup";

export const dynamic = "force-dynamic";

type GrantStatus = "researching" | "applied" | "pending" | "awarded" | "declined" | "closed";

// Which glyph each grant status wears, added 2026-09-17 when the pills
// lost their fills. A status needs a shape now that the tint that used to
// carry it is gone.
const GRANT_KIND: Record<GrantStatus, RowKind> = {
  researching: "target",
  applied: "document",
  pending: "clock",
  awarded: "check",
  declined: "blocked",
  closed: "stage_none",
};

const STATUS_LABEL: Record<GrantStatus, string> = {
  researching: "Researching",
  applied: "Applied",
  pending: "Awaiting decision",
  awarded: "Awarded",
  declined: "Declined",
  closed: "Closed",
};

// On the Score axis as tints, same contract as every other status in the
// app. Declined is gray rather than red: the locked catalog keeps red
// for the primary action, and a declined application is an outcome, not
// an error.
const STATUS_ROLE: Record<GrantStatus, "high" | "mid" | "low"> = {
  researching: "low",
  applied: "mid",
  pending: "mid",
  awarded: "high",
  declined: "low",
  closed: "low",
};

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <path d="M6 3h8l4 4v14H6z" strokeLinejoin="round" />
      <path d="M14 3v4h4M9 12h6M9 16h6" strokeLinecap="round" />
    </svg>
  );
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

interface GrantRow {
  id: string;
  funder_name: string;
  status: GrantStatus;
  amount_requested: number | string | null;
  amount_awarded: number | string | null;
  deadline_on: string | null;
  applied_on: string | null;
  decision_expected_on: string | null;
  report_due_on: string | null;
}

function money(v: number | string | null): string | null {
  if (v === null) return null;
  return formatMoneyShort(Math.round(Number(v) * 100));
}

// The line under the funder's name changes with where the grant is,
// because "requested $25,000" is the useful fact before a decision and
// "report due 31 Jan" is the useful fact after one.
function detailFor(g: GrantRow): string {
  const bits: string[] = [];
  if (g.status === "awarded") {
    const awarded = money(g.amount_awarded);
    if (awarded) bits.push(`${awarded} awarded`);
    const report = shortDate(g.report_due_on);
    if (report) bits.push(`report due ${report}`);
  } else {
    const requested = money(g.amount_requested);
    if (requested) bits.push(`${requested} requested`);
    const applied = shortDate(g.applied_on);
    if (applied) bits.push(`submitted ${applied}`);
    const deadline = shortDate(g.deadline_on);
    if (!applied && deadline) bits.push(`deadline ${deadline}`);
    const decision = shortDate(g.decision_expected_on);
    if (decision) bits.push(`decision expected ${decision}`);
  }
  return bits.join(" · ");
}

export default async function GrantsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const { data } = await supabase
    .from("grants")
    .select("id, funder_name, status, amount_requested, amount_awarded, deadline_on, applied_on, decision_expected_on, report_due_on")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false });

  const grants = (data ?? []) as GrantRow[];
  const today = new Date().toISOString().slice(0, 10);

  // Anything with a date that has passed or is close. This is the whole
  // point of tracking grants separately from gifts.
  const soon = grants.filter((g) => {
    const dates = [g.deadline_on, g.decision_expected_on, g.report_due_on].filter((d): d is string => !!d);
    return dates.some((d) => d <= today);
  });

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/fundraising`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Grants</h1>
      <p className="mb-5 text-[13.5px] leading-tight text-muted">
        The applications, not the money. Awarded funds are recorded as a gift in the Foundation Grants category, so nothing is counted
        twice.
      </p>

      {grants.length === 0 ? (
        <>
          <EmptyState icon={<DocIcon />} title="No grants tracked yet">
            A grant has a life before any money exists: researching, applied, waiting on a decision, then a report due months after the
            cheque clears. Those dates are the part that gets missed.
          </EmptyState>
          <div className="mt-4">
            <RailCard role="contact">
              <div className="text-[13.5px] leading-tight text-ink">
                Foundation Grants sits at zero on the overview until the first award arrives, which is accurate rather than a gap.
              </div>
            </RailCard>
          </div>
        </>
      ) : (
        <>
          {soon.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="Needs attention" count={soon.length} role="offer" />
              </div>
              <div className="mb-5 flex flex-col gap-2">
                {soon.map((g) => (
                  <RailCard key={g.id} role="offer">
                    <div className="text-[14.5px] font-bold text-ink">{g.funder_name}</div>
                    <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
                      {g.report_due_on && g.report_due_on <= today
                        ? `Report was due ${shortDate(g.report_due_on)}`
                        : g.deadline_on && g.deadline_on <= today && !g.applied_on
                          ? `Application deadline was ${shortDate(g.deadline_on)}`
                          : `Decision was expected ${shortDate(g.decision_expected_on)}`}
                    </div>
                  </RailCard>
                ))}
              </div>
            </>
          )}

          <div className="mb-2">
            <SectionHeader label="All grants" count={grants.length} role="contact" />
          </div>
          <div className="flex flex-col gap-2">
            {grants.map((g) => {
              const detail = detailFor(g);
              return (
                <RailCard key={g.id} role={STATUS_ROLE[g.status] === "high" ? "committed" : "contact"}>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[14.5px] font-bold text-ink">{g.funder_name}</div>
                      <Chip
                        label={STATUS_LABEL[g.status]}
                        kind={GRANT_KIND[g.status]}
                        role={STATUS_ROLE[g.status]}
                        className="flex-shrink-0"
                      />
                    </div>
                    {detail && <div className="mt-1 text-[12.5px] leading-tight text-muted">{detail}</div>}
                  </div>
                </RailCard>
              );
            })}
          </div>
        </>
      )}

      {canEdit && (
        <div className="mt-5">
          <Link
            href={`/org/${slug}/fundraising/grants/new`}
            className="block rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on"
          >
            Track a grant
          </Link>
        </div>
      )}
    </main>
  );
}
