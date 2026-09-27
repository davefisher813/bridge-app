// An athlete's message thread (migration 0039): one flat thread per
// athlete, shared by the org's owners and staff and that athlete's
// family, never a member. Row level security decides who reads it;
// these helpers only shape what comes back.
//
// Read markers are a watermark, one row per person per thread in
// athlete_message_reads. Opening the thread moves the mark to now;
// messages by anyone else newer than the mark are unread.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface ThreadMessage {
  id: string;
  authorId: string | null;
  // Null when the author's account is gone (author_id set null) or the
  // reader cannot see their users row.
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface ThreadSummary {
  total: number;
  unread: number;
}

type Person = { full_name: string | null; email: string | null };

interface MessageRow {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  users: Person | Person[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Oldest first, the way a conversation reads.
export async function loadThread(supabase: Client, orgId: string, athleteId: string): Promise<ThreadMessage[]> {
  const { data } = await supabase.from("athlete_messages").select("id, author_id, body, created_at, users(full_name, email)").eq("org_id", orgId).eq("athlete_id", athleteId).order("created_at", { ascending: true });
  return ((data ?? []) as MessageRow[]).map((m) => {
    const person = m.author_id ? unwrap(m.users) : null;
    return {
      id: m.id,
      authorId: m.author_id,
      authorName: person?.full_name?.trim() || person?.email?.trim() || null,
      body: m.body,
      createdAt: m.created_at,
    };
  });
}

const at = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

// Per athlete: how many messages the thread holds and how many of them
// are by somebody else and newer than this person's read mark (all of
// somebody else's when there is no mark yet). Athletes with no messages
// are absent from the map.
export async function threadSummaryByAthlete(supabase: Client, orgId: string, userId: string, athleteIds: string[]): Promise<Map<string, ThreadSummary>> {
  const out = new Map<string, ThreadSummary>();
  if (athleteIds.length === 0) return out;
  const [{ data: reads }, { data: messages }] = await Promise.all([
    supabase.from("athlete_message_reads").select("athlete_id, read_at").eq("org_id", orgId).eq("user_id", userId).in("athlete_id", athleteIds),
    supabase.from("athlete_messages").select("athlete_id, author_id, created_at").eq("org_id", orgId).in("athlete_id", athleteIds),
  ]);
  const mark = new Map<string, number>();
  for (const r of (reads ?? []) as { athlete_id: string; read_at: string | null }[]) mark.set(r.athlete_id, at(r.read_at));
  for (const m of (messages ?? []) as { athlete_id: string; author_id: string | null; created_at: string }[]) {
    const s = out.get(m.athlete_id) ?? { total: 0, unread: 0 };
    s.total += 1;
    if (m.author_id !== userId) {
      const readAt = mark.get(m.athlete_id);
      if (readAt === undefined || Number.isNaN(readAt) || at(m.created_at) > readAt) s.unread += 1;
    }
    out.set(m.athlete_id, s);
  }
  return out;
}

// Just the unread counts, for the places that show only "N new".
export async function unreadByAthlete(supabase: Client, orgId: string, userId: string, athleteIds: string[]): Promise<Map<string, number>> {
  const summary = await threadSummaryByAthlete(supabase, orgId, userId, athleteIds);
  return new Map([...summary].map(([id, s]) => [id, s.unread]));
}

// Moves this person's mark on the thread to now. Idempotent, so a page
// that renders twice (a prefetch) does no harm. A failure is swallowed:
// an unread count that lags is not worth a broken thread screen.
export async function markThreadRead(supabase: Client, orgId: string, athleteId: string, userId: string): Promise<boolean> {
  const { error } = await supabase.from("athlete_message_reads").upsert({ org_id: orgId, athlete_id: athleteId, user_id: userId, read_at: new Date().toISOString() }, { onConflict: "athlete_id,user_id" });
  return !error;
}
