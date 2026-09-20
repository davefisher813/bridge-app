// Every board, and how close each is to the commitment its seats carry.
//
// Gated on orgs.modules.board_governance, off by default, so Elite Squad
// never sees any of it. The gate is checked in the actions too.
//
// The structure is Bridge's own: five tiers with a give/get amount each,
// sport boards starting at three seats and growing to five. See
// src/lib/governance/giveGet.ts for the rules, all of which are about
// not misleading a board chair.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { Body, Card, EmptyState, Label, LinkButton, Meter, Screen, Section, Stack, Stat, StatRow, TextLink } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { formatMoneyShort } from "@/lib/fundraising/rollup";
import { BOARD_KIND_LABEL } from "@/lib/governance/giveGet";
import { loadGovernance } from "@/lib/data/governanceView";

export const dynamic = "force-dynamic";

// Never red. A board behind on its give/get is behind, not broken, and
// the locked catalog keeps red for the primary action.
function roleFor(percent: number | null): "committed" | "offer" | "target" {
  if (percent === null) return "target";
  return percent >= 75 ? "committed" : "offer";
}

export default async function BoardGovernancePage({
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
  if (!org.modules.board_governance) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const fiscalYear = Number(year) || new Date().getFullYear();
  const view = await loadGovernance(org.id, fiscalYear);

  const totals = view.boards.reduce(
    (acc, b) => {
      const s = view.summaryByBoard.get(b.id);
      if (!s) return acc;
      return {
        committed: acc.committed + s.committedCents,
        raised: acc.raised + s.raisedCents,
        seats: acc.seats + s.seatsFilled,
        meeting: acc.meeting + s.membersMeeting,
      };
    },
    { committed: 0, raised: 0, seats: 0, meeting: 0 },
  );
  const overallPercent = totals.committed > 0 ? Math.round((totals.raised / totals.committed) * 100) : null;

  return (
    <Screen
      title="Boards"
      lede={`${fiscalYear}. Each tier carries a give/get commitment, and progress is cash in the door, given or brought in.`}
      action={canEdit && view.boards.length > 0 ? <TextLink href={`/org/${slug}/board-governance/new`}>+ Add</TextLink> : undefined}
    >
      {view.boards.length === 0 ? (
        <>
          <EmptyState kind="governance" title="No Boards Yet">
            Add your tiers and the seats on them, and each member&apos;s give/get progress builds itself from the gifts already recorded.
          </EmptyState>
          {canEdit && <LinkButton href={`/org/${slug}/board-governance/new`}>Add the First Board</LinkButton>}
        </>
      ) : (
        <>
          <StatRow>
            <Stat value={formatMoneyShort(totals.committed)} label="Committed" role="contact" kind="money" />
            <Stat value={formatMoneyShort(totals.raised)} label="Delivered" role={roleFor(overallPercent)} kind="check" />
          </StatRow>

          <Note title={overallPercent === null ? "No commitments set" : `${overallPercent}% delivered`}>
            Across {totals.seats} active {totals.seats === 1 ? "seat" : "seats"}, {totals.meeting} of {totals.seats} fully met. Give/get counts both
            halves: a member meets their number by giving it or by bringing it in, and a gift is never counted twice when they did both.
          </Note>

          <Section label="Boards" count={view.boards.length} role="committed" kind="governance">
            {view.boards.map((b) => {
              const s = view.summaryByBoard.get(b.id)!;
              const role = roleFor(s.percent);
              return (
                <Card key={b.id} href={`/org/${slug}/board-governance/${b.id}`}>
                  <Stack gap={2}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Body weight="bold" truncate>
                          {b.name}
                        </Body>
                        <Label>
                          {formatMoneyShort(b.giveGetCents)} give/get &middot; {s.seatsFilled} of {b.maxSeats} seats
                        </Label>
                      </div>
                      <Body weight="bold" numeric>
                        {s.percent === null ? "no target" : `${s.percent}%`}
                      </Body>
                    </div>
                    {s.belowMinimum && (
                      <Label>
                        Below the floor of {b.minSeats} {b.minSeats === 1 ? "seat" : "seats"} for {BOARD_KIND_LABEL[b.kind].toLowerCase()}.
                      </Label>
                    )}
                    <Meter parts={[{ role, fraction: (s.percent ?? 0) / 100 }]} />
                  </Stack>
                </Card>
              );
            })}
          </Section>

          {/* Organized by board above, and by who is behind here. The
              second is the question a chair asks first, and answering it
              from the board list means opening every board in turn. */}
          <LinkButton href={`/org/${slug}/board-governance/members`} variant="secondary">
            Every Seat
          </LinkButton>
        </>
      )}
    </Screen>
  );
}
