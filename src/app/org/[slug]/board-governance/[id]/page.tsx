import { notFound } from "next/navigation";
import { YearSwitch } from "@/components/YearSwitch";
import { orgToday } from "@/lib/datetime/today";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { AddButton, Avatar, Body, Card, Chip, ConfirmButton, EmptyState, Form, Label, LinkButton, Meter, Notice, Row, Screen, Section, Stack } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { RowKind } from "@/components/RowGlyph";
import { formatMoney, formatMoneyShort } from "@/lib/fundraising/rollup";
import { BOARD_KIND_PURPOSE, type SeatStatus } from "@/lib/governance/giveGet";
import { loadGovernance } from "@/lib/data/governanceView";
import { createClient } from "@/lib/supabase/server";
import { matchSeatsToDonors } from "@/lib/governance/seatDonors";
import { linkSeatsToDonorsByName } from "@/lib/actions/governance";

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
  searchParams: Promise<{ year?: string; notice?: string; error?: string }>;
}) {
  const { slug, id } = await params;
  const { year, notice, error } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();

  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const currentYear = Number(orgToday().slice(0, 4));
  const fiscalYear = Number(year) || currentYear;
  // The year rides along on every link inside give/get, so a chair
  // looking at last year stays in last year.
  const yq = fiscalYear === currentYear ? "" : `?year=${fiscalYear}`;
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

  // Seats with no donor record whose name is exactly one donor's (Oct 13:
  // every seat was unlinked, so the board read $0). Offered as one
  // confirmed step; anything ambiguous stays for the seat's own page.
  const supabase = await createClient();
  const { data: donorRows } = canEdit ? await supabase.from("donors").select("id, name").eq("org_id", org.id).is("deleted_at", null) : { data: [] };
  const seatMatches = canEdit ? matchSeatsToDonors(members.map((m) => ({ id: m.id, name: m.name, donorId: m.donorId })), (donorRows ?? []) as { id: string; name: string }[]) : [];
  const linkAction = async () => {
    "use server";
    await linkSeatsToDonorsByName(slug, id);
  };

  return (
    <Screen
      title={board.name}
      back={{ href: `/org/${slug}/board-governance${yq}`, label: "Boards" }} lede={`${fiscalYear}, ${formatMoneyShort(board.giveGetCents)} give/get per seat`}
      // Add stays when the board is full: the cap counts active seats
      // only, so a Prospect can always be added (readSeatForm refuses
      // only an active one), and the notice below says so.
      action={canEdit ? <AddButton href={`/org/${slug}/board-governance/${board.id}/seats/new`} label="Add" /> : undefined}
    >
      <YearSwitch year={fiscalYear} current={currentYear} hrefFor={(y) => `/org/${slug}/board-governance/${board.id}${y === currentYear ? "" : `?year=${y}`}`} />
      <Card href={`/org/${slug}/board-governance/members${yq}`}>
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

      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}

      {seatMatches.length > 0 && (
        <Section label="Seats with a Donor Record" count={seatMatches.length} role="offer" kind="donor">
          <Note title="Not Linked Yet">
            {`Their gifts only count toward give/get once the seat is linked. ${seatMatches.map((m) => m.seatName).join(", ")} ${seatMatches.length === 1 ? "matches" : "each match"} exactly one donor by name.`}
          </Note>
          <Form action={linkAction}>
            <ConfirmButton tone="change" title="Link These Seats to Their Donor Records?" body={`${seatMatches.map((m) => `${m.seatName} to the donor ${m.donorName}`).join("; ")}. Each seat's gifts then count toward give/get. You can change any of them on the seat.`} confirmLabel="Link Them">
              Link Them
            </ConfirmButton>
          </Form>
        </Section>
      )}

      {summary.belowMinimum && <Notice tone="warning" title={`Below the Floor of ${board.minSeats} ${board.minSeats === 1 ? "Seat" : "Seats"}`} />}

      <Section label="Seats" count={ordered.length} role="contact" kind="people">
        {ordered.length === 0 && (
          <EmptyState
            kind="people"
            title="No Seats on This Board Yet"
            action={canEdit ? <LinkButton href={`/org/${slug}/board-governance/${board.id}/seats/new`}>Add the First Seat</LinkButton> : undefined} />
        )}
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
              href={`/org/${slug}/board-governance/${board.id}/seats/${m.id}${yq}`}
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

      {canEdit && <LinkButton href={`/org/${slug}/board-governance/${board.id}/seats/new`}>{summary.atCapacity ? "Add a Prospect" : "Add a Seat"}</LinkButton>}

      {canEdit && (
        <LinkButton href={`/org/${slug}/board-governance/${board.id}/edit`} variant="secondary">
          Edit Board
        </LinkButton>
      )}

      {canEdit && summary.atCapacity && (
        <Notice tone="info" title={`This board is full at ${board.maxSeats} active seats`}>
          Only a Prospect can be added while it is full. Raise the cap to add another active seat.
        </Notice>
      )}
    </Screen>
  );
}
