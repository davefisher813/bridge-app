// Loading every board, its seats, and each seat's give/get progress.
//
// One place rather than repeated in each screen, because the queries are
// the same and the progress calculation has to be identical on the
// overview and on a board's own page. Two screens computing the same
// number two ways is how they end up disagreeing.

import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { solicitedByMap, toBoardMembers, toBoards, type BoardMemberRow, type BoardRow } from "@/lib/data/governanceAdapters";
import { giveGetProgress, summarizeBoard, type Board, type BoardMember, type BoardSummary, type GiveGetProgress } from "@/lib/governance/giveGet";

export interface GovernanceView {
  boards: Board[];
  membersByBoard: Map<string, BoardMember[]>;
  progressByMember: Map<string, GiveGetProgress>;
  summaryByBoard: Map<string, BoardSummary>;
  periodStart: string;
  periodEnd: string;
}

export async function loadGovernance(orgId: string, fiscalYear: number): Promise<GovernanceView> {
  const supabase = await createClient();

  // The commitment period. Calendar year, matching the fundraising
  // budget, so a board's progress and the org's P&L cover the same span.
  const periodStart = `${fiscalYear}-01-01`;
  const periodEnd = `${fiscalYear}-12-31`;

  const [{ data: boardRows }, { data: memberRows }, { data: giftRows }, { data: pledgeRows }] = await Promise.all([
    supabase.from("boards").select("id, name, kind, sport, give_get_amount, min_seats, max_seats").eq("org_id", orgId).order("sort_order"),
    supabase
      .from("board_members")
      .select("id, board_id, name, donor_id, role_title, status, term_start, term_end, commitment_amount")
      .eq("org_id", orgId)
      .order("name"),
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id, solicited_by")
      .eq("org_id", orgId),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id, solicited_by").eq("org_id", orgId),
  ]);

  const boards = toBoards(boardRows as BoardRow[] | null);
  const members = toBoardMembers(memberRows as BoardMemberRow[] | null);
  const gifts = toGifts(giftRows as GiftRow[] | null);
  const pledges = toPledges(pledgeRows as PledgeRow[] | null);

  const solicitedBy = solicitedByMap(giftRows as Array<{ id: string; solicited_by: string | null }> | null);
  const pledgeSolicitedBy = solicitedByMap(pledgeRows as Array<{ id: string; solicited_by: string | null }> | null);

  const membersByBoard = new Map<string, BoardMember[]>();
  for (const m of members) {
    const list = membersByBoard.get(m.boardId);
    if (list) list.push(m);
    else membersByBoard.set(m.boardId, [m]);
  }

  const progressByMember = new Map<string, GiveGetProgress>();
  for (const m of members) {
    progressByMember.set(
      m.id,
      giveGetProgress({ member: m, gifts, pledges, solicitedBy, pledgeSolicitedBy, periodStart, periodEnd }),
    );
  }

  const summaryByBoard = new Map<string, BoardSummary>();
  for (const b of boards) {
    const boardMembers = membersByBoard.get(b.id) ?? [];
    summaryByBoard.set(
      b.id,
      summarizeBoard(
        b,
        boardMembers,
        boardMembers.map((m) => progressByMember.get(m.id)!).filter(Boolean),
      ),
    );
  }

  return { boards, membersByBoard, progressByMember, summaryByBoard, periodStart, periodEnd };
}
