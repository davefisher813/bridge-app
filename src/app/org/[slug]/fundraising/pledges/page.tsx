// What has been promised and not yet received.
//
// A pledge is not revenue. It sits on its own screen rather than mixed
// into the gift ledger, so nothing about this list can be mistaken for
// money in the bank. Overdue first, because that is the only part of it
// anyone needs to act on.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { formatMoney, outstandingOn } from "@/lib/fundraising/rollup";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";

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
    <RailCard key={r.p.id} role={role} kind="pledge">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold leading-tight text-ink">
            {r.p.donorId ? (donorName.get(r.p.donorId) ?? "Unknown donor") : "Anonymous"}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
            {formatMoney(r.p.amountCents)} promised
            {r.p.dueOn ? ` · due ${r.p.dueOn}` : ""}
          </div>
        </div>
        <span className="flex-shrink-0 text-[14px] font-extrabold tabular-nums text-ink">
          {r.outstanding === 0 ? "Paid" : formatMoney(r.outstanding)}
        </span>
      </div>
    </RailCard>
  );

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link href={`/org/${slug}/fundraising`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Pledges</h1>
      <div className="mb-5 text-[12.5px] font-bold text-muted">
        {formatMoney(totalOutstanding)} outstanding. None of this is in the raised figure.
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="pledge" role="neutral" className="h-7 w-7" />} title="No pledges">
          Nothing promised and unpaid.
        </EmptyState>
      ) : (
        <>
          {overdue.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="Overdue" count={overdue.length} role="offer" kind="warning" />
              </div>
              <div className="mb-5 flex flex-col gap-2">{overdue.map((r) => row(r, "offer"))}</div>
            </>
          )}
          {open.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="Open" count={open.length} role="target" kind="pledge" />
              </div>
              <div className="mb-5 flex flex-col gap-2">{open.map((r) => row(r, "target"))}</div>
            </>
          )}
          {settled.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="Settled" count={settled.length} role="committed" kind="check" />
              </div>
              <div className="flex flex-col gap-2">{settled.map((r) => row(r, "committed"))}</div>
            </>
          )}
        </>
      )}

      {canEdit && (
        <Link
          href={`/org/${slug}/fundraising/pledges/new`}
          className="mt-5 flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[14px] font-bold text-ink"
        >
          Record a pledge
        </Link>
      )}
    </main>
  );
}
