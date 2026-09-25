// One supporter: their gifts, their pledges, and their totals.
//
// Every figure here is derived from the gifts, never stored on the donor
// row, so a lifetime total cannot drift from the gifts it is made of.
// That is the same reason the donors list computes rather than reads.

import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { donorTotals, formatMoney, formatMoneyShort, outstandingOn, CATEGORY_LABEL, type GiftCategory } from "@/lib/fundraising/rollup";
import { Body, Chevron, EmptyState, LinkButton, Row, Screen, Section, Stat, StatRow } from "@/components/kit";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { individual: "Individual", corporate: "Corporate", foundation: "Foundation", board_member: "Board Member", other: "Other" };

export default async function DonorPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

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
    <Screen
      title={d.name}
      back={{ href: `/org/${slug}/fundraising/donors`, label: "Donors" }}
      lede={`${TYPE_LABEL[d.donor_type] ?? d.donor_type.replace(/_/g, " ")}${d.email ? ` · ${d.email}` : ""}`}
    >
      <StatRow>
        <Stat value={formatMoneyShort(totals.lifetimeCashCents)} label="Lifetime" role="committed" href={`/org/${slug}/fundraising/gifts`} />
        <Stat value={formatMoneyShort(totals.thisYearCashCents)} label="This Year" role="contact" href={`/org/${slug}/fundraising/gifts`} />
        <Stat value={String(totals.giftCount)} label="Gifts" href={`/org/${slug}/fundraising/gifts`} />
      </StatRow>

      {totals.lifetimeInKindCents > 0 && (
        <Row href={`/org/${slug}/fundraising/gifts?method=in_kind`} kind="grant" role="place" emphasis="bold" title={`${formatMoney(totals.lifetimeInKindCents)} in Kind`} meta="Counted as support, never as cash." />
      )}

      {/* A board member who gives is one person, not two records. This
          link is what stops give/get and the donor ledger reading as
          unrelated numbers. */}
      {seat && (
        <Row
          href={`/org/${slug}/board-governance/${seat.board_id}/seats/${seat.id}`}
          kind="people"
          role="people"
          emphasis="bold"
          title="Sits on a Board"
          meta={seat.role_title ?? seat.name}
          trailing={<Chevron />}
        />
      )}

      {pledges.length > 0 && (
        <Section label="Pledges" count={pledges.length} role="offer" kind="pledge">
          {pledges.map((p) => {
            const out = outstandingOn(p, allGifts);
            return (
              <Row
                key={p.id}
                href={`/org/${slug}/fundraising/pledges`}
                kind="pledge"
                role={out > 0 ? "offer" : "committed"}
                title={`${formatMoney(p.amountCents)} Promised`}
                meta={p.dueOn ? `due ${longDate(p.dueOn)}` : undefined}
                trailing={
                  <Body weight="bold" numeric>
                    {out === 0 ? "Paid" : `${formatMoney(out)} left`}
                  </Body>
                }
              />
            );
          })}
        </Section>
      )}

      <Section label="Gifts" count={gifts.length} role="committed" kind="money">
        {gifts.length === 0 ? (
          <EmptyState kind="money" title="No Gifts Yet" action={canEdit ? <LinkButton href={`/org/${slug}/fundraising/gifts/new`}>Record a Gift</LinkButton> : undefined}>
            This supporter has not given.
          </EmptyState>
        ) : (
          gifts.map((g) => (
            <Row
              key={g.id}
              href={`/org/${slug}/fundraising/gifts?category=${g.category}`}
              kind={g.method === "in_kind" ? "grant" : "money"}
              role={g.method === "in_kind" ? "place" : "committed"}
              title={CATEGORY_LABEL[g.category as GiftCategory] ?? g.category}
              meta={`${longDate(g.receivedOn)} · ${g.method === "in_kind" ? "in kind" : g.method}`}
              trailing={
                <Body weight="bold" numeric>
                  {formatMoney(g.amountCents)}
                </Body>
              }
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
