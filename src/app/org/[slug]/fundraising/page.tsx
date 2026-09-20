// Fundraising for one org, for one fiscal year.
//
// Gated on orgs.modules.donor_fundraising, which is off by default, so
// Elite Squad never sees any of this. The gate is checked in the server
// actions too: a page that does not render is not the same thing as an
// endpoint that cannot be called.
//
// Two rules the screen keeps, both from src/lib/fundraising/rollup.ts,
// and both of which make a board report quietly wrong if they slip:
//
//   - A pledge is never inside a total, only beside it.
//   - An in-kind gift is support, never cash.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { Body, Card, EmptyState, Label, LinkButton, Meter, Row, Screen, Section, Stack, Stat, StatRow } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { campaignProgress, formatMoney, formatMoneyShort, summarize } from "@/lib/fundraising/rollup";
import { toBudgetLines, toGifts, toPledges, type BudgetRow, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";

export const dynamic = "force-dynamic";

// Green once it is on track, amber while it is behind, gray when nobody
// has set a target. Never red: the locked catalog keeps red for the
// primary action, and a category being behind is not an error.
function roleFor(percent: number | null): "committed" | "offer" | "target" {
  if (percent === null) return "target";
  return percent >= 75 ? "committed" : "offer";
}

export default async function FundraisingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug } = await params;
  const { year } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  // Not a 403: an org without the module has no fundraising screen at
  // all, the same way it has no board-governance screen.
  if (!org.modules.donor_fundraising) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const today = new Date().toISOString().slice(0, 10);
  const fiscalYear = Number(year) || Number(today.slice(0, 4));

  const supabase = await createClient();
  const [{ data: giftRows }, { data: pledgeRows }, { data: budgetRows }, { data: campaignRows }] = await Promise.all([
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
    supabase.from("fundraising_budget").select("fiscal_year, category, amount").eq("org_id", org.id),
    supabase.from("campaigns").select("id, name, kind, goal_amount, ends_on").eq("org_id", org.id).order("ends_on", { ascending: false }),
  ]);

  const gifts = toGifts(giftRows as GiftRow[] | null);
  const pledges = toPledges(pledgeRows as PledgeRow[] | null);
  const budget = toBudgetLines(budgetRows as BudgetRow[] | null);
  const campaigns = (campaignRows ?? []) as Array<{ id: string; name: string; kind: string; goal_amount: number | string | null }>;

  const s = summarize({ gifts, pledges, budget, fiscalYear, today });
  const budgetPercent = s.totalBudgetCents > 0 ? Math.round((s.totalCashCents / s.totalBudgetCents) * 100) : null;

  if (gifts.length === 0 && pledges.length === 0) {
    return (
      <Screen title="Fundraising" lede={`${fiscalYear}, against the board budget.`}>
        <EmptyState kind="money" title="Nothing Recorded Yet">
          Record the first gift and this starts reporting against your categories. Totals are calculated from the gifts themselves, so
          nothing here can go stale.
        </EmptyState>
        {canEdit && (
          <Stack>
            <LinkButton href={`/org/${slug}/fundraising/gifts/new`}>Add Gift</LinkButton>
            <LinkButton href={`/org/${slug}/fundraising/donors`} variant="secondary">
              Donors
            </LinkButton>
            <LinkButton href={`/org/${slug}/fundraising/budget?year=${fiscalYear}`} variant="secondary">
              Set the Budget
            </LinkButton>
          </Stack>
        )}
      </Screen>
    );
  }

  return (
    <Screen title="Fundraising" lede={`${fiscalYear}, against the board budget. Cash received only.`}>
      <Stack gap={2}>
        <StatRow>
          <Stat value={formatMoneyShort(s.totalCashCents)} label="Raised" role="committed" kind="money" />
          <Stat value={formatMoneyShort(s.totalBudgetCents)} label="Budget" role="contact" kind="scale" />
        </StatRow>
        <Label>{budgetPercent === null ? "Cash in the door. No budget set for the year." : `Cash in the door, ${budgetPercent}% of the year's budget.`}</Label>
      </Stack>

      {/* Beside the total, never inside it. Summing a promise into
          "raised" overstates the year, and it is the easiest mistake in
          this whole feature to make. */}
      {s.outstandingPledgeCents > 0 && (
        <Row
          kind="pledge"
          role="offer"
          emphasis="bold"
          title={`${formatMoney(s.outstandingPledgeCents)} promised, not received`}
          meta={`Not counted in the ${formatMoneyShort(s.totalCashCents)} above.${s.overduePledgeCents > 0 ? ` ${formatMoney(s.overduePledgeCents)} of it is past its due date.` : ""}`}
          wrap
        />
      )}

      <Section label="By Category" role="committed" kind="money">
        {s.byCategory.map((c) => {
          const role = roleFor(c.percentOfBudget);
          // The category row is the natural way in to the gifts behind
          // the number. A percentage nobody can open is a number you
          // either believe or do not, which is the whole complaint about
          // the spreadsheet this replaces.
          return (
            <Card key={c.category} href={`/org/${slug}/fundraising/gifts?category=${c.category}`}>
              <Stack gap={2}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Body weight="bold" truncate>
                      {c.label}
                    </Body>
                    <Label>
                      {formatMoneyShort(c.receivedCents)}
                      {c.budgetCents > 0 ? ` of ${formatMoneyShort(c.budgetCents)}` : " received, no target set"}
                      {c.inKindCents > 0 ? ` · ${formatMoneyShort(c.inKindCents)} in kind` : ""}
                    </Label>
                  </div>
                  <Body weight="bold" numeric tone={c.percentOfBudget === null ? "muted" : "ink"}>
                    {c.percentOfBudget === null ? "no target" : `${c.percentOfBudget}%`}
                  </Body>
                </div>
                <Meter parts={[{ role, fraction: (c.percentOfBudget ?? 0) / 100 }]} />
              </Stack>
            </Card>
          );
        })}
      </Section>

      {/* Reported, and reported separately. A donated case of food is
          support and not something anyone can spend, and folding it into
          the cash figure tells a treasurer there is money that is not
          there. */}
      {s.totalInKindCents > 0 && (
        <Section label="In Kind" role="place" kind="grant">
          <Row
            kind="grant"
            role="place"
            emphasis="bold"
            title={`${formatMoney(s.totalInKindCents)} donated in goods and services`}
            meta={`Counted as support, never as cash. Total support for the year is ${formatMoneyShort(s.totalSupportCents)}.`}
            wrap
          />
        </Section>
      )}

      {campaigns.length > 0 && (
        <Section label="Campaigns" count={campaigns.length} role="visit" kind="campaign">
          {campaigns.map((c) => {
            const goalCents = c.goal_amount === null ? 0 : Math.round(Number(c.goal_amount) * 100);
            const p = campaignProgress(c.id, goalCents, gifts, pledges);
            const role = roleFor(p.percentOfGoal);
            return (
              <Card key={c.id} href={`/org/${slug}/fundraising/campaigns/${c.id}`}>
                <Stack gap={2}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Body weight="bold" truncate>
                        {c.name}
                      </Body>
                      <Label>
                        {formatMoneyShort(p.raisedCents)} raised
                        {goalCents > 0 ? ` of a ${formatMoneyShort(goalCents)} goal` : ""}
                        {p.pledgedCents > 0 ? ` · ${formatMoneyShort(p.pledgedCents)} pledged` : ""}
                      </Label>
                    </div>
                    <Body weight="bold" numeric tone={p.percentOfGoal === null ? "muted" : "ink"}>
                      {p.percentOfGoal === null ? "no goal" : `${p.percentOfGoal}%`}
                    </Body>
                  </div>
                  <Meter parts={[{ role, fraction: (p.percentOfGoal ?? 0) / 100 }]} />
                </Stack>
              </Card>
            );
          })}
          <Note>
            A campaign&apos;s percentage is cash raised against goal. Pledges are shown beside it and never inside it: a campaign with
            promises covering its goal has not met its goal.
          </Note>
        </Section>
      )}

      <Section label="This Year" role="contact" kind="people">
        <Note title={`${s.giftCount} ${s.giftCount === 1 ? "gift" : "gifts"} from ${s.donorCount} ${s.donorCount === 1 ? "supporter" : "supporters"}.`}>
          Anonymous gifts count in the total and not in the supporter number, so the figure means people.
        </Note>
      </Section>

      {/* Reading the ledger is not an editing right. A board member who
          can see the total can see what it is made of, which is the
          point of showing them a total at all. */}
      <Stack>
        <LinkButton href={`/org/${slug}/fundraising/gifts`} variant="secondary">
          All Gifts
        </LinkButton>
        <LinkButton href={`/org/${slug}/fundraising/pledges`} variant="secondary">
          Pledges
        </LinkButton>
        <LinkButton href={`/org/${slug}/fundraising/donors`} variant="secondary">
          Donors
        </LinkButton>
      </Stack>

      {canEdit && (
        <Stack>
          <LinkButton href={`/org/${slug}/fundraising/gifts/new`}>Add Gift</LinkButton>
          <LinkButton href={`/org/${slug}/fundraising/pledges/new`} variant="secondary">
            Add Pledge
          </LinkButton>
          <LinkButton href={`/org/${slug}/fundraising/campaigns/new`} variant="secondary">
            New Campaign
          </LinkButton>
          <LinkButton href={`/org/${slug}/fundraising/grants`} variant="secondary">
            Grants
          </LinkButton>
          <LinkButton href={`/org/${slug}/fundraising/budget?year=${fiscalYear}`} variant="secondary">
            {s.totalBudgetCents > 0 ? "Edit the Budget" : "Set the Budget"}
          </LinkButton>
        </Stack>
      )}
    </Screen>
  );
}
