// Who may advise an athlete, decided in one place.
//
// The rule is the database's (migration 0039's trigger: owner or staff of
// the athlete's own org, nobody else) and this file is its one app twin.
// Stage 5, Phase 2 (Dave approved the plan 2026-09-27): the same check
// used to be written out in five places, and src/laws/advisorLaws.test.ts
// now holds that it appears here and nowhere else. After migration 0041
// every Admin is owner; staff stays in the list so a leftover row still
// advises, the same as the trigger.
//
// Also here: the list the Advisor sheet shows, most recently used first
// (athletes.advisor_assigned_at, migration 0043, stamped by the trigger),
// then by name, with Admins never picked yet last. Read only, through
// the caller's own client, so RLS answers.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/auth/guard";
import { cleanTitle } from "@/lib/org/roleLabels";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export const ADVISOR_ROLES: OrgRole[] = ["owner", "staff"];

export function canAdvise(role: OrgRole | string | null | undefined): boolean {
  return (ADVISOR_ROLES as string[]).includes(role ?? "");
}

// Is this person an Admin of this org? Asked before a write so the answer
// is a sentence, not the trigger's constraint message.
export async function isEligibleAdvisor(client: Client, orgId: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await client.from("org_members").select("user_id, role").eq("org_id", orgId).eq("user_id", userId).in("role", ADVISOR_ROLES).maybeSingle();
  return !!data && canAdvise((data as { role: string }).role);
}

export interface AdvisorChoice {
  id: string;
  // Their full name, or their email when no name is on file yet.
  name: string;
  email: string;
  role: OrgRole;
  title: string | null;
  // When they were last assigned to any athlete here, or null.
  lastAssignedAt: string | null;
  // How many of this org's athletes they advise now.
  advising: number;
  // Have they ever signed in? The Members screen calls the rest invited.
  signedIn: boolean;
}

interface MemberRow {
  user_id: string;
  role: string;
  title?: string | null;
  users: { email: string | null; full_name: string | null; last_sign_in_at?: string | null } | { email: string | null; full_name: string | null; last_sign_in_at?: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Newest stamp first, nulls last, then A to Z, then id so the order is
// the same on every render.
export function sortAdvisorChoices<T extends { name: string; id: string; lastAssignedAt: string | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.lastAssignedAt !== b.lastAssignedAt) {
      if (a.lastAssignedAt === null) return 1;
      if (b.lastAssignedAt === null) return -1;
      return a.lastAssignedAt < b.lastAssignedAt ? 1 : -1;
    }
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.id.localeCompare(b.id);
  });
}

export async function loadAdvisorChoices(client: Client, orgId: string): Promise<AdvisorChoice[]> {
  const [{ data: memberRows }, { data: athleteRows }] = await Promise.all([
    client.from("org_members").select("user_id, role, title, users(email, full_name, last_sign_in_at)").eq("org_id", orgId).in("role", ADVISOR_ROLES),
    client.from("athletes").select("advisor_id, advisor_assigned_at").eq("org_id", orgId).is("deleted_at", null),
  ]);

  const latest = new Map<string, string | null>();
  const counts = new Map<string, number>();
  for (const a of (athleteRows ?? []) as { advisor_id: string | null; advisor_assigned_at: string | null }[]) {
    if (!a.advisor_id) continue;
    counts.set(a.advisor_id, (counts.get(a.advisor_id) ?? 0) + 1);
    const have = latest.get(a.advisor_id) ?? null;
    const stamp = a.advisor_assigned_at ?? null;
    if (!latest.has(a.advisor_id) || (stamp !== null && (have === null || stamp > have))) latest.set(a.advisor_id, stamp);
  }

  const choices = ((memberRows ?? []) as MemberRow[])
    .map((r): AdvisorChoice | null => {
      const person = unwrap(r.users);
      const email = person?.email?.trim() ?? "";
      const name = person?.full_name?.trim() || email;
      if (!name) return null;
      return { id: r.user_id, name, email, role: r.role as OrgRole, title: cleanTitle(r.title), lastAssignedAt: latest.get(r.user_id) ?? null, advising: counts.get(r.user_id) ?? 0, signedIn: !!person?.last_sign_in_at };
    })
    .filter((p): p is AdvisorChoice => p !== null);

  return sortAdvisorChoices(choices);
}
