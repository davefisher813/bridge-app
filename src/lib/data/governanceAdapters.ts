// Adapts stored board rows into the give/get module's plain types.
//
// Same seam as every other adapter: src/lib/governance/ stays free of
// anything Supabase-shaped, and every amount crosses into integer cents
// here, once.

import { toCents } from "@/lib/fundraising/rollup";
import type { Board, BoardKind, BoardMember, SeatStatus } from "@/lib/governance/giveGet";

export interface BoardRow {
  id: string;
  name: string;
  kind: string;
  sport: string | null;
  give_get_amount: number | string;
  min_seats: number;
  max_seats: number;
}

export interface BoardMemberRow {
  id: string;
  board_id: string;
  name: string;
  donor_id: string | null;
  role_title: string | null;
  status: string;
  term_start: string | null;
  term_end: string | null;
  commitment_amount: number | string;
  // The sign-in this seat belongs to, when one is linked: what makes
  // the member's own Board version find their seat.
  user_id?: string | null;
}

const KINDS = new Set(["executive", "general", "sport", "development", "junior"]);
const STATUSES = new Set(["prospect", "active", "emeritus", "resigned"]);

export function toBoard(row: BoardRow): Board {
  return {
    id: row.id,
    kind: (KINDS.has(row.kind) ? row.kind : "general") as BoardKind,
    name: row.name,
    sport: row.sport,
    giveGetCents: toCents(row.give_get_amount),
    minSeats: Number(row.min_seats) || 0,
    maxSeats: Number(row.max_seats) || 0,
  };
}

export function toBoardMember(row: BoardMemberRow): BoardMember {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    donorId: row.donor_id,
    roleTitle: row.role_title,
    // A row written before an enum value existed falls back to prospect,
    // which is the status that counts toward nothing. Guessing "active"
    // would add a commitment nobody made.
    status: (STATUSES.has(row.status) ? row.status : "prospect") as SeatStatus,
    termStart: row.term_start,
    termEnd: row.term_end,
    commitmentCents: toCents(row.commitment_amount),
    userId: row.user_id ?? null,
  };
}

export function toBoards(rows: BoardRow[] | null | undefined): Board[] {
  return (rows ?? []).map(toBoard);
}

export function toBoardMembers(rows: BoardMemberRow[] | null | undefined): BoardMember[] {
  return (rows ?? []).map(toBoardMember);
}

// Gift id to the board member credited with bringing it in, which is the
// shape giveGetProgress wants. Built here rather than in the module so
// the module never sees a column name.
export function solicitedByMap(rows: Array<{ id: string; solicited_by: string | null }> | null | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const r of rows ?? []) out[r.id] = r.solicited_by;
  return out;
}
