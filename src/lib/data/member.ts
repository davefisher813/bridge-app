// What a member login (Bridge: Board) is allowed to look at, resolved
// through the three summary functions of migration 0031.
//
// A member reads no org rows at all since that migration: the database
// hands back the program as names and stages, one athlete's schools and
// stages, and the giving rows with every name stripped except on the
// gifts credited to the caller's own seat. These helpers are what the
// member screens call, so a page cannot reach for a table by mistake,
// and the give/get arithmetic runs through src/lib/governance/giveGet.ts
// so the member's number is the number staff see on the seat.

import { createClient } from "@/lib/supabase/server";
import { placementLine, type PlacementState } from "@/lib/placement";
import { toBudgetLines, toGifts, toPledges, type BudgetRow, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { solicitedByMap, toBoardMembers, toBoards, type BoardMemberRow, type BoardRow } from "@/lib/data/governanceAdapters";
import { creditedGifts, giveGetProgress, summarizeBoard, type Board, type BoardMember, type BoardSummary, type CreditedGift, type GiveGetProgress } from "@/lib/governance/giveGet";
import { campaignProgress, summarize, toCents, type CampaignProgress, type FundraisingSummary } from "@/lib/fundraising/rollup";

export interface ProgramAthlete {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  gradYear: number | null;
  recruitType: string;
  stage: PlacementState | "Offers" | "Targeting" | "No Targets";
  offers: number;
  // The school, or for a Drafted athlete the team.
  committedSchool: string | null;
  draftRound: number | null;
  draftYear: number | null;
}

interface ProgramRow {
  athlete_id: string;
  name: string;
  sport: string;
  position: string | null;
  grad_year: number | null;
  recruit_type: string;
  stage: string;
  offers: number;
  committed_school: string | null;
  draft_round?: number | null;
  draft_year?: number | null;
}

const PLACED: readonly string[] = ["Committed", "Enrolled", "Graduated", "Drafted"];
const STAGES = new Set([...PLACED, "Offers", "Targeting", "No Targets"]);

export async function loadProgram(orgId: string): Promise<ProgramAthlete[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("member_program", { p_org: orgId });
  return ((data ?? []) as ProgramRow[]).map((r) => ({
    id: r.athlete_id,
    name: r.name,
    sport: r.sport,
    position: r.position,
    gradYear: r.grad_year,
    recruitType: r.recruit_type,
    stage: (STAGES.has(r.stage) ? r.stage : "No Targets") as ProgramAthlete["stage"],
    offers: Number(r.offers ?? 0),
    committedSchool: r.committed_school,
    draftRound: r.draft_round ?? null,
    draftYear: r.draft_year ?? null,
  }));
}

export interface ProgramSchool {
  targetId: string;
  schoolName: string;
  division: string;
  status: string;
}

export async function loadProgramSchools(orgId: string, athleteId: string): Promise<ProgramSchool[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("member_program_schools", { p_org: orgId, p_athlete: athleteId });
  return ((data ?? []) as { target_id: string; school_name: string; division: string; status: string }[]).map((r) => ({
    targetId: r.target_id,
    schoolName: r.school_name,
    division: r.division,
    status: r.status,
  }));
}

// "Committed to X", "Enrolled at X", "Graduated from X" or "Drafted by
// X, Round 5, 2026", worded the way the staff and family screens word it
// (src/lib/placement.ts); null while recruiting.
export function programPlacementLine(a: ProgramAthlete): string | null {
  if (!isPlaced(a)) return null;
  return placementLine({ state: a.stage as PlacementState, name: a.committedSchool, targetId: null, draftRound: a.draftRound, draftYear: a.draftYear });
}

// Recruiting has ended somewhere: committed, enrolled, graduated or drafted.
export function isPlaced(a: ProgramAthlete): boolean {
  return PLACED.includes(a.stage);
}

// Went to college: every placed stage but Drafted. What the Committed
// count on the member screens counts.
export function wentToCollege(a: ProgramAthlete): boolean {
  return isPlaced(a) && a.stage !== "Drafted";
}

// A class, or the kind of transfer, in a member's words.
export function classOf(a: { recruitType: string; gradYear: number | null }): string {
  if (a.recruitType === "hs") return a.gradYear ? `Class of ${a.gradYear}` : "High school";
  return "Transfer";
}

interface GivingPayload {
  my_seat_id: string | null;
  gifts: (GiftRow & { solicited_by: string | null; donor_name: string | null })[];
  pledges: (PledgeRow & { solicited_by: string | null })[];
  campaigns: { id: string; name: string; kind: string; goal_amount: number | string | null; ends_on: string | null }[];
  budget: BudgetRow[];
  boards: BoardRow[];
  seats: (Omit<BoardMemberRow, "name" | "role_title"> & { name: string | null; role_title: string | null })[];
}

export interface GivingView {
  fiscalYear: number;
  summary: FundraisingSummary;
  campaigns: { id: string; name: string; endsOn: string | null; progress: CampaignProgress }[];
  // The caller's own seat, with its progress and every gift credited to
  // it. Null when no seat is linked to this sign-in.
  seat: { member: BoardMember; board: Board | null; progress: GiveGetProgress; credited: CreditedGift[]; donorNames: Map<string, string> } | null;
  // Every board's total, seats counted and money summed, no names.
  boards: { board: Board; summary: BoardSummary }[];
}

export async function loadGiving(orgId: string, fiscalYear: number, today: string): Promise<GivingView | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("member_giving", { p_org: orgId });
  const raw = data as GivingPayload | null;
  if (!raw) return null;

  const gifts = toGifts(raw.gifts);
  const pledges = toPledges(raw.pledges);
  const budget = toBudgetLines(raw.budget);
  const summary = summarize({ gifts, pledges, budget, fiscalYear, today });
  const campaigns = raw.campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    endsOn: c.ends_on,
    progress: campaignProgress(c.id, toCents(c.goal_amount ?? 0), gifts, pledges),
  }));

  // Other seats carry no name. They still count toward the board's
  // total, so they are real members here with a placeholder name that
  // no screen prints.
  const boards = toBoards(raw.boards);
  const seats = toBoardMembers(raw.seats.map((s) => ({ ...s, name: s.name ?? "A seat", role_title: s.role_title })));
  const solicitedBy = solicitedByMap(raw.gifts);
  const pledgeSolicitedBy = solicitedByMap(raw.pledges);
  const periodStart = `${fiscalYear}-01-01`;
  const periodEnd = `${fiscalYear}-12-31`;
  const progressOf = (m: BoardMember) => giveGetProgress({ member: m, gifts, pledges, solicitedBy, pledgeSolicitedBy, periodStart, periodEnd });

  const boardViews = boards.map((board) => {
    const members = seats.filter((m) => m.boardId === board.id);
    return { board, summary: summarizeBoard(board, members, members.map(progressOf)) };
  });

  const mine = raw.my_seat_id ? seats.find((m) => m.id === raw.my_seat_id) ?? null : null;
  const seat = mine
    ? {
        member: mine,
        board: boards.find((b) => b.id === mine.boardId) ?? null,
        progress: progressOf(mine),
        credited: creditedGifts({ member: mine, gifts, pledges, solicitedBy, pledgeSolicitedBy, periodStart, periodEnd }),
        donorNames: new Map(raw.gifts.filter((g) => g.donor_name && g.donor_id).map((g) => [g.donor_id as string, g.donor_name as string])),
      }
    : null;

  return { fiscalYear, summary, campaigns, seat, boards: boardViews };
}
