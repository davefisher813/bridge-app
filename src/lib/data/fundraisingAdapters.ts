// Adapts stored fundraising rows into the rollup's plain types.
//
// Same seam as fitAdapters.ts and ncaaAdapters.ts: src/lib/fundraising/
// stays walled off from anything Supabase-shaped, so this file is the
// only place that knows a column is called `received_on`.
//
// The one thing it exists to get right: every amount crosses into
// integer cents here, once. Postgres returns numeric(12,2) as a string,
// and a caller that treats it as a number is one long donation list away
// from a total that is off by a cent, which is an hour of somebody's
// reconciliation.

import { toCents, type Gift, type Pledge, type BudgetLine, type GiftCategory, type GiftMethod } from "@/lib/fundraising/rollup";

export interface GiftRow {
  id: string;
  amount: number | string;
  received_on: string;
  category: string;
  method: string;
  donor_id: string | null;
  campaign_id: string | null;
  pledge_id: string | null;
}

export interface PledgeRow {
  id: string;
  amount: number | string;
  promised_on: string;
  due_on: string | null;
  status: string;
  donor_id: string | null;
  campaign_id: string | null;
}

export interface BudgetRow {
  fiscal_year: number;
  category: string;
  amount: number | string;
}

const CATEGORIES = new Set(["individual", "board", "corporate", "special_event", "grant"]);
const METHODS = new Set(["stripe", "check", "cash", "in_kind", "other"]);
const PLEDGE_STATUSES = new Set(["open", "fulfilled", "written_off"]);

// A value the database enum guarantees, narrowed for the compiler. The
// fallbacks exist for a row written before an enum value did, not
// because the column is untrusted.
function asCategory(v: string): GiftCategory {
  return (CATEGORIES.has(v) ? v : "individual") as GiftCategory;
}

function asMethod(v: string): GiftMethod {
  return (METHODS.has(v) ? v : "other") as GiftMethod;
}

export function toGift(row: GiftRow): Gift {
  return {
    id: row.id,
    amountCents: toCents(row.amount),
    receivedOn: row.received_on,
    category: asCategory(row.category),
    method: asMethod(row.method),
    donorId: row.donor_id,
    campaignId: row.campaign_id,
    pledgeId: row.pledge_id,
  };
}

export function toPledge(row: PledgeRow): Pledge {
  return {
    id: row.id,
    amountCents: toCents(row.amount),
    promisedOn: row.promised_on,
    dueOn: row.due_on,
    status: (PLEDGE_STATUSES.has(row.status) ? row.status : "open") as Pledge["status"],
    donorId: row.donor_id,
    campaignId: row.campaign_id,
  };
}

export function toBudgetLine(row: BudgetRow): BudgetLine {
  return {
    fiscalYear: Number(row.fiscal_year),
    category: asCategory(row.category),
    amountCents: toCents(row.amount),
  };
}

export function toGifts(rows: GiftRow[] | null | undefined): Gift[] {
  return (rows ?? []).map(toGift);
}

export function toPledges(rows: PledgeRow[] | null | undefined): Pledge[] {
  return (rows ?? []).map(toPledge);
}

export function toBudgetLines(rows: BudgetRow[] | null | undefined): BudgetLine[] {
  return (rows ?? []).map(toBudgetLine);
}
