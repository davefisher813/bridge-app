import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireMember } from "@/lib/auth/guard";
import { loadGiving } from "@/lib/data/member";
import { formatMoney, formatMoneyShort } from "@/lib/fundraising/rollup";
import { SeatCard, roleForPercent } from "@/components/SeatCard";
import { Body, Card, EmptyState, Label, Meter, Row, Screen, Section, Stack, Stat, StatRow } from "@/components/kit";

export const dynamic = "force-dynamic";

// Giving, as a member sees it (Dave's picks, 2026-09-21): the year
// against budget and the campaigns, with no donor names; their own seat
// with the whole account and every gift credited to it; and the board's
// total without names. Only for an org with the fundraising module; an
// org without it has no Giving tab.

export default async function MemberGivingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org || !org.modules.donor_fundraising) notFound();
  await requireMember(org.id);

  const today = new Date().toISOString().slice(0, 10);
  const fiscalYear = Number(today.slice(0, 4));
  const giving = await loadGiving(org.id, fiscalYear, today);
  if (!giving) notFound();

  const s = giving.summary;
  const budgetPercent = s.totalBudgetCents > 0 ? Math.round((s.totalCashCents / s.totalBudgetCents) * 100) : null;
  const seat = org.modules.board_governance ? giving.seat : null;

  return (
    <Screen title="Giving" lede={`${fiscalYear}, against the board budget`}>
      <StatRow>
        <Stat value={formatMoneyShort(s.totalCashCents)} label="Raised" role="high" kind="money" />
        <Stat value={s.totalBudgetCents > 0 ? formatMoneyShort(s.totalBudgetCents) : "none"} label="Budget" kind="money" />
        {budgetPercent !== null && <Stat value={`${budgetPercent}%`} label="Of the Year" role={roleForPercent(budgetPercent) === "target" ? "mid" : "high"} kind="stage_committed" />}
      </StatRow>

      <Section label="Campaigns" count={giving.campaigns.length} role="high" kind="money">
        {giving.campaigns.length === 0 ? (
          <EmptyState kind="money" title="No Campaigns Yet">
            {org.name} has not set one up.
          </EmptyState>
        ) : (
          giving.campaigns.map((c) => (
            <Row
              key={c.id}
              kind="money"
              role="high"
              title={c.name}
              meta={`${formatMoneyShort(c.progress.raisedCents)} of ${formatMoneyShort(c.progress.goalCents)}${c.endsOn ? ` · ends ${longDate(c.endsOn)}` : ""}`}
              trailing={
                <Body weight="bold" numeric>
                  {c.progress.percentOfGoal === null ? "no goal" : `${c.progress.percentOfGoal}%`}
                </Body>
              }
              wrap
            />
          ))
        )}
      </Section>

      {org.modules.board_governance && (
        <Section label="Your Seat" role="high" kind="money">
          {seat ? (
            <>
              <SeatCard seat={seat} fiscalYear={fiscalYear} />
              <Section label="Credited to You" count={seat.credited.length} role="high" kind="money">
                {seat.credited.length === 0 ? (
                  <EmptyState kind="money" title="Nothing Credited Yet">
                    A gift you make, or one you bring in, shows here once {org.name} records it.
                  </EmptyState>
                ) : (
                  seat.credited.map((c) => (
                    <Row
                      key={c.gift.id}
                      kind="money"
                      role={c.counted ? "high" : "target"}
                      title={c.credit === "given" ? "Your gift" : `${(c.gift.donorId && seat.donorNames.get(c.gift.donorId)) || "A donor"}, brought in by you`}
                      meta={`${formatMoney(c.gift.amountCents)} · ${longDate(c.gift.receivedOn)}${c.counted ? "" : c.excludedBecause === "in_kind" ? " · in kind, not counted" : " · outside this year, not counted"}`}
                      wrap
                    />
                  ))
                )}
              </Section>
            </>
          ) : (
            <EmptyState kind="money" title="No Seat Linked Yet">
              Your sign-in is not linked to a board seat. Ask {org.name} to link it from your seat&apos;s page.
            </EmptyState>
          )}
        </Section>
      )}

      {org.modules.board_governance && giving.boards.length > 0 && (
        <Section label="The Board" count={giving.boards.length} role="people" kind="people">
          {giving.boards.map(({ board, summary }) => {
            const pct = summary.committedCents > 0 ? Math.round((summary.raisedCents / summary.committedCents) * 100) : null;
            const role = roleForPercent(pct);
            return (
              <Card key={board.id}>
                <Stack gap={2}>
                  <div className="flex items-start justify-between gap-3">
                    <Body weight="bold">{board.name}</Body>
                    <Body weight="bold" numeric>
                      {pct === null ? "no target" : `${pct}%`}
                    </Body>
                  </div>
                  <Label>{`${summary.seatsFilled} ${summary.seatsFilled === 1 ? "seat" : "seats"} · ${formatMoneyShort(summary.committedCents)} give/get · ${formatMoneyShort(summary.raisedCents)} in`}</Label>
                  {summary.committedCents > 0 && <Meter parts={[{ role, fraction: (pct ?? 0) / 100 }]} />}
                </Stack>
              </Card>
            );
          })}
        </Section>
      )}
    </Screen>
  );
}
