// The month's Doc AI spend against the org's cap.
//
// Read from docai_usage rows (migration 0025) through the caller's own
// client, so RLS decides which org's ledger this is. The month is the
// calendar month in UTC: a cap is a round number somebody set, not an
// accounting period, and a day of drift at the edges is fine.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface MonthSpend {
  spentCents: number;
  capCents: number;
  calls: number;
  exhausted: boolean;
}

export function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function loadMonthSpend(client: Client, orgId: string, now = new Date()): Promise<MonthSpend> {
  const since = monthStart(now);
  const [{ data: org }, { data: rows }] = await Promise.all([
    client.from("orgs").select("docai_budget_cents").eq("id", orgId).maybeSingle(),
    client.from("docai_usage").select("cost_cents, created_at").eq("org_id", orgId),
  ]);
  const capCents = Number((org as { docai_budget_cents?: number } | null)?.docai_budget_cents ?? 0);
  const thisMonth = ((rows ?? []) as { cost_cents: number | string; created_at: string }[]).filter((r) => r.created_at >= since);
  const spentCents = Math.round(thisMonth.reduce((s, r) => s + Number(r.cost_cents), 0) * 1000) / 1000;
  return { spentCents, capCents, calls: thisMonth.length, exhausted: spentCents >= capCents };
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
