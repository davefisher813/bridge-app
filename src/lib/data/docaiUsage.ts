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

// ── Rate limit (backend audit F-05) ──────────────────────────────────
// The monthly cap is arithmetic on estimates after the fact; nothing
// stopped a burst of uploads (or a stuck browser retrying) from making
// dozens of paid calls in a minute before the cap noticed. This is a
// hard ceiling on how many real model calls one org makes in a window,
// counted from the same ledger every call writes to. The stand-in is
// free and is never limited.
export const RATE_LIMITS = [
  { minutes: 10, max: 20 },
  { minutes: 60, max: 60 },
] as const;

export async function loadRecentCalls(client: Client, orgId: string, now = new Date()): Promise<number[]> {
  const longest = Math.max(...RATE_LIMITS.map((l) => l.minutes));
  const since = new Date(now.getTime() - longest * 60_000).toISOString();
  const { data } = await client.from("docai_usage").select("created_at").eq("org_id", orgId).gte("created_at", since);
  return ((data ?? []) as { created_at: string }[]).map((r) => new Date(r.created_at).getTime());
}

// A sentence when this many more calls would break a window, or null.
export function rateRefusal(callTimes: number[], requested: number, now = new Date()): string | null {
  for (const { minutes, max } of RATE_LIMITS) {
    const since = now.getTime() - minutes * 60_000;
    const used = callTimes.filter((t) => t >= since).length;
    if (used + requested > max) {
      const left = Math.max(0, max - used);
      return `Too many documents read in the last ${minutes === 60 ? "hour" : `${minutes} minutes`}: the limit is ${max}${left > 0 ? ` and ${left} more can be read now` : ""}. Try again in a little while.`;
    }
  }
  return null;
}
