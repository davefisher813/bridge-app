import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireMember } from "@/lib/auth/guard";
import { classOf, loadGiving, loadProgram } from "@/lib/data/member";
import { formatMoney, formatMoneyShort } from "@/lib/fundraising/rollup";
import { Body, Card, Chevron, EmptyState, Label, Meter, Prose, Row, Screen, Section, Stack, Stat, StatRow } from "@/components/kit";
import { SeatCard } from "@/components/SeatCard";

export const dynamic = "force-dynamic";

// Home for a member login (Bridge: Board). The program first, then
// their seat: Dave's pick in the Board Access catalog, 2026-09-21. The
// numbers are the org's; the seat is the one thing about them.

export default async function MemberHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireMember(org.id);
  const base = `/org/${slug}/member`;

  const today = new Date().toISOString().slice(0, 10);
  const fiscalYear = Number(today.slice(0, 4));
  const [program, giving] = await Promise.all([loadProgram(org.id), org.modules.donor_fundraising ? loadGiving(org.id, fiscalYear, today) : Promise.resolve(null)]);

  const committed = program.filter((a) => a.stage === "Committed");
  const offers = program.reduce((s, a) => s + a.offers, 0);
  const budgetPercent = giving && giving.summary.totalBudgetCents > 0 ? Math.round((giving.summary.totalCashCents / giving.summary.totalBudgetCents) * 100) : null;
  const seat = org.modules.board_governance ? giving?.seat ?? null : null;

  // An org without the board module has no seat to speak of, so the
  // lede does not promise one.
  const lede = org.modules.board_governance ? `The program, and your seat, for ${fiscalYear}` : "Where every athlete stands";

  return (
    <Screen title={org.name} lede={lede}>
      <StatRow>
        <Stat value={program.length} label="Athletes" role="people" kind="athlete" />
        <Stat value={committed.length} label="Committed" role="committed" kind="stage_committed" />
        <Stat value={offers} label="Offers" role="offer" kind="stage_offer" />
        {budgetPercent !== null && <Stat value={`${budgetPercent}%`} label="Of Budget" role="high" kind="money" />}
      </StatRow>

      <Section label="The Program" count={program.length} role="people" kind="athlete">
        {program.length === 0 ? (
          <EmptyState kind="athlete" title="No Athletes Yet">
            {org.name} has not added anyone to the program.
          </EmptyState>
        ) : (
          <>
            {committed.slice(0, 3).map((a) => (
              <Row key={a.id} href={`${base}/program/${a.id}`} kind="stage_committed" role="committed" title={a.name} meta={`${classOf(a)} · committed to ${a.committedSchool ?? "a school"}`} trailing={<Chevron />} wrap />
            ))}
            {committed.length === 0 && <Prose>Nobody has committed yet.</Prose>}
            <Row href={`${base}/program`} kind="athlete" role="people" title="Where Everyone Stands" meta={`${program.length} ${program.length === 1 ? "athlete" : "athletes"}, each with their stage`} trailing={<Chevron />} />
          </>
        )}
      </Section>

      {org.modules.donor_fundraising && giving && (
        <Section label="The Year" role="high" kind="money">
          <Card href={`${base}/giving`}>
            <Stack gap={2}>
              <div className="flex items-start justify-between gap-3">
                <Body weight="bold">{formatMoney(giving.summary.totalCashCents)} raised</Body>
                <Body weight="bold" numeric>
                  {budgetPercent === null ? "no budget set" : `${budgetPercent}%`}
                </Body>
              </div>
              {giving.summary.totalBudgetCents > 0 && <Label>{`Against a ${formatMoneyShort(giving.summary.totalBudgetCents)} budget for ${fiscalYear}.`}</Label>}
              {budgetPercent !== null && <Meter parts={[{ role: budgetPercent >= 100 ? "high" : budgetPercent >= 50 ? "mid" : "low", fraction: budgetPercent / 100 }]} />}
            </Stack>
          </Card>
        </Section>
      )}

      {org.modules.board_governance && (
        <Section label="Your Seat" role="high" kind="money">
          {seat ? (
            <SeatCard seat={seat} fiscalYear={fiscalYear} href={`${base}/giving`} />
          ) : (
            <EmptyState kind="money" title="No Seat Linked Yet">
              Your sign-in is not linked to a board seat. Ask {org.name} to link it from your seat&apos;s page.
            </EmptyState>
          )}
        </Section>
      )}
    </Screen>
  );
}
