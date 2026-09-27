import type { SupabaseClient } from "@supabase/supabase-js";
import { loadHighSchoolOptions } from "@/lib/data/lookups";
import type { Suggestion } from "@/components/kit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

// What the course form suggests: the terms already on this athlete's
// transcript, newest first, and the schools this athlete's courses name
// ahead of the org's other high schools and the directory.
export async function loadCourseOptions(supabase: Client, orgId: string, athleteId: string): Promise<{ terms: string[]; schools: Suggestion[] }> {
  const [{ data }, highSchools] = await Promise.all([
    supabase.from("athlete_courses").select("term, school_name").eq("org_id", orgId).eq("athlete_id", athleteId),
    loadHighSchoolOptions(supabase, orgId),
  ]);
  const rows = (data ?? []) as { term: string | null; school_name: string | null }[];
  const terms = [...new Set(rows.map((r) => r.term?.trim() ?? "").filter(Boolean))].sort().reverse();
  const own = [...new Set(rows.map((r) => r.school_name?.trim() ?? "").filter(Boolean))];
  const schools: Suggestion[] = [...own, ...highSchools.map((h) => ({ value: h.value, label: h.label }))];
  return { terms, schools };
}
