// One board seat: its give/get and the gifts behind the number.
//
// The board page prints a percentage per seat and nothing underneath it.
// A member who is told they are at 40% and cannot see which gifts got
// them there has no way to spot a missing one, and the person who has to
// answer for it is the board chair.
//
// So this screen shows every gift attached to the seat, including the
// ones that did not count, each saying why. A list filtered down to the
// counted gifts leaves a member asking where their January cheque went;
// an unfiltered list with no marking does not add up to the percentage
// above it. creditedGifts() in the pure module does the marking, and a
// test pins the counted rows to the same total giveGetProgress reports.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { Body, Card, Chip, EmptyState, Label, LinkButton, Meter, Notice, Row, Screen, Section, Stack, Stat, StatRow } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { RowKind } from "@/components/RowGlyph";
import { formatMoney, formatMoneyShort, CATEGORY_LABEL, METHOD_LABEL } from "@/lib/fundraising/rollup";
import { creditedGifts, type SeatStatus } from "@/lib/governance/giveGet";
import { loadGovernance } from "@/lib/data/governanceView";

export const dynamic = "force-dynamic";

// The glyph each seat status wears, since the pills no longer carry a
// fill. Prospect is a target because that is what it is: somebody the
// chair is recruiting.
const SEAT_KIND: Record<SeatStatus, RowKind> = {
  prospect: "stage_target",
  active: "check",
  emeritus: "clock",
  resigned: "stage_none",
};

const STATUS_LABEL: Record<SeatStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  emeritus: "Emeritus",
  resigned: "Resigned",
};

const EXCLUSION_NOTE: Record<"in_kind" | "outside_period", string> = {
  in_kind: "In kind, so it does not count toward a cash commitment",
  outside_period: "Outside this year, so it counts toward the year it was received",
};

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function roleFor(percent: number | null): "committed" | "offer" | "target" {
  if (percent === null) return "target";
  return percent >= 75 ? "committed" : "offer";
}

export default async function SeatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string; memberId: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug, id, memberId } = await params;
  const { year } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const fiscalYear = Number(year) || new Date().getFullYear();
  const view = await loadGovernance(org.id, fiscalYear);

  const board = view.boards.find((b) => b.id === id);
  if (!board) notFound();

  const member = (view.membersByBoard.get(board.id) ?? []).find((m) => m.id === memberId);
  if (!member) notFound();

  const p = view.progressByMember.get(member.id)!;
  const credited = creditedGifts({
    member,
    gifts: view.gifts,
    pledges: view.pledges,
    solicitedBy: view.solicitedBy,
    pledgeSolicitedBy: view.pledgeSolicitedBy,
    periodStart: view.periodStart,
    periodEnd: view.periodEnd,
  });

  const role = member.status === "active" ? roleFor(p.percent) : "target";
  const countedCount = credited.filter((c) => c.counted).length;

  return (
    <Screen
      title={member.name}
      back={{ href: `/org/${slug}/board-governance/${board.id}`, label: board.name }}
      lede={member.roleTitle ?? "No role set"}
      action={<Chip label={STATUS_LABEL[member.status]} kind={SEAT_KIND[member.status]} role={member.status === "active" ? "committed" : "neutral"} />}
    >
      <StatRow>
        <Stat value={formatMoneyShort(p.givenCents)} label="Given" role="committed" kind="money" />
        <Stat value={formatMoneyShort(p.raisedCents)} label="Brought In" role="visit" kind="people" />
      </StatRow>

      {/* Only an active seat carries a live commitment, so only an
          active seat gets a progress bar. A prospect shown at 0% reads
          as somebody who is behind rather than somebody who has not
          joined. */}
      {member.status === "active" ? (
        <Card>
          <Stack gap={2}>
            <div className="flex items-start justify-between gap-3">
              <Body weight="bold">
                {p.commitmentCents === 0
                  ? "No commitment on this seat"
                  : p.met
                    ? `Commitment met: ${formatMoney(p.totalCents)} of ${formatMoney(p.commitmentCents)}`
                    : `${formatMoney(p.remainingCents)} still to go`}
              </Body>
              <Body weight="bold" numeric>
                {p.percent === null ? "no target" : `${p.percent}%`}
              </Body>
            </div>
            {p.commitmentCents > 0 && (
              <Label>
                {formatMoney(p.totalCents)} of {formatMoney(p.commitmentCents)} for {fiscalYear}. Giving and bringing in both count.
              </Label>
            )}
            {p.commitmentCents > 0 && <Meter parts={[{ role, fraction: (p.percent ?? 0) / 100 }]} />}
            {/* Beside the progress, never inside it. A promise does not
                discharge a commitment. */}
            {p.pledgedCents > 0 && <Label>{formatMoney(p.pledgedCents)} promised and not yet received. Not counted above.</Label>}
          </Stack>
        </Card>
      ) : (
        <Note>
          {member.status === "prospect"
            ? "A prospect has not taken the seat yet, so no commitment is running and nothing counts against this year."
            : "This seat is no longer active, so it carries no commitment for this year."}
        </Note>
      )}

      {member.donorId === null && (
        <Notice tone="warning" title="No Donor Record Linked">
          Their own giving cannot be found without one, so only gifts they are credited with bringing in are counted here.
        </Notice>
      )}

      {(member.termStart || member.termEnd) && (
        <Section label="Term" role="time" kind="clock">
          <Row
            kind="clock"
            role="time"
            title={`${member.termStart ? shortDate(member.termStart) : "Start not set"} to ${member.termEnd ? shortDate(member.termEnd) : "open ended"}`}
          />
        </Section>
      )}

      <Section label="Gifts on This Seat" count={credited.length} role="committed" kind="money">
        {credited.length === 0 ? (
          <EmptyState kind="money" title="Nothing Credited Yet">
            No gift is recorded against this seat. A gift counts here when this member is the donor, or when they are credited with bringing it in
            on the gift itself.
          </EmptyState>
        ) : (
          credited.map((c) => {
            const donorName = c.gift.donorId ? (view.donorNames.get(c.gift.donorId) ?? "Unknown donor") : "Anonymous";
            const rowRole = !c.counted ? "target" : c.credit === "given" ? "committed" : "visit";
            const detail = [donorName, shortDate(c.gift.receivedOn), CATEGORY_LABEL[c.gift.category] ?? c.gift.category, c.gift.method ? (METHOD_LABEL[c.gift.method] ?? c.gift.method) : null]
              .filter(Boolean)
              .join(" · ");
            // Said on the row rather than in a footnote. The alternative
            // is a member counting the list by hand and getting a
            // different number from the one at the top of the screen.
            const exclusion = !c.counted && c.excludedBecause ? ` Not counted. ${EXCLUSION_NOTE[c.excludedBecause]}.` : "";
            return (
              <Row
                key={c.gift.id}
                href={c.gift.donorId ? `/org/${slug}/fundraising/donors/${c.gift.donorId}` : undefined}
                kind={c.credit === "given" ? "money" : "people"}
                role={rowRole}
                title={c.credit === "given" ? "Given" : "Brought in"}
                meta={`${detail}.${exclusion}`}
                wrap
                trailing={
                  <Body weight="bold" numeric tone={c.counted ? "ink" : "muted"}>
                    {formatMoney(c.gift.amountCents)}
                  </Body>
                }
              />
            );
          })
        )}
        {credited.length > countedCount && (
          <Note>
            {countedCount} of {credited.length} of these count toward {fiscalYear}. The rest are shown so nothing looks lost, and are marked with the
            reason.
          </Note>
        )}
      </Section>

      {canEdit && member.donorId && (
        <LinkButton href={`/org/${slug}/fundraising/donors/${member.donorId}`} variant="secondary">
          Their Donor Record
        </LinkButton>
      )}
    </Screen>
  );
}
