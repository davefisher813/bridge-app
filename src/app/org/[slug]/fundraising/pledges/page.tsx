// What has been promised and not yet received.
//
// A pledge is not revenue. It sits on its own screen rather than mixed
// into the gift ledger, so nothing about this list can be mistaken for
// money in the bank. Overdue first, because that is the only part of it
// anyone needs to act on.

import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { formatMoney, outstandingOn } from "@/lib/fundraising/rollup";
import { AddButton, Body, EmptyState, LinkButton, Row, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function PledgesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const [{ data: pledgeRows }, { data: giftRows }, { data: donorRows }] = await Promise.all([
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
    supabase.from("gifts").select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id").eq("org_id", org.id),
    supabase.from("donors").select("id, name").eq("org_id", org.id),
  ]);

  const pledges = toPledges(pledgeRows as PledgeRow[] | null);
  const gifts = toGifts(giftRows as GiftRow[] | null);
  const donorName = new Map((donorRows ?? []).map((d) => [(d as { id: string }).id, (d as { name: string }).name]));

  // Outstanding comes from the rollup, not from the pledge's own status:
  // part payment against a pledge is a gift, and the remainder is what
  // is actually still owed.
  const rows = pledges
    .map((p) => ({ p, outstanding: outstandingOn(p, gifts) }))
    .sort((a, b) => (a.p.dueOn ?? "9999").localeCompare(b.p.dueOn ?? "9999"));

  const overdue = rows.filter((r) => r.outstanding > 0 && r.p.dueOn && r.p.dueOn < today);
  const open = rows.filter((r) => r.outstanding > 0 && !overdue.includes(r));
  const settled = rows.filter((r) => r.outstanding === 0);
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  const row = (r: (typeof rows)[number], role: "offer" | "target" | "committed") => (
    <Row
      key={r.p.id}
      href={r.p.donorId ? `/org/${slug}/fundraising/donors/${r.p.donorId}` : undefined}
      kind="pledge"
      role={role}
      title={r.p.donorId ? (donorName.get(r.p.donorId) ?? "Unknown donor") : "Anonymous"}
      meta={`${formatMoney(r.p.amountCents)} promised${r.p.dueOn ? ` · due ${longDate(r.p.dueOn)}` : ""}`}
      wrap
      trailing={
        <Body weight="bold" numeric>
          {r.outstanding === 0 ? "Paid" : formatMoney(r.outstanding)}
        </Body>
      }
    />
  );

  return (
    <Screen
      title="Pledges"
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }} lede={`${formatMoney(totalOutstanding)} outstanding`}
      action={canEdit ? <AddButton href={`/org/${slug}/fundraising/pledges/new`} label="Add" /> : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState kind="pledge" title="No Pledges">
          Nothing promised and unpaid.
        </EmptyState>
      ) : (
        <>
          {overdue.length > 0 && (
            <Section label="Overdue" count={overdue.length} role="offer" kind="warning">
              {overdue.map((r) => row(r, "offer"))}
            </Section>
          )}
          {open.length > 0 && (
            <Section label="Open" count={open.length} role="target" kind="pledge">
              {open.map((r) => row(r, "target"))}
            </Section>
          )}
          {settled.length > 0 && (
            <Section label="Settled" count={settled.length} role="committed" kind="check">
              {settled.map((r) => row(r, "committed"))}
            </Section>
          )}
        </>
      )}

      {canEdit && (
        <LinkButton href={`/org/${slug}/fundraising/pledges/new`} variant="secondary">
          Add Pledge
        </LinkButton>
      )}
    </Screen>
  );
}
