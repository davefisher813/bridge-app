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
    client.from("docai_usage").select("cost_cents, created_at").eq("org_id", orgId).gte("created_at", since),
  ]);
  const capCents = Number((org as { docai_budget_cents?: number } | null)?.docai_budget_cents ?? 0);
  const thisMonth = (rows ?? []) as { cost_cents: number | string; created_at: string }[];
  const spentCents = Math.round(thisMonth.reduce((s, r) => s + Number(r.cost_cents), 0) * 1000) / 1000;
  return { spentCents, capCents, calls: thisMonth.length, exhausted: spentCents >= capCents };
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// One model call, for the spending screen: when, which model, what it
// cost, and the document it read while that document still exists.
export interface UsageCall {
  id: string;
  createdAt: string;
  model: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  documentId: string | null;
  documentName: string | null;
}

// This month's calls, newest first, capped at 100 rows (a month at the
// default budget is on the order of a hundred reads).
export async function loadMonthCalls(client: Client, orgId: string, now = new Date()): Promise<UsageCall[]> {
  const { data } = await client
    .from("docai_usage")
    .select("id, created_at, model, cost_cents, input_tokens, output_tokens, document_id")
    .eq("org_id", orgId)
    .gte("created_at", monthStart(now))
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as { id: string; created_at: string; model: string; cost_cents: number | string; input_tokens: number; output_tokens: number; document_id: string | null }[];
  const ids = [...new Set(rows.map((r) => r.document_id).filter((v): v is string => !!v))];
  const { data: docs } = ids.length ? await client.from("documents").select("id, file_name").eq("org_id", orgId).in("id", ids) : { data: [] as { id: string; file_name: string }[] };
  const names = new Map(((docs ?? []) as { id: string; file_name: string }[]).map((d) => [d.id, d.file_name]));
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    model: r.model,
    costCents: Number(r.cost_cents),
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    documentId: r.document_id,
    documentName: r.document_id ? (names.get(r.document_id) ?? null) : null,
  }));
}
