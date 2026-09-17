// The gift ledger. Every gift received, newest first, filterable.
//
// There was a /fundraising/gifts/new and no list. Money could go in and
// never be read back except as a total, which is the shape of a system
// nobody trusts: a figure on a dashboard with no way to see what it is
// made of.
//
// In-kind sits in the list and out of the cash subtotal, the same rule
// the rollup applies, because a donated scoreboard is real support and a
// treasurer cannot spend it.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, type GiftRow } from "@/lib/data/fundraisingAdapters";
import { formatMoney, formatMoneyShort, CATEGORY_LABEL, type GiftCategory } from "@/lib/fundraising/rollup";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph } from "@/components/RowGlyph";

export const dynamic = "force-dynamic";

export default async function GiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string; method?: string }>;
}) {
  const { slug } = await params;
  const { category, method } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, ["owner", "staff", "member"]);

  const supabase = await createClient();
  const [{ data: giftRows }, { data: donorRows }, { data: campaignRows }] = await Promise.all([
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id)
      .order("received_on", { ascending: false }),
    supabase.from("donors").select("id, name").eq("org_id", org.id),
    supabase.from("campaigns").select("id, name").eq("org_id", org.id),
  ]);

  const all = toGifts(giftRows as GiftRow[] | null);
  const donorName = new Map((donorRows ?? []).map((d) => [(d as { id: string }).id, (d as { name: string }).name]));
  const campaignName = new Map((campaignRows ?? []).map((c) => [(c as { id: string }).id, (c as { name: string }).name]));

  const gifts = all.filter((g) => (!category || g.category === category) && (!method || g.method === method));
  const cashCents = gifts.filter((g) => g.method !== "in_kind").reduce((s, g) => s + g.amountCents, 0);
  const inKindCents = gifts.filter((g) => g.method === "in_kind").reduce((s, g) => s + g.amountCents, 0);

  const heading = category ? (CATEGORY_LABEL[category as GiftCategory] ?? "Gifts") : method === "in_kind" ? "In kind" : "All gifts";

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link href={`/org/${slug}/fundraising`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">{heading}</h1>
      <div className="mb-5 text-[12.5px] font-bold text-muted">
        {gifts.length} {gifts.length === 1 ? "gift" : "gifts"} &middot; {formatMoneyShort(cashCents)} cash
        {inKindCents > 0 ? ` · ${formatMoneyShort(inKindCents)} in kind` : ""}
      </div>

      {gifts.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="money" role="neutral" className="h-7 w-7" />} title="Nothing here">
          {category || method ? "No gift matches this filter." : "No gifts recorded yet."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {gifts.map((g) => {
            const name = g.donorId ? (donorName.get(g.donorId) ?? "Unknown donor") : "Anonymous";
            const inKind = g.method === "in_kind";
            const inner = (
              <RailCard role={inKind ? "place" : "committed"} kind={inKind ? "grant" : "money"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold leading-tight text-ink">{name}</div>
                    <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                      {g.receivedOn} &middot; {inKind ? "in kind" : g.method}
                      {g.campaignId ? ` · ${campaignName.get(g.campaignId) ?? "campaign"}` : ""}
                    </div>
                  </div>
                  <span className="flex-shrink-0 text-[14px] font-extrabold tabular-nums text-ink">{formatMoney(g.amountCents)}</span>
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

      {(category || method) && (
        <Link
          href={`/org/${slug}/fundraising/gifts`}
          className="mt-5 flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[14px] font-bold text-ink"
        >
          Show every gift
        </Link>
      )}
    </main>
  );
}
