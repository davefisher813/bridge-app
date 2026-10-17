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

import { orgToday } from "@/lib/datetime/today";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { Body, Card, Chevron, Chip, EmptyState, Label, LinkButton, Meter, Notice, Row, Screen, Section, Stack, Stat, StatRow, TextLink } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { CampaignCards } from "@/components/CampaignCards";
import { campaignProgress, formatMoney, formatMoneyShort, summarize, yearlyRollup } from "@/lib/fundraising/rollup";
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
  searchParams: Promise<{ year?: string; notice?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { year, notice, error } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  // Not a 403: an org without the module has no fundraising screen at
  // all, the same way it has no board-governance screen.
  if (!org.modules.donor_fundraising) notFound();

  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const today = orgToday();
  const currentYear = Number(today.slice(0, 4));
  const fiscalYear = Number(year) || currentYear;

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
  // Every year at once, and all of them together, so the top of the page
  // cannot read zero while an earlier year holds real money.
  const all = yearlyRollup(gifts, pledges, currentYear);
  const budgetPercent = s.totalBudgetCents > 0 ? Math.round((s.totalCashCents / s.totalBudgetCents) * 100) : null;

  if (gifts.length === 0 && pledges.length === 0) {
    return (
      <Screen title="Fundraising">
        {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}
        <EmptyState kind="money" title="Nothing Recorded Yet" />
        {canEdit && (
          <Stack>
            <LinkButton href={`/org/${slug}/fundraising/gifts/new`}>Add Gift</LinkButton>
            <LinkButton href={`/org/${slug}/fundraising/campaigns`} variant="secondary">
              Campaigns
            </LinkButton>
            <LinkButton href={`/org/${slug}/fundraising/pledges`} variant="secondary">
              Pledges
            </LinkButton>
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
    <Screen title="Fundraising">
      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}

      {/* The headline is every year together (Dave, 2026-10-13: "not
          marked off by year"). The page used to open on the current year
          alone and read $0 with $18,418 sitting in 2024 and 2025. */}
      <Stack gap={2}>
        <StatRow>
          <Stat value={formatMoneyShort(all.cashCents)} label="Raised, All Years" role="committed" kind="money" href={`/org/${slug}/fundraising/gifts`} />
          <Stat value={all.giftCount} label="Gifts, All Years" role="contact" kind="people" href={`/org/${slug}/fundraising/gifts`} />
        </StatRow>
        <Label>{`${all.donorCount} ${all.donorCount === 1 ? "supporter" : "supporters"} · ${all.years.length} ${all.years.length === 1 ? "year" : "years"}${all.inKindCents > 0 ? ` · ${formatMoneyShort(all.inKindCents)} in kind` : ""}`}</Label>
      </Stack>

      {all.promisedCents > 0 && (
        <Row
          href={`/org/${slug}/fundraising/pledges`}
          kind="pledge"
          role="offer"
          emphasis="bold"
          title={`${formatMoney(all.outstandingPledgeCents)} Promised, Not Received`}
          meta={`${formatMoney(all.promisedCents)} promised`}
          wrap
        />
      )}

      <Section label="By Year" count={all.years.length} role="committed" kind="visit">
        {all.years.map((y) => {
          const quiet = y.giftCount === 0 && y.promisedCents === 0;
          return (
            <Card key={y.year} href={`/org/${slug}/fundraising?year=${y.year}`}>
              <Stack gap={2}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Body weight="bold">{y.year}</Body>
                    <Label>
                      {quiet
                        ? ""
                        : `${y.giftCount} ${y.giftCount === 1 ? "gift" : "gifts"} from ${y.donorCount} ${y.donorCount === 1 ? "supporter" : "supporters"}${y.inKindCents > 0 ? ` · ${formatMoneyShort(y.inKindCents)} in kind` : ""}`}
                    </Label>
                    {y.promisedCents > 0 && <Label>{`${formatMoneyShort(y.promisedCents)} promised, ${formatMoneyShort(y.outstandingPledgeCents)} still owed`}</Label>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Body weight="bold" numeric tone={y.cashCents > 0 ? "ink" : "muted"}>
                      {formatMoneyShort(y.cashCents)}
                    </Body>
                  </div>
                </div>
              </Stack>
            </Card>
          );
        })}
      </Section>

      <Section label={`${fiscalYear} Detail`} role="accent" kind="money" />
      <Stack gap={2}>
        <StatRow>
          <Stat value={formatMoneyShort(s.totalCashCents)} label="Raised" role="committed" kind="money" href={`/org/${slug}/fundraising/gifts?year=${fiscalYear}`} />
          <Stat value={formatMoneyShort(s.totalBudgetCents)} label="Budget" role="contact" kind="scale" href={`/org/${slug}/fundraising/budget?year=${fiscalYear}`} />
        </StatRow>
        {budgetPercent !== null && <Label>{`${budgetPercent}% of Budget`}</Label>}
      </Stack>

      {/* Beside the total, never inside it. Summing a promise into
          "raised" overstates the year, and it is the easiest mistake in
          this whole feature to make. */}
      {s.outstandingPledgeCents > 0 && (
        <Row
          href={`/org/${slug}/fundraising/pledges`}
          kind="pledge"
          role="offer"
          emphasis="bold"
          title={`${formatMoney(s.outstandingPledgeCents)} Promised, Not Received`}
          meta={s.overduePledgeCents > 0 ? `${formatMoney(s.overduePledgeCents)} past due` : undefined}
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
            <Card key={c.category} href={`/org/${slug}/fundraising/gifts?category=${c.category}&year=${fiscalYear}`}>
              <Stack gap={2}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Body weight="bold" truncate>
                      {c.label}
                    </Body>
                    <Label>
                      {formatMoneyShort(c.receivedCents)}
                      {c.budgetCents > 0 ? ` of ${formatMoneyShort(c.budgetCents)}` : ""}
                      {c.inKindCents > 0 ? ` · ${formatMoneyShort(c.inKindCents)} in kind` : ""}
                    </Label>
                  </div>
                  {c.percentOfBudget !== null && (
                    <Body weight="bold" numeric>
                      {`${c.percentOfBudget}%`}
                    </Body>
                  )}
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
            href={`/org/${slug}/fundraising/gifts?method=in_kind&year=${fiscalYear}`}
            kind="grant"
            role="place"
            emphasis="bold"
            title={`${formatMoney(s.totalInKindCents)} Donated in Goods and Services`}
            meta={`${formatMoneyShort(s.totalSupportCents)} total support`}
            wrap
          />
        </Section>
      )}

      <Section label="Campaigns" count={campaigns.length} role="visit" kind="campaign" action={canEdit ? <TextLink href={`/org/${slug}/fundraising/campaigns/new`}>New</TextLink> : undefined}>
        {campaigns.length === 0 ? (
          <EmptyState kind="campaign" title="No Campaigns Yet" action={canEdit ? <LinkButton href={`/org/${slug}/fundraising/campaigns/new`}>Add the First One</LinkButton> : undefined} />
        ) : (
          <CampaignCards slug={slug} campaigns={campaigns} gifts={gifts} pledges={pledges} />
        )}
      </Section>

      <Section label="Supporters" role="contact" kind="people">
        <Note title={`${s.giftCount} ${s.giftCount === 1 ? "gift" : "gifts"} from ${s.donorCount} ${s.donorCount === 1 ? "supporter" : "supporters"}`} />
      </Section>

      {/* Reading the ledger is not an editing right. A board member who
          can see the total can see what it is made of, which is the
          point of showing them a total at all. */}
      <Section label="Records" role="committed" kind="money">
        <Row href={`/org/${slug}/fundraising/donors`} kind="donor" role="contact" title="Donors" trailing={<Chevron />} />
        {canEdit && <Row href={`/org/${slug}/fundraising/grants`} kind="grant" role="place" title="Grants" trailing={<Chevron />} />}
        {canEdit && (
          <Row
            href={`/org/${slug}/fundraising/budget?year=${fiscalYear}`}
            kind="settings"
            role="committed"
            title="Budget"
            meta={s.totalBudgetCents > 0 ? undefined : "Not Set"}
            trailing={<Chevron />}
          />
        )}
      </Section>

      {canEdit && (
        <Stack>
          <LinkButton href={`/org/${slug}/fundraising/gifts/new`}>Add Gift</LinkButton>
          <LinkButton href={`/org/${slug}/fundraising/pledges/new`} variant="secondary">
            Add Pledge
          </LinkButton>
        </Stack>
      )}
    </Screen>
  );
}
