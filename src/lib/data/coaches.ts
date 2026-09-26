// The college coach directory (migration 0036): public staff listings,
// shared across orgs and readable by owners and staff only. An org's
// own coach relationship lives in org_school_notes, not here.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface Coach {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isRecruitingCoordinator: boolean;
}

// The head coach first, then whoever runs recruiting, then everyone
// else by name: the order someone reaching out would want.
function rank(c: Coach): number {
  const t = (c.title ?? "").toLowerCase();
  if (t.includes("head coach") && !t.includes("assistant") && !t.includes("associate")) return 0;
  if (c.isRecruitingCoordinator) return 1;
  return 2;
}

export async function loadCoachesForSchool(supabase: Client, schoolId: string): Promise<Coach[]> {
  const { data } = await supabase.from("college_coaches").select("id, name, title, email, phone, is_recruiting_coordinator").eq("school_id", schoolId);
  const coaches = ((data ?? []) as { id: string; name: string; title: string | null; email: string | null; phone: string | null; is_recruiting_coordinator: boolean }[]).map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title,
    email: r.email?.trim() || null,
    phone: r.phone?.trim() || null,
    isRecruitingCoordinator: !!r.is_recruiting_coordinator,
  }));
  return coaches.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
