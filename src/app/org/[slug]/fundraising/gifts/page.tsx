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

import { displayName } from "@/lib/copy/personName";
import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, type GiftRow } from "@/lib/data/fundraisingAdapters";
import { fiscalYearOf, formatMoney, formatMoneyShort, CATEGORY_LABEL, METHOD_LABEL, type GiftCategory } from "@/lib/fundraising/rollup";
import { Body, EmptyState, LinkButton, Notice, Row, Screen, Section } from "@/components/kit";
import { SearchField } from "@/components/SearchField";

export const dynamic = "force-dynamic";

export default async function GiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string; method?: string; year?: string; donor?: string; by?: string; q?: string; notice?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { category, method, year: rawYear, donor, by, q: rawQuery, notice, error } = await searchParams;
  // A year, a donor and a seat that brought gifts in narrow the ledger the
  // same way the figure that links here was counted (a donor's This Year,
  // a seat's Given and Brought In), so the total on this screen is the
  // number that was tapped, not every gift the org ever received.
  const year = /^\d{4}$/.test(rawYear ?? "") ? Number(rawYear) : null;
  const q = rawQuery?.trim().toLowerCase() ?? "";
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: giftRows }, { data: donorRows }, { data: campaignRows }] = await Promise.all([
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id)
      .order("received_on", { ascending: false }),
    supabase.from("donors").select("id, name, deleted_at").eq("org_id", org.id),
    supabase.from("campaigns").select("id, name").eq("org_id", org.id),
  ]);
  // Who brought a gift in, and the seat's own donor record, for ?by=. Only
  // read when the filter is on. A seat's own gifts count as Given, never
  // also as Brought In, so they are left out here the same way.
  let bySeat: { id: string; name: string; donorId: string | null } | null = null;
  let solicitedBy = new Map<string, string | null>();
  if (by) {
    const [{ data: seatRow }, { data: solicitedRows }] = await Promise.all([
      supabase.from("board_members").select("id, name, donor_id").eq("id", by).eq("org_id", org.id).maybeSingle(),
      supabase.from("gifts").select("id, solicited_by").eq("org_id", org.id).eq("solicited_by", by),
    ]);
    const s = seatRow as { id: string; name: string; donor_id: string | null } | null;
    bySeat = s ? { id: s.id, name: s.name, donorId: s.donor_id } : null;
    solicitedBy = new Map(((solicitedRows ?? []) as { id: string; solicited_by: string | null }[]).map((r) => [r.id, r.solicited_by]));
  }

  const all = toGifts(giftRows as GiftRow[] | null);
  const donorName = new Map((donorRows ?? []).map((d) => [(d as { id: string }).id, displayName((d as { name: string }).name)]));
  // A removed donor's gifts stay in the ledger by name; their record is
  // out of the address book, so nothing links to it.
  const removed = new Set(((donorRows ?? []) as { id: string; deleted_at: string | null }[]).filter((d) => d.deleted_at).map((d) => d.id));
  const campaignName = new Map((campaignRows ?? []).map((c) => [(c as { id: string }).id, (c as { name: string }).name]));

  // A donor's name or a campaign's, on top of whatever filter is on.
  const matchesQuery = (g: (typeof all)[number]) => {
    if (!q) return true;
    const donor = g.donorId ? (donorName.get(g.donorId) ?? "") : "Anonymous";
    const campaign = g.campaignId ? (campaignName.get(g.campaignId) ?? "") : "";
    return `${donor} ${campaign}`.toLowerCase().includes(q);
  };
  const gifts = all.filter(
    (g) =>
      (!category || g.category === category) &&
      (!method || g.method === method) &&
      (year === null || fiscalYearOf(g.receivedOn) === year) &&
      (!donor || g.donorId === donor) &&
      (!by || (solicitedBy.get(g.id) === by && !(bySeat?.donorId && g.donorId === bySeat.donorId))) &&
      matchesQuery(g),
  );
  const cashCents = gifts.filter((g) => g.method !== "in_kind").reduce((s, g) => s + g.amountCents, 0);
  const inKindCents = gifts.filter((g) => g.method === "in_kind").reduce((s, g) => s + g.amountCents, 0);

  const heading = category ? (CATEGORY_LABEL[category as GiftCategory] ?? "Gifts") : method === "in_kind" ? "In Kind" : "All Gifts";
  // What the list is narrowed to, said first in the lede, so a total read
  // here is never mistaken for every gift.
  const scope = [
    donor ? (donorName.get(donor) ?? "Unknown donor") : null,
    by ? `brought in by ${bySeat?.name ?? "a seat"}` : null,
    year !== null ? String(year) : null,
  ].filter((x): x is string => !!x);

  return (
    <Screen
      title={heading}
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }}
      lede={[...scope, `${gifts.length} ${gifts.length === 1 ? "gift" : "gifts"}`, `${formatMoneyShort(cashCents)} cash`, ...(inKindCents > 0 ? [`${formatMoneyShort(inKindCents)} in kind`] : [])].join(" · ")}
    >
      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}
      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A donor or a campaign" />}

      {gifts.length === 0 ? (
        <EmptyState kind="money" title="Nothing Here" />
      ) : (
        <Section label="Gifts" count={gifts.length} role="committed" kind="money">
          {gifts.map((g) => {
            const name = g.donorId ? (donorName.get(g.donorId) ?? "Unknown donor") : "Anonymous";
            const inKind = g.method === "in_kind";
            return (
              <Row
                key={g.id}
                // Each gift opens its own edit screen (audit crud F10); the
                // donor is one tap further, on their name in the form.
                href={canEdit ? `/org/${slug}/fundraising/gifts/${g.id}/edit` : g.donorId && !removed.has(g.donorId) ? `/org/${slug}/fundraising/donors/${g.donorId}` : undefined}
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

      {(category || method || year !== null || donor || by) && (
        <LinkButton href={`/org/${slug}/fundraising/gifts`} variant="secondary">
          Show Every Gift
        </LinkButton>
      )}
    </Screen>
  );
}
