// The master account (migration 0070; Dave, 2026-10-13: "make me the
// master account to control everyone's access levels"). One Admin per
// org may be named; while one is, only they invite, change a role,
// remove someone or resend an invite. Nobody named: any Admin does, as
// before. Titles, names and photos are not access levels and stay with
// every Admin.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

// The master's name as every screen and refusal says it.
export async function masterName(supabase: Client, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase.from("users").select("full_name, email").eq("id", userId).maybeSingle();
  const p = data as { full_name: string | null; email: string | null } | null;
  return p?.full_name?.trim() || p?.email || "the master account";
}

// True when this caller may change who has access.
export function managesAccess(masterUserId: string | null, callerId: string): boolean {
  return masterUserId === null || masterUserId === callerId;
}

// The plain sentence a refused Admin reads.
export function accessRefusal(name: string | null): string {
  return `Only ${name ?? "the master account"}, the master account, changes who has access.`;
}

export const MASTER_PROTECTED = "The master account cannot be demoted or removed. Transfer it first, under Organization Settings.";
