import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { Avatar, Body, Card, Chip, EmptyState, Label, LinkButton, Meter, Notice, Row, Screen, Section, Stack, TextLink } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { RowKind } from "@/components/RowGlyph";
import { formatMoney, formatMoneyShort } from "@/lib/fundraising/rollup";
import { BOARD_KIND_PURPOSE, type SeatStatus } from "@/lib/governance/giveGet";
import { loadGovernance } from "@/lib/data/governanceView";

export const dynamic = "force-dynamic";

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

function roleFor(percent: number | null): "committed" | "offer" | "target" {
  if (percent === null) return "target";
  return percent >= 75 ? "committed" : "offer";
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug, id } = await params;
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

  const summary = view.summaryByBoard.get(board.id)!;
  const members = view.membersByBoard.get(board.id) ?? [];
  // Active first, since they are the ones carrying a live commitment.
  const ordered = [...members].sort((a, b) => {
    const rank = (s: SeatStatus) => (s === "active" ? 0 : s === "prospect" ? 1 : 2);
    return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name);
  });

  const role = roleFor(summary.percent);

  return (
    <Screen
      title={board.name}
      back={{ href: `/org/${slug}/board-governance`, label: "Boards" }}
      lede={`${formatMoneyShort(board.giveGetCents)} give/get per seat. ${BOARD_KIND_PURPOSE[board.kind]}`}
      action={canEdit && !summary.atCapacity ? <TextLink href={`/org/${slug}/board-governance/${board.id}/seats/new`}>+ Add</TextLink> : undefined}
    >
      <Card>
        <Stack gap={2}>
          <div className="flex items-start justify-between gap-3">
            <Body weight="bold">
              {formatMoneyShort(summary.raisedCents)} of {formatMoneyShort(summary.committedCents)}
            </Body>
            <Body weight="bold" numeric>
              {summary.percent === null ? "no target" : `${summary.percent}%`}
            </Body>
          </div>
          <Label>
            {summary.seatsFilled} {summary.seatsFilled === 1 ? "seat" : "seats"} filled &middot; {summary.seatsOpen} open &middot; {summary.membersMeeting} of{" "}
            {summary.seatsFilled} fully met
          </Label>
          <Meter parts={[{ role, fraction: (summary.percent ?? 0) / 100 }]} />
        </Stack>
      </Card>

      {summary.belowMinimum && <Notice tone="warning" title={`Below the floor of ${board.minSeats} ${board.minSeats === 1 ? "seat" : "seats"}`} />}

      <Section label="Seats" count={ordered.length} role="contact" kind="people">
        {ordered.length === 0 && <EmptyState kind="people" title="No Seats on This Board Yet" />}
        {ordered.map((m) => {
          const p = view.progressByMember.get(m.id);
          // The percentage is only worth printing if it can be opened.
          // A member told they are at 40% with no way to see which gifts
          // got them there cannot spot a missing one.
          const lines: string[] = [m.roleTitle ?? "No role set"];
          if (m.status === "active" && p) {
            lines.push(`${formatMoneyShort(p.givenCents)} given`, `${formatMoneyShort(p.raisedCents)} brought in`);
            if (m.donorId === null) lines.push("no donor record linked");
            // Beside the progress, never inside it. A promise does not
            // discharge a commitment.
            if (p.pledgedCents > 0) lines.push(`${formatMoney(p.pledgedCents)} pledged, not yet received`);
          }
          return (
            <Row
              key={m.id}
              href={`/org/${slug}/board-governance/${board.id}/seats/${m.id}`}
              leading={<Avatar name={m.name} />}
              title={m.name}
              meta={lines.join(" · ")}
              wrap
              trailing={
                m.status === "active" ? (
                  <Body weight="bold" numeric>
                    {p?.percent === null || p === undefined ? "no target" : `${p.percent}%`}
                  </Body>
                ) : (
                  <Chip label={STATUS_LABEL[m.status]} kind={SEAT_KIND[m.status]} role="neutral" />
                )
              }
            />
          );
        })}
      </Section>

      <Note>
        Only an active seat counts toward the board&apos;s total. A prospect has not joined and an emeritus member is not on the hook, so counting
        either would make the board look further behind than it is.
      </Note>

      {canEdit && !summary.atCapacity && <LinkButton href={`/org/${slug}/board-governance/${board.id}/seats/new`}>Add a Seat</LinkButton>}

      {canEdit && summary.atCapacity && (
        <Notice tone="info" title={`This board is full at ${board.maxSeats} active seats`}>
          Raise the cap to add another.
        </Notice>
      )}
    </Screen>
  );
}
