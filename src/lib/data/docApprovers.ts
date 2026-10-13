// Who holds each document approver area in an org (migration 0067), read
// through the caller's own client so RLS answers (Admins only).
//
// A row whose person is no longer an Admin here reads as nobody, the same
// as the database gate: the app clears such a row and logs it when the
// person is demoted or removed, and a row left behind any other way must
// never hold a document hostage. Before 0067 is on the database the read
// fails and every area reads as nobody, which is today's behaviour.
//
// Not a "use server" file: it takes the caller's client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { APPROVER_AREAS, approverAreaOf, isApproverArea, NOBODY_NAMED, readyGate, type ApproverMap, type ReadyGate } from "@/lib/documents/approvers";
import { longDate } from "@/lib/copy/dates";
import { canAdvise } from "@/lib/org/advisors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

interface MemberRow {
  user_id: string;
  role: string;
  users: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
}

export async function loadDocApprovers(client: Client, orgId: string): Promise<ApproverMap> {
  const { data: rows, error } = await client.from("doc_approvers").select("area, user_id").eq("org_id", orgId);
  if (error || !rows || (rows as unknown[]).length === 0) return { ...NOBODY_NAMED };
  const held = (rows as { area: string; user_id: string }[]).filter((r) => isApproverArea(r.area));
  const ids = [...new Set(held.map((r) => r.user_id))];
  const { data: members } = await client.from("org_members").select("user_id, role, users(email, full_name)").eq("org_id", orgId).in("user_id", ids);
  const names = new Map<string, string>();
  // Only an Admin approves: the same one rule as an advisor.
  for (const m of ((members ?? []) as MemberRow[]).filter((r) => canAdvise(r.role))) {
    const u = Array.isArray(m.users) ? (m.users[0] ?? null) : m.users;
    names.set(m.user_id, u?.full_name?.trim() || u?.email?.trim() || "An Admin");
  }
  const out: ApproverMap = { ...NOBODY_NAMED };
  for (const area of APPROVER_AREAS) {
    const row = held.find((r) => r.area === area);
    const name = row ? names.get(row.user_id) : undefined;
    out[area] = row && name ? { id: row.user_id, name } : null;
  }
  return out;
}

// What the document screen's Ready control needs: who may mark this
// document Ready, and the line saying who did. Before 0067 is on the
// database both reads fail quietly and the screen is as it was.
export async function loadReadyControl(client: Client, orgId: string, documentId: string, category: string | null, userId: string): Promise<{ gate: ReadyGate; approvedBy: string | null }> {
  const gate = readyGate(category, approverAreaOf(category) ? await loadDocApprovers(client, orgId) : NOBODY_NAMED, userId);
  const { data } = await client.from("documents").select("approved_by, approved_at").eq("id", documentId).eq("org_id", orgId).maybeSingle();
  const row = data as { approved_by: string | null; approved_at: string | null } | null;
  if (!row?.approved_by) return { gate, approvedBy: null };
  const { data: person } = await client.from("users").select("full_name, email").eq("id", row.approved_by).maybeSingle();
  const p = person as { full_name: string | null; email: string | null } | null;
  const name = p?.full_name?.trim() || p?.email?.trim() || "an Admin";
  return { gate, approvedBy: `Approved by ${name}${row.approved_at ? ` on ${longDate(row.approved_at)}` : ""}.` };
}

// The areas one person holds here, read before a demotion or a removal
// clears them.
export async function areasHeldBy(client: Client, orgId: string, userId: string): Promise<string[]> {
  const { data, error } = await client.from("doc_approvers").select("area").eq("org_id", orgId).eq("user_id", userId);
  if (error) return [];
  return ((data ?? []) as { area: string }[]).map((r) => r.area).filter(isApproverArea);
}
