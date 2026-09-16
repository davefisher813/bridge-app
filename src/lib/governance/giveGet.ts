// Board give/get: how close each board member is to the commitment
// their seat carries.
//
// From Bridge's own governance structure document, which sets five
// tiers, each with an amount: Executive $10K, General $5K, Sport boards
// $5K, Development $1K, Junior $500.
//
// The phrase is "give/get" and both halves count. A member meets their
// commitment by giving the money themselves OR by bringing it in from
// somebody else. Most board software gets this wrong by counting only
// personal giving, which understates every member who is good at
// fundraising and tells the board chair the wrong people are behind.
//
// Pure, and walled off from Supabase and Next like the fit, Doc AI and
// fundraising modules, so it runs in the test bench without a database.
//
// Three rules, and each is a way a board report misleads rather than
// breaks:
//
//   1. Give and get both count, and neither counts twice. A gift a
//      member both made and is credited with soliciting is one gift.
//   2. A pledge is still not money. It shows beside the progress, never
//      inside it, exactly as in the fundraising rollup.
//   3. Progress is measured within the term, not for all time. A member
//      in their third year has a commitment for this year, and last
//      year's giving does not discharge it.

import { outstandingOn, type Gift, type Pledge } from "@/lib/fundraising/rollup";

export type BoardKind = "executive" | "general" | "sport" | "development" | "junior";

export const BOARD_KINDS: BoardKind[] = ["executive", "general", "sport", "development", "junior"];

export const BOARD_KIND_LABEL: Record<BoardKind, string> = {
  executive: "Executive Board",
  general: "General Board",
  sport: "Sport Board",
  development: "Development Board",
  junior: "Junior Board",
};

// What each tier does, in the governance document's own words, so the
// screen explains a seat rather than just naming it.
export const BOARD_KIND_PURPOSE: Record<BoardKind, string> = {
  executive: "Sets strategy, oversees governance, approves major decisions, and leads high-level fundraising.",
  general: "The voting body. Supports through community action, advocacy, governance and key events.",
  sport: "Runs one sport. Starts at three seats and can grow to five.",
  development: "Entry-level supporters contributing to outreach, fundraising and event support.",
  junior: "Young professionals supporting events, promotion and fundraising, and the leadership pipeline.",
};

export type SeatStatus = "prospect" | "active" | "emeritus" | "resigned";

// Only an active seat carries a live commitment. A prospect has not
// joined, and an emeritus or resigned member is not on the hook for this
// year, so counting either against the board's total would make the
// board look further behind than it is.
export const COMMITTED_STATUSES: SeatStatus[] = ["active"];

export interface BoardMember {
  id: string;
  boardId: string;
  name: string;
  // Set when this member is also in the donor list, which is what lets
  // their own giving be found.
  donorId: string | null;
  roleTitle: string | null;
  status: SeatStatus;
  termStart: string | null;
  termEnd: string | null;
  // The seat's amount, which is normally the board's but can be set per
  // member: a founding member on a reduced commitment is a real thing
  // and pretending otherwise means somebody keeps a spreadsheet.
  commitmentCents: number;
}

export interface Board {
  id: string;
  kind: BoardKind;
  name: string;
  sport: string | null;
  giveGetCents: number;
  minSeats: number;
  maxSeats: number;
}

export interface GiveGetProgress {
  memberId: string;
  commitmentCents: number;
  // Money this member gave personally, in the period.
  givenCents: number;
  // Money they brought in from somebody else, in the period. The other
  // half of give/get, and the half most systems drop.
  raisedCents: number;
  // given + raised, with no gift counted twice.
  totalCents: number;
  // Still promised, by them or by somebody they solicited. Beside the
  // total, never inside it.
  pledgedCents: number;
  remainingCents: number;
  percent: number | null;
  met: boolean;
}

export interface GiveGetInput {
  member: BoardMember;
  gifts: Gift[];
  pledges: Pledge[];
  // Gift id to the board member credited with bringing it in.
  solicitedBy: Record<string, string | null>;
  // Pledge id to the same.
  pledgeSolicitedBy?: Record<string, string | null>;
  // The window the commitment applies to. Usually the fiscal year.
  periodStart: string;
  periodEnd: string;
}

function inPeriod(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

export function giveGetProgress(input: GiveGetInput): GiveGetProgress {
  const { member, gifts, solicitedBy, periodStart, periodEnd } = input;

  // In-kind is excluded for the same reason it is excluded from cash
  // raised: a donated case of food does not discharge a $10,000 cash
  // commitment, and telling a board chair otherwise is the kind of
  // mistake that surfaces in a budget meeting.
  const relevant = gifts.filter((g) => g.method !== "in_kind" && inPeriod(g.receivedOn, periodStart, periodEnd));

  let givenCents = 0;
  let raisedCents = 0;

  for (const g of relevant) {
    const isTheirs = member.donorId !== null && g.donorId === member.donorId;
    const theySolicited = solicitedBy[g.id] === member.id;

    // Counted once. A member who gives a gift and is also credited with
    // soliciting it has done one thing, not two, and double counting is
    // how somebody clears a $10,000 commitment with $5,000.
    if (isTheirs) givenCents += g.amountCents;
    else if (theySolicited) raisedCents += g.amountCents;
  }

  const pledgeSolicitedBy = input.pledgeSolicitedBy ?? {};
  let pledgedCents = 0;
  for (const p of input.pledges) {
    const isTheirs = member.donorId !== null && p.donorId === member.donorId;
    const theySolicited = pledgeSolicitedBy[p.id] === member.id;
    if (!isTheirs && !theySolicited) continue;
    if (!inPeriod(p.promisedOn, periodStart, periodEnd)) continue;
    pledgedCents += outstandingOn(p, gifts);
  }

  const totalCents = givenCents + raisedCents;
  const commitmentCents = member.commitmentCents;

  return {
    memberId: member.id,
    commitmentCents,
    givenCents,
    raisedCents,
    totalCents,
    pledgedCents,
    remainingCents: Math.max(0, commitmentCents - totalCents),
    // Null rather than a number when the seat carries no commitment, so
    // a Junior Board seat set to zero does not read as 0% of nothing.
    percent: commitmentCents > 0 ? Math.round((totalCents / commitmentCents) * 100) : null,
    met: commitmentCents > 0 && totalCents >= commitmentCents,
  };
}

export interface BoardSummary {
  boardId: string;
  seatsFilled: number;
  seatsOpen: number;
  atCapacity: boolean;
  belowMinimum: boolean;
  committedCents: number;
  raisedCents: number;
  pledgedCents: number;
  percent: number | null;
  membersMeeting: number;
}

export function summarizeBoard(board: Board, members: BoardMember[], progress: GiveGetProgress[]): BoardSummary {
  const byId = new Map(progress.map((p) => [p.memberId, p]));
  // Only active seats. A prospect has not joined and an emeritus member
  // is not on the hook, so counting either would misstate both the
  // seat count and the money.
  const active = members.filter((m) => COMMITTED_STATUSES.includes(m.status));

  const committedCents = active.reduce((s, m) => s + m.commitmentCents, 0);
  const raisedCents = active.reduce((s, m) => s + (byId.get(m.id)?.totalCents ?? 0), 0);
  const pledgedCents = active.reduce((s, m) => s + (byId.get(m.id)?.pledgedCents ?? 0), 0);

  return {
    boardId: board.id,
    seatsFilled: active.length,
    seatsOpen: Math.max(0, board.maxSeats - active.length),
    atCapacity: active.length >= board.maxSeats,
    // The governance document says a sport board starts at three and can
    // grow to five, so three is a floor worth flagging rather than a
    // suggestion.
    belowMinimum: active.length < board.minSeats,
    committedCents,
    raisedCents,
    pledgedCents,
    percent: committedCents > 0 ? Math.round((raisedCents / committedCents) * 100) : null,
    membersMeeting: active.filter((m) => byId.get(m.id)?.met).length,
  };
}

// The tiers from Bridge's governance document, as the amounts to offer
// when a board is created. Defaults to edit, never a rule: the amounts
// are stored per board, so another organization with a board sets its
// own and nothing here has to change.
export const DEFAULT_GIVE_GET_CENTS: Record<BoardKind, number> = {
  executive: 10_000_00,
  general: 5_000_00,
  sport: 5_000_00,
  development: 1_000_00,
  junior: 500_00,
};

// Sport boards start at three and can grow to five, per the same
// document. Every other board is open-ended, so the maximum is a large
// number rather than a rule nobody agreed to.
export const DEFAULT_SEATS: Record<BoardKind, { min: number; max: number }> = {
  executive: { min: 1, max: 15 },
  general: { min: 1, max: 30 },
  sport: { min: 3, max: 5 },
  development: { min: 1, max: 30 },
  junior: { min: 1, max: 30 },
};
