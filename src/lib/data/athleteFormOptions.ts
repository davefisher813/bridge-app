// What the Add Athlete and Edit screens suggest while staff type
// (Stage 4, "more buttons, less typing"). One loader so the two screens
// cannot drift. Every list is a suggestion: anything typed that is not on
// it is kept as typed.
//
// Sources, and what each may contain:
// - high schools: the public directory plus this org's own names
//   (src/lib/data/lookups.ts, loadHighSchoolOptions)
// - colleges: the shared college directory
// - majors: the majors the shared college directory lists, plus the
//   ones this org's own athletes already want
// - events: where this org has logged metrics before
// Nothing here reads another org's rows: every org-scoped query is
// filtered by org_id, on top of row level security.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCollegeOptions, loadHighSchoolOptions, loadPastSourceDetails, MAX_OPTIONS, type CollegeOption, type HighSchoolOption } from "@/lib/data/lookups";
import { nameKey } from "@/lib/lookup/nameKey";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface AthleteFormOptions {
  highSchools: HighSchoolOption[];
  colleges: CollegeOption[];
  majors: string[];
  sourceDetails: string[];
}

function desiredMajorOf(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const v = (detail as { desiredMajor?: unknown }).desiredMajor;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// The org's own wanted majors first (the words this org already uses),
// then every major the college directory lists, A to Z, once each.
export async function loadMajorOptions(supabase: Client, orgId: string): Promise<string[]> {
  const [{ data: schoolRows }, { data: athleteRows }] = await Promise.all([
    supabase.from("schools").select("majors").limit(MAX_OPTIONS),
    supabase.from("athletes").select("detail").eq("org_id", orgId).is("deleted_at", null),
  ]);
  const seen = new Set<string>();
  const own: string[] = [];
  const directory: string[] = [];
  const add = (list: string[], v: string | null | undefined) => {
    const value = (v ?? "").trim();
    const k = nameKey(value);
    if (!k || seen.has(k)) return;
    seen.add(k);
    list.push(value);
  };
  for (const a of (athleteRows ?? []) as { detail: unknown }[]) add(own, desiredMajorOf(a.detail));
  for (const s of (schoolRows ?? []) as { majors: string[] | null }[]) for (const m of s.majors ?? []) add(directory, m);
  own.sort((a, b) => a.localeCompare(b));
  directory.sort((a, b) => a.localeCompare(b));
  return [...own, ...directory].slice(0, MAX_OPTIONS);
}

export async function loadAthleteFormOptions(supabase: Client, orgId: string): Promise<AthleteFormOptions> {
  const [highSchools, colleges, majors, sourceDetails] = await Promise.all([
    loadHighSchoolOptions(supabase, orgId),
    loadCollegeOptions(supabase),
    loadMajorOptions(supabase, orgId),
    loadPastSourceDetails(supabase, orgId),
  ]);
  return { highSchools, colleges, majors, sourceDetails };
}
