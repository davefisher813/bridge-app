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
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, type GiftRow } from "@/lib/data/fundraisingAdapters";
import { formatMoney, formatMoneyShort, CATEGORY_LABEL, METHOD_LABEL, type GiftCategory } from "@/lib/fundraising/rollup";
import { Body, EmptyState, LinkButton, Row, Screen, Section } from "@/components/kit";

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

  const heading = category ? (CATEGORY_LABEL[category as GiftCategory] ?? "Gifts") : method === "in_kind" ? "In Kind" : "All Gifts";

  return (
    <Screen
      title={heading}
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }}
      lede={`${gifts.length} ${gifts.length === 1 ? "gift" : "gifts"} · ${formatMoneyShort(cashCents)} cash${inKindCents > 0 ? ` · ${formatMoneyShort(inKindCents)} in kind` : ""}`}
    >
      {gifts.length === 0 ? (
        <EmptyState kind="money" title="Nothing here">
          {category || method ? "No gift matches this filter." : "No gifts recorded yet."}
        </EmptyState>
      ) : (
        <Section label="Gifts" count={gifts.length} role="committed" kind="money">
          {gifts.map((g) => {
            const name = g.donorId ? (donorName.get(g.donorId) ?? "Unknown donor") : "Anonymous";
            const inKind = g.method === "in_kind";
            return (
              <Row
                key={g.id}
                href={g.donorId ? `/org/${slug}/fundraising/donors/${g.donorId}` : undefined}
                kind={inKind ? "grant" : "money"}
                role={inKind ? "place" : "committed"}
                title={name}
                meta={`${g.receivedOn} · ${METHOD_LABEL[g.method] ?? g.method}${g.campaignId ? ` · ${campaignName.get(g.campaignId) ?? "campaign"}` : ""}`}
                trailing={
                  <Body weight="bold" numeric>
                    {formatMoney(g.amountCents)}
                  </Body>
                }
              />
            );
          })}
        </Section>
      )}

      {(category || method) && (
        <LinkButton href={`/org/${slug}/fundraising/gifts`} variant="secondary">
          Show Every Gift
        </LinkButton>
      )}
    </Screen>
  );
}
