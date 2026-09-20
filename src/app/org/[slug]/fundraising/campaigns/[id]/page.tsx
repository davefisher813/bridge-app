// One campaign against its goal, and the gifts that got it there.
//
// Raised and pledged are two numbers, never one. A campaign that shows
// promises inside its progress bar reports itself as further along than
// the bank says it is, which is the whole reason campaignProgress()
// returns them separately.

import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { campaignProgress, formatMoney, formatMoneyShort, toCents } from "@/lib/fundraising/rollup";
import { Body, Card, EmptyState, Label, Meter, Row, Screen, Section, Stack } from "@/components/kit";

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
    <Screen title={c.name} back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }} lede={`${c.kind.charAt(0).toUpperCase()}${c.kind.slice(1)}${c.ends_on ? ` · ends ${longDate(c.ends_on)}` : ""}`}>
      <Card>
        <Stack gap={2}>
          <div className="flex items-start justify-between gap-3">
            <Body weight="bold" numeric>
              {formatMoneyShort(p.raisedCents)} of {formatMoneyShort(p.goalCents)}
            </Body>
            <Body weight="bold" numeric tone={pct == null ? "muted" : "ink"}>
              {pct == null ? "no goal" : `${pct}%`}
            </Body>
          </div>
          {/* The bar is the role's hue laid flat, so it tracks `role`
              and matches the figure it sits under. */}
          <Meter parts={[{ role, fraction: (pct ?? 0) / 100 }]} />
          {/* Beside the bar, never inside it. */}
          {p.pledgedCents > 0 && <Label>{formatMoney(p.pledgedCents)} pledged on top, not counted above.</Label>}
        </Stack>
      </Card>

      <Section label="Gifts" count={gifts.length} role="committed" kind="money">
        {gifts.length === 0 ? (
          <EmptyState kind="money" title="No Gifts Yet">
            Nothing has come in against this campaign.
          </EmptyState>
        ) : (
          gifts.map((g) => (
            <Row
              key={g.id}
              href={g.donorId ? `/org/${slug}/fundraising/donors/${g.donorId}` : undefined}
              kind={g.method === "in_kind" ? "grant" : "money"}
              role={g.method === "in_kind" ? "place" : "committed"}
              title={g.donorId ? (donorName.get(g.donorId) ?? "Unknown donor") : "Anonymous"}
              meta={longDate(g.receivedOn)}
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
