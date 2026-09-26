// The school directory: every school on file, searched, filtered and
// grouped A to Z, and one school's shared facts. Read-only, and the
// same module serves the staff, family and member directories so the
// three screens cannot drift.
//
// `schools` is the one table a family or member page reads directly.
// It is reference data, not an org row: schools_read admits any
// authenticated user (migrations/0016_fk_indexes_and_initplan_policies.sql),
// the table carries no org_id, and migration 0031's contract (a member
// reads summaries, never org rows) is about org rows. So the RLS
// coverage loop in scripts/rls_test.sql never sees it, and the family
// matches page already reads it the same way.
//
// Filtering runs in memory over the whole table. The fake client
// (src/testing/fakeSupabase.ts) has no .contains/.overlaps and .eq on a
// text[] never matches, and the table is a hundred-odd rows; if it
// grows past a few thousand the query needs a DB-side filter and the
// fake needs the operator.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHOOL_DIVISIONS } from "@/lib/validation/school";
import { SCHOOL_FIT_COLUMNS, schoolRowToFitSchool, type SchoolRow } from "@/lib/data/fitAdapters";
import type { School } from "@/lib/fit/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export const DIRECTORY_COLUMNS = "id, name, division, conference, state, location, majors";

// Every column the engine reads, plus location (migration 0037), built
// on the engine's own list so the two cannot drift.
export const SCHOOL_FACTS_COLUMNS = `${SCHOOL_FIT_COLUMNS}, location`;

export interface DirectorySchool {
  id: string;
  name: string;
  division: string | null;
  conference: string | null;
  state: string | null;
  location: string | null;
  majors: string[] | null;
}

export interface DirectoryFilters {
  q?: string;
  division?: string;
  state?: string;
  conference?: string;
  major?: string;
}

export interface DirectoryOptions {
  divisions: string[];
  states: string[];
  conferences: string[];
  majors: string[];
}

export interface DirectoryGroup {
  letter: string;
  rows: DirectorySchool[];
}

export interface Directory {
  rows: DirectorySchool[];
  // The filters actually applied: a value the data does not carry is
  // dropped rather than rendering an empty list.
  filters: DirectoryFilters;
  options: DirectoryOptions;
  groups: DirectoryGroup[];
  total: number;
}

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

function uniqSorted(xs: (string | null | undefined)[]): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))].sort();
}

export async function loadDirectory(supabase: Client, raw: DirectoryFilters = {}): Promise<Directory> {
  const { data } = await supabase.from("schools").select(DIRECTORY_COLUMNS);
  const all = ((data ?? []) as DirectorySchool[]).slice().sort((a, b) => a.name.localeCompare(b.name));

  // Only the values the data carries are offered, so no filter yields an
  // empty list by itself. Divisions keep the NCAA order, the rest sort.
  const divisionIndex = (d: string) => {
    const i = (SCHOOL_DIVISIONS as readonly string[]).indexOf(d);
    return i === -1 ? SCHOOL_DIVISIONS.length : i;
  };
  const majorSet = new Map<string, string>();
  for (const s of all) for (const m of s.majors ?? []) if (m.trim() && !majorSet.has(m.trim().toLowerCase())) majorSet.set(m.trim().toLowerCase(), m.trim());
  const options: DirectoryOptions = {
    divisions: [...new Set(all.map((s) => s.division).filter((x): x is string => !!x))].sort((a, b) => divisionIndex(a) - divisionIndex(b) || a.localeCompare(b)),
    states: uniqSorted(all.map((s) => s.state)),
    conferences: uniqSorted(all.map((s) => s.conference)),
    majors: [...majorSet.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
  };

  // Validated the roster way: a value not in the options is dropped.
  const division = clean(raw.division);
  const state = clean(raw.state);
  const conference = clean(raw.conference);
  const major = clean(raw.major);
  const filters: DirectoryFilters = {
    q: clean(raw.q),
    division: division && options.divisions.includes(division) ? division : undefined,
    state: state && options.states.includes(state) ? state : undefined,
    conference: conference && options.conferences.includes(conference) ? conference : undefined,
    // The option's own spelling, so the dropdown shows the major that is
    // applied when the address carries it in another case.
    major: major ? options.majors.find((m) => m.toLowerCase() === major.toLowerCase()) : undefined,
  };

  const q = filters.q?.toLowerCase();
  const rows = all.filter((s) => {
    if (q && !`${s.name} ${s.division ?? ""} ${s.conference ?? ""} ${s.state ?? ""} ${s.location ?? ""}`.toLowerCase().includes(q)) return false;
    if (filters.division && s.division !== filters.division) return false;
    if (filters.state && s.state !== filters.state) return false;
    if (filters.conference && s.conference !== filters.conference) return false;
    if (filters.major && !(s.majors ?? []).some((m) => m.trim().toLowerCase() === filters.major!.toLowerCase())) return false;
    return true;
  });

  const byLetter = new Map<string, DirectorySchool[]>();
  for (const s of rows) {
    const first = s.name.trim().charAt(0).toUpperCase();
    const letter = /^[A-Z]$/.test(first) ? first : "#";
    byLetter.set(letter, [...(byLetter.get(letter) ?? []), s]);
  }
  const groups: DirectoryGroup[] = [...byLetter.entries()].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))).map(([letter, rows]) => ({ letter, rows }));

  return { rows, filters, options, groups, total: all.length };
}

export interface SchoolFacts {
  school: School;
  // "City, ST" from schools.location (migration 0037). Kept beside the
  // engine's School rather than on it: the engine is walled off and
  // does not read it.
  location: string | null;
}

export async function loadSchoolFacts(supabase: Client, id: string): Promise<SchoolFacts | null> {
  const { data } = await supabase.from("schools").select(SCHOOL_FACTS_COLUMNS).eq("id", id).single();
  if (!data) return null;
  const row = data as SchoolRow & { location?: string | null };
  return { school: schoolRowToFitSchool(row), location: row.location?.trim() || null };
}
