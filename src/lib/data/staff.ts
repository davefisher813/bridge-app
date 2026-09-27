// The people who may advise an athlete: an org's owners and staff, with
// the name and email to show. The same query the family More screen
// runs for Who to Ask, unwrapped once here for the Advisor picker and
// the advisor's row on the athlete pages.
//
// A family login may read these users rows too (migration 0031, the
// family's staff clause), so the loader is safe on either side.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/auth/guard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface StaffPerson {
  id: string;
  // Their full name, or their email when no name is on file yet.
  name: string;
  email: string;
  role: OrgRole;
}

interface StaffRow {
  user_id: string;
  role: string;
  users: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function loadStaff(supabase: Client, orgId: string): Promise<StaffPerson[]> {
  const { data } = await supabase.from("org_members").select("user_id, role, users(email, full_name)").eq("org_id", orgId).in("role", ["owner", "staff"]).order("created_at", { ascending: true });
  return ((data ?? []) as StaffRow[])
    .map((r) => {
      const person = unwrap(r.users);
      const email = person?.email?.trim() ?? "";
      const name = person?.full_name?.trim() || email;
      return name ? { id: r.user_id, name, email, role: r.role as OrgRole } : null;
    })
    .filter((p): p is StaffPerson => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
