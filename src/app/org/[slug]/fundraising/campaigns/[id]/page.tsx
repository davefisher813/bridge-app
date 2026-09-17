// One campaign against its goal, and the gifts that got it there.
//
// Raised and pledged are two numbers, never one. A campaign that shows
// promises inside its progress bar reports itself as further along than
// the bank says it is, which is the whole reason campaignProgress()
// returns them separately.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { campaignProgress, formatMoney, formatMoneyShort, toCents } from "@/lib/fundraising/rollup";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";
import { DOT } from "@/components/statusHue";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, ["owner", "staff", "member"]);

  const supabase = await createClient();
  const [{ data: campaign }, { data: giftRows }, { data: pledgeRows }, { data: donorRows }] = await Promise.all([
    supabase.from("campaigns").select("id, name, kind, goal_amount, ends_on").eq("id", id).eq("org_id", org.id).single(),
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id)
      .order("received_on", { ascending: false }),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
    supabase.from("donors").select("id, name").eq("org_id", org.id),
  ]);

  if (!campaign) notFound();
  const c = campaign as { name: string; kind: string; goal_amount: number | string | null; ends_on: string | null };

  const allGifts = toGifts(giftRows as GiftRow[] | null);
  const p = campaignProgress(id, toCents(c.goal_amount ?? 0), allGifts, toPledges(pledgeRows as PledgeRow[] | null));
  const gifts = allGifts.filter((g) => g.campaignId === id);
  const donorName = new Map((donorRows ?? []).map((d) => [(d as { id: string }).id, (d as { name: string }).name]));

  const pct = p.percentOfGoal;
  const role = pct == null ? "target" : pct >= 75 ? "committed" : "offer";

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link href={`/org/${slug}/fundraising`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold leading-tight text-ink">{c.name}</h1>
      <div className="mb-5 text-[13.5px] font-bold text-muted">
        {c.kind}
        {c.ends_on ? ` · ends ${c.ends_on}` : ""}
      </div>

      <div className="mb-5">
        <RailCard role={role} kind="campaign">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[16px] font-extrabold tabular-nums text-ink">
              {formatMoneyShort(p.raisedCents)} of {formatMoneyShort(p.goalCents)}
            </div>
            <span className="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">{pct == null ? "no goal" : `${pct}%`}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
            {/* DOT, not a solid fill token. A solid fill is half of a
                pair with its own foreground and carries the primary
                action's weight; a bar is just the rail's hue laid flat,
                so it tracks `role` and matches the card it sits in. */}
            <div className={`h-full rounded-full ${DOT[role]}`} style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }} />
          </div>
          {/* Beside the bar, never inside it. */}
          {p.pledgedCents > 0 && (
            <div className="mt-2 text-[12.5px] leading-tight text-muted">
              {formatMoney(p.pledgedCents)} pledged on top, not counted above.
            </div>
          )}
        </RailCard>
      </div>

      <div className="mb-2">
        <SectionHeader label="Gifts" count={gifts.length} role="committed" kind="money" />
      </div>
      {gifts.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="money" role="neutral" className="h-7 w-7" />} title="No gifts yet">
          Nothing has come in against this campaign.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {gifts.map((g) => {
            const inner = (
              <RailCard role={g.method === "in_kind" ? "place" : "committed"} kind={g.method === "in_kind" ? "grant" : "money"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-bold leading-tight text-ink">
                      {g.donorId ? (donorName.get(g.donorId) ?? "Unknown donor") : "Anonymous"}
                    </div>
                    <div className="mt-0.5 text-[12.5px] leading-tight text-muted">{g.receivedOn}</div>
                  </div>
                  <span className="flex-shrink-0 text-[15px] font-extrabold tabular-nums text-ink">{formatMoney(g.amountCents)}</span>
                </div>
              </RailCard>
            );
            return g.donorId ? (
              <Link key={g.id} href={`/org/${slug}/fundraising/donors/${g.donorId}`} className="block">
                {inner}
              </Link>
            ) : (
              <div key={g.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </main>
  );
}
