// The people who may advise an athlete: an org's Admins, with the name
// and email to show, for the Advisor picker on Add, the Advisors screen
// and the advisor's row on the athlete pages. The list itself comes from
// src/lib/org/advisors.ts, where the one rule for who advises lives.
//
// A family login may read these users rows too (migration 0031, the
// family's staff clause), so the loader is safe on either side.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/auth/guard";
import { cleanTitle } from "@/lib/org/roleLabels";
import { loadAdvisorChoices } from "@/lib/org/advisors";
import { isScoredStatus } from "@/lib/placement";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface StaffPerson {
  id: string;
  // Their full name, or their email when no name is on file yet.
  name: string;
  email: string;
  role: OrgRole;
  // Their Title here (migration 0041), or null. Display only.
  title: string | null;
}

// The org's Admins, A to Z. The rule for who that is lives in
// src/lib/org/advisors.ts and is asked there, not spelled again here
// (src/laws/advisorLaws.test.ts).
export async function loadStaff(supabase: Client, orgId: string): Promise<StaffPerson[]> {
  const choices = await loadAdvisorChoices(supabase, orgId);
  return choices.map((c) => ({ id: c.id, name: c.name, email: c.email, role: c.role, title: c.title })).sort((a, b) => a.name.localeCompare(b.name));
}

// How many athletes each Admin advises, for the Advisors screen under
// More (Stage 5, Phase 3). Only an athlete still being recruited counts
// (Active or Transferring, SCORED_STATUSES in src/lib/placement.ts), the
// same rule as the check-in reminders, so the number here agrees with
// the reminder on Today. `unassigned` is the same count for athletes
// with nobody. Removed athletes are excluded by the caller's query
// (deleted_at null), so a row that reaches here is on the roster.
export interface AdvisorCounts {
  byAdvisor: Map<string, number>;
  unassigned: number;
}

export function countByAdvisor(rows: { advisor_id: string | null; status: string }[]): AdvisorCounts {
  const byAdvisor = new Map<string, number>();
  let unassigned = 0;
  for (const r of rows) {
    if (!isScoredStatus(r.status)) continue;
    if (r.advisor_id) byAdvisor.set(r.advisor_id, (byAdvisor.get(r.advisor_id) ?? 0) + 1);
    else unassigned += 1;
  }
  return { byAdvisor, unassigned };
}

export async function loadAdvisorCounts(supabase: Client, orgId: string): Promise<AdvisorCounts> {
  const { data } = await supabase.from("athletes").select("id, advisor_id, status").eq("org_id", orgId).is("deleted_at", null);
  return countByAdvisor((data ?? []) as { advisor_id: string | null; status: string }[]);
}

// The Advisor picker's option label: "Name, Title" when a Title is set.
export function advisorOptionLabel(p: { name: string; title?: string | null }): string {
  const t = cleanTitle(p.title);
  return t ? `${p.name}, ${t}` : p.name;
}
