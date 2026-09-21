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
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { AddButton, Chip, EmptyState, LinkButton, Row, Screen, Section } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
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
  const user = await requireRole(org.id, STAFF_ROLES);
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
    <Screen
      title="Grants"
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }}
      action={canEdit ? <AddButton href={`/org/${slug}/fundraising/grants/new`} label="Add" /> : undefined}
    >
      {grants.length === 0 ? (
        <>
          <EmptyState kind="grant" title="No Grants Tracked Yet">
            A grant has a life before any money exists: researching, applied, waiting on a decision, then a report due months after the
            cheque clears. Those dates are the part that gets missed.
          </EmptyState>
          <Note>Foundation Grants sits at zero on the overview until the first award arrives, which is accurate rather than a gap.</Note>
        </>
      ) : (
        <>
          {soon.length > 0 && (
            <Section label="Needs Attention" count={soon.length} role="offer" kind="warning">
              {soon.map((g) => (
                <Row
                  key={g.id}
                  kind="grant"
                  role="offer"
                  title={g.funder_name}
                  meta={
                    g.report_due_on && g.report_due_on <= today
                      ? `Report was due ${shortDate(g.report_due_on)}`
                      : g.deadline_on && g.deadline_on <= today && !g.applied_on
                        ? `Application deadline was ${shortDate(g.deadline_on)}`
                        : `Decision was expected ${shortDate(g.decision_expected_on)}`
                  }
                  wrap
                />
              ))}
            </Section>
          )}

          <Section label="All Grants" count={grants.length} role="contact" kind="grant">
            {grants.map((g) => {
              const detail = detailFor(g);
              return (
                <Row
                  key={g.id}
                  kind="grant"
                  role={STATUS_ROLE[g.status] === "high" ? "committed" : "contact"}
                  title={g.funder_name}
                  meta={detail || undefined}
                  trailing={<Chip label={STATUS_LABEL[g.status]} kind={GRANT_KIND[g.status]} role={STATUS_ROLE[g.status]} />}
                  wrap
                />
              );
            })}
          </Section>
        </>
      )}

      {canEdit && <LinkButton href={`/org/${slug}/fundraising/grants/new`}>Track Grant</LinkButton>}
    </Screen>
  );
}
