// Every seat across every board, in one list.
//
// The governance overview is organized by board, which is right for
// asking how the Executive Board is doing and wrong for the question a
// chair actually asks first: who is behind. Answering that today means
// opening five boards and holding five lists in your head.
//
// So this is the same seats, sorted by how far behind they are rather
// than by which board they sit on, with the board named on each row. The
// sort is the whole point of the screen: alphabetical would just be the
// board pages stapled together.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { Avatar, Body, Chip, EmptyState, Row, Screen, Section } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { RowKind } from "@/components/RowGlyph";
import { formatMoney, formatMoneyShort } from "@/lib/fundraising/rollup";
import { type SeatStatus } from "@/lib/governance/giveGet";
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

export default async function AllSeatsPage({
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
  await requireRole(org.id, STAFF_ROLES);

  const fiscalYear = Number(year) || new Date().getFullYear();
  const view = await loadGovernance(org.id, fiscalYear);

  const boardName = new Map(view.boards.map((b) => [b.id, b.name]));

  const seats = view.boards.flatMap((b) => view.membersByBoard.get(b.id) ?? []);
  const active = seats.filter((m) => m.status === "active");
  const other = seats.filter((m) => m.status !== "active");

  // Furthest behind first. A seat with no commitment has no percentage,
  // and sorts to the end rather than to the front: nothing is expected
  // of it, so it is not the chair's problem.
  const byNeed = [...active].sort((a, a2) => {
    const pa = view.progressByMember.get(a.id)?.percent;
    const pb = view.progressByMember.get(a2.id)?.percent;
    if (pa === null || pa === undefined) return 1;
    if (pb === null || pb === undefined) return -1;
    return pa - pb || a.name.localeCompare(a2.name);
  });

  const rank = (s: SeatStatus) => (s === "prospect" ? 0 : s === "emeritus" ? 1 : 2);
  const byStatus = [...other].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));

  const committedCents = active.reduce((s, m) => s + m.commitmentCents, 0);
  const raisedCents = active.reduce((s, m) => s + (view.progressByMember.get(m.id)?.totalCents ?? 0), 0);
  const meeting = active.filter((m) => view.progressByMember.get(m.id)?.met).length;
  const shortfall = Math.max(0, committedCents - raisedCents);

  return (
    <Screen
      title="Every Seat"
      back={{ href: `/org/${slug}/board-governance`, label: "Boards" }} lede={`${fiscalYear}, across all ${view.boards.length} ${view.boards.length === 1 ? "board" : "boards"}`}
    >
      {seats.length === 0 ? (
        <EmptyState kind="people" title="No Seats Yet">
          Add a board and its seats, and every one of them shows up here with its give/get progress.
        </EmptyState>
      ) : (
        <>
          {active.length > 0 && (
            <Note title={`${meeting} of ${active.length} active ${active.length === 1 ? "seat has" : "seats have"} met their commitment`}>
              {formatMoney(raisedCents)} of {formatMoney(committedCents)} committed.
              {shortfall > 0 ? ` ${formatMoney(shortfall)} outstanding across the board.` : ""}
            </Note>
          )}

          {byNeed.length > 0 && (
            <Section label="Active Seats" count={byNeed.length} role="contact" kind="people">
              {byNeed.map((m) => {
                const p = view.progressByMember.get(m.id);
                const lines: string[] = [`${boardName.get(m.boardId) ?? "Board"}${m.roleTitle ? ` · ${m.roleTitle}` : ""}`];
                if (p && p.commitmentCents > 0) {
                  lines.push(`${formatMoneyShort(p.totalCents)} of ${formatMoneyShort(p.commitmentCents)}${p.raisedCents > 0 ? ` · ${formatMoneyShort(p.raisedCents)} brought in` : ""}`);
                }
                return (
                  <Row
                    key={m.id}
                    href={`/org/${slug}/board-governance/${m.boardId}/seats/${m.id}`}
                    leading={<Avatar name={m.name} />}
                    title={m.name}
                    meta={lines.join(" · ")}
                    wrap
                    trailing={
                      <Body weight="bold" numeric>
                        {p?.percent == null ? "no target" : `${p.percent}%`}
                      </Body>
                    }
                  />
                );
              })}
            </Section>
          )}

          {/* Kept on the screen and kept out of the numbers above.
              A prospect has not joined and an emeritus member is not on
              the hook, so counting either would make the board look
              further behind than it is. Hiding them instead would lose
              the prospect list, which is the thing a chair recruits
              from. */}
          {byStatus.length > 0 && (
            <Section label="Not Carrying a Commitment" count={byStatus.length} role="target" kind="people">
              {byStatus.map((m) => (
                <Row
                  key={m.id}
                  href={`/org/${slug}/board-governance/${m.boardId}/seats/${m.id}`}
                  leading={<Avatar name={m.name} />}
                  title={m.name}
                  meta={`${boardName.get(m.boardId) ?? "Board"}${m.roleTitle ? ` · ${m.roleTitle}` : ""}`}
                  trailing={<Chip label={STATUS_LABEL[m.status]} kind={SEAT_KIND[m.status]} role="neutral" />}
                />
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
