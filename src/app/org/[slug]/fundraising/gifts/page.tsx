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
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, type GiftRow } from "@/lib/data/fundraisingAdapters";
import { formatMoney, formatMoneyShort, CATEGORY_LABEL, METHOD_LABEL, type GiftCategory } from "@/lib/fundraising/rollup";
import { Body, EmptyState, LinkButton, Row, Screen, Section } from "@/components/kit";
import { SearchField } from "@/components/SearchField";

export const dynamic = "force-dynamic";

export default async function GiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string; method?: string; q?: string }>;
}) {
  const { slug } = await params;
  const { category, method, q: rawQuery } = await searchParams;
  const q = rawQuery?.trim().toLowerCase() ?? "";
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

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

  // A donor's name or a campaign's, on top of whatever filter is on.
  const matchesQuery = (g: (typeof all)[number]) => {
    if (!q) return true;
    const donor = g.donorId ? (donorName.get(g.donorId) ?? "") : "Anonymous";
    const campaign = g.campaignId ? (campaignName.get(g.campaignId) ?? "") : "";
    return `${donor} ${campaign}`.toLowerCase().includes(q);
  };
  const gifts = all.filter((g) => (!category || g.category === category) && (!method || g.method === method) && matchesQuery(g));
  const cashCents = gifts.filter((g) => g.method !== "in_kind").reduce((s, g) => s + g.amountCents, 0);
  const inKindCents = gifts.filter((g) => g.method === "in_kind").reduce((s, g) => s + g.amountCents, 0);

  const heading = category ? (CATEGORY_LABEL[category as GiftCategory] ?? "Gifts") : method === "in_kind" ? "In Kind" : "All Gifts";

  return (
    <Screen
      title={heading}
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }}
      lede={`${gifts.length} ${gifts.length === 1 ? "gift" : "gifts"} · ${formatMoneyShort(cashCents)} cash${inKindCents > 0 ? ` · ${formatMoneyShort(inKindCents)} in kind` : ""}`}
    >
      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A donor or a campaign" />}

      {gifts.length === 0 ? (
        <EmptyState kind="money" title="Nothing Here">
          {q ? "No gift matches this search." : category || method ? "No gift matches this filter." : "No gifts recorded yet."}
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
                meta={`${longDate(g.receivedOn)} · ${METHOD_LABEL[g.method] ?? g.method}${g.campaignId ? ` · ${campaignName.get(g.campaignId) ?? "campaign"}` : ""}`}
                wrap
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
