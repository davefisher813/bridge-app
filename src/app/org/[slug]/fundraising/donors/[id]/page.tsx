// One supporter: their gifts, their pledges, and their totals.
//
// Every figure here is derived from the gifts, never stored on the donor
// row, so a lifetime total cannot drift from the gifts it is made of.
// That is the same reason the donors list computes rather than reads.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { donorTotals, formatMoney, formatMoneyShort, outstandingOn, CATEGORY_LABEL, type GiftCategory } from "@/lib/fundraising/rollup";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";

export const dynamic = "force-dynamic";

export default async function DonorPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, ["owner", "staff", "member"]);

  const fiscalYear = Number(new Date().toISOString().slice(0, 4));
  const supabase = await createClient();
  const [{ data: donor }, { data: giftRows }, { data: pledgeRows }, { data: seatRows }] = await Promise.all([
    supabase.from("donors").select("id, name, donor_type, email, phone").eq("id", id).eq("org_id", org.id).single(),
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id)
      .order("received_on", { ascending: false }),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
    supabase.from("board_members").select("id, board_id, name, role_title, status, donor_id").eq("org_id", org.id).eq("donor_id", id),
  ]);

  if (!donor) notFound();

  const allGifts = toGifts(giftRows as GiftRow[] | null);
  const allPledges = toPledges(pledgeRows as PledgeRow[] | null);
  const totals = donorTotals(id, allGifts, allPledges, fiscalYear);
  const gifts = allGifts.filter((g) => g.donorId === id);
  const pledges = allPledges.filter((p) => p.donorId === id);
  const seat = (seatRows ?? [])[0] as { id: string; board_id: string; name: string; role_title: string | null } | undefined;
  const d = donor as { name: string; donor_type: string; email: string | null; phone: string | null };

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link
          href={`/org/${slug}/fundraising/donors`}
          className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted"
        >
          &larr; Donors
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold leading-tight text-ink">{d.name}</h1>
      <div className="mb-5 text-[12.5px] font-bold text-muted">
        {d.donor_type.replace(/_/g, " ")}
        {d.email ? ` · ${d.email}` : ""}
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2">
        {[
          ["Lifetime", formatMoneyShort(totals.lifetimeCashCents)],
          ["This year", formatMoneyShort(totals.thisYearCashCents)],
          ["Gifts", String(totals.giftCount)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[12px] bg-paper p-3.5">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.03em] text-muted">{label}</div>
            <div className="mt-1 text-[20px] font-black leading-tight tabular-nums text-ink">{value}</div>
          </div>
        ))}
      </div>

      {totals.lifetimeInKindCents > 0 && (
        <div className="mb-5">
          <RailCard role="place" kind="grant">
            <div className="text-[13px] font-bold leading-tight text-ink">{formatMoney(totals.lifetimeInKindCents)} in kind</div>
            <div className="mt-0.5 text-[11.5px] leading-tight text-muted">Counted as support, never as cash.</div>
          </RailCard>
        </div>
      )}

      {/* A board member who gives is one person, not two records. This
          link is what stops give/get and the donor ledger reading as
          unrelated numbers. */}
      {seat && (
        <div className="mb-5">
          <Link href={`/org/${slug}/board-governance/${seat.board_id}/seats/${seat.id}`} className="block">
            <RailCard role="people" kind="people">
              <div className="text-[13px] font-bold leading-tight text-ink">Sits on a board</div>
              <div className="mt-0.5 text-[11.5px] leading-tight text-muted">{seat.role_title ?? seat.name}</div>
            </RailCard>
          </Link>
        </div>
      )}

      {pledges.length > 0 && (
        <>
          <div className="mb-2">
            <SectionHeader label="Pledges" count={pledges.length} role="offer" kind="pledge" />
          </div>
          <div className="mb-5 flex flex-col gap-2">
            {pledges.map((p) => {
              const out = outstandingOn(p, allGifts);
              return (
                <RailCard key={p.id} role={out > 0 ? "offer" : "committed"} kind="pledge">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold leading-tight text-ink">{formatMoney(p.amountCents)} promised</div>
                      {p.dueOn && <div className="mt-0.5 text-[11.5px] leading-tight text-muted">due {p.dueOn}</div>}
                    </div>
                    <span className="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">
                      {out === 0 ? "Paid" : `${formatMoney(out)} left`}
                    </span>
                  </div>
                </RailCard>
              );
            })}
          </div>
        </>
      )}

      <div className="mb-2">
        <SectionHeader label="Gifts" count={gifts.length} role="committed" kind="money" />
      </div>
      {gifts.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="money" role="neutral" className="h-7 w-7" />} title="No gifts yet">
          This supporter has not given.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {gifts.map((g) => (
            <RailCard key={g.id} role={g.method === "in_kind" ? "place" : "committed"} kind={g.method === "in_kind" ? "grant" : "money"}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold leading-tight text-ink">
                    {CATEGORY_LABEL[g.category as GiftCategory] ?? g.category}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                    {g.receivedOn} &middot; {g.method === "in_kind" ? "in kind" : g.method}
                  </div>
                </div>
                <span className="flex-shrink-0 text-[14px] font-extrabold tabular-nums text-ink">{formatMoney(g.amountCents)}</span>
              </div>
            </RailCard>
          ))}
        </div>
      )}
    </main>
  );
}
