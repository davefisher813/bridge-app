// What the suggestion lists on a form are built from, and how a typed
// name is resolved to one row. Every list is a suggestion: a value not
// on it is kept as typed, and a name that could mean more than one row
// resolves to nothing rather than a guess.
//
// Sources, and what each may contain:
// - high_schools (migration 0040): public NCES files only, filled by
//   scripts/load_high_schools.ts. Shared and read-only.
// - this org's own high school names, from its own rows. Never another
//   org's: every org-scoped query here is filtered by org_id, on top of
//   row level security.
// - schools and college_coaches: the shared college directory.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DIRECTORY_COLUMNS } from "@/lib/data/schoolDirectory";
import { escapeIlike, nameKey, pickUnique } from "@/lib/lookup/nameKey";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

// The kit's SuggestField takes { value, label? }; the extra fields are
// what a form fills from a pick (Home State from a high school, Current
// Division from a college, an email from a coach).
export interface HighSchoolOption {
  value: string;
  label?: string;
  id: string | null;
  state: string | null;
  ceebCode: string | null;
}

export interface CollegeOption {
  value: string;
  label?: string;
  id: string;
  division: string | null;
  conference: string | null;
  state: string | null;
}

export interface CoachOption {
  value: string;
  label?: string;
  id: string;
  schoolId: string;
  email: string | null;
  phone: string | null;
}

// A datalist longer than this is heavy on a phone and no help to anyone
// scrolling it; SuggestField caps at the same number.
export const MAX_OPTIONS = 2000;

interface HighSchoolRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  ceeb_code: string | null;
}

function place(city: string | null, state: string | null): string | undefined {
  const parts = [city?.trim(), state?.trim()].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function detailHighSchool(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const v = (detail as { highSchool?: unknown }).highSchool;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Directory rows in the states this org's athletes live in (the whole
// directory, up to the cap, when no athlete has a home state yet), then
// the org's own names that the directory does not already hold: from
// its courses, its grading scales, its approved course lists and its
// athletes' records. The org's own names come first, since they are the
// schools this org actually deals with.
export async function loadHighSchoolOptions(supabase: Client, orgId: string): Promise<HighSchoolOption[]> {
  const [{ data: athleteRows }, { data: courseRows }, { data: scaleRows }, { data: listRows }] = await Promise.all([
    supabase.from("athletes").select("home_state, detail").eq("org_id", orgId).is("deleted_at", null),
    supabase.from("athlete_courses").select("school_name").eq("org_id", orgId),
    supabase.from("org_grading_scales").select("school_name").eq("org_id", orgId),
    supabase.from("org_approved_course_lists").select("school_name, ceeb_code").eq("org_id", orgId),
  ]);

  const athletes = (athleteRows ?? []) as { home_state: string | null; detail: unknown }[];
  const states = [...new Set(athletes.map((a) => (a.home_state ?? "").trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)))].sort();

  const directoryQuery = supabase.from("high_schools").select("id, name, city, state, ceeb_code");
  const { data: directoryRows } = await (states.length ? directoryQuery.in("state", states) : directoryQuery).order("name_key", { ascending: true }).limit(MAX_OPTIONS);
  const directory = (directoryRows ?? []) as HighSchoolRow[];

  const own = new Map<string, HighSchoolOption>();
  const addOwn = (name: string | null | undefined, ceebCode: string | null = null) => {
    const n = (name ?? "").trim();
    const k = nameKey(n);
    if (!k || own.has(k)) return;
    own.set(k, { value: n, id: null, state: null, ceebCode });
  };
  for (const a of athletes) addOwn(detailHighSchool(a.detail));
  for (const c of (courseRows ?? []) as { school_name: string | null }[]) addOwn(c.school_name);
  for (const s of (scaleRows ?? []) as { school_name: string | null }[]) addOwn(s.school_name);
  for (const l of (listRows ?? []) as { school_name: string | null; ceeb_code: string | null }[]) addOwn(l.school_name, l.ceeb_code?.trim() || null);

  const fromDirectory: HighSchoolOption[] = directory.map((r) => ({
    value: r.name,
    label: place(r.city, r.state),
    id: r.id,
    state: r.state,
    ceebCode: r.ceeb_code,
  }));
  const directoryKeys = new Set(fromDirectory.map((o) => nameKey(o.value)));
  const ownOnly = [...own.values()].filter((o) => !directoryKeys.has(nameKey(o.value))).sort((a, b) => a.value.localeCompare(b.value));

  return [...ownOnly, ...fromDirectory].slice(0, MAX_OPTIONS);
}

// The one directory row a typed high school name means, or null. When
// the name is in several states, the athlete's home state decides; when
// it is still more than one (the same name in two towns), nothing is
// picked and the name alone is stored.
export async function resolveHighSchool(supabase: Client, name: string, homeState?: string | null): Promise<{ id: string; state: string | null; ceeb_code: string | null } | null> {
  const key = nameKey(name);
  if (!key) return null;
  const { data } = await supabase.from("high_schools").select("id, name, city, state, ceeb_code").eq("name_key", key).limit(50);
  const hit = pickUnique((data ?? []) as HighSchoolRow[], name, homeState);
  return hit ? { id: hit.id, state: hit.state, ceeb_code: hit.ceeb_code } : null;
}

interface CollegeRow {
  id: string;
  name: string;
  division: string | null;
  conference: string | null;
  state: string | null;
}

function collegeOption(r: CollegeRow): CollegeOption {
  return {
    value: r.name,
    label: [r.division, r.conference].filter(Boolean).join(", ") || undefined,
    id: r.id,
    division: r.division,
    conference: r.conference,
    state: r.state,
  };
}

// Every college on file, A to Z.
export async function loadCollegeOptions(supabase: Client): Promise<CollegeOption[]> {
  const { data } = await supabase.from("schools").select(DIRECTORY_COLUMNS).order("name", { ascending: true }).limit(MAX_OPTIONS);
  return ((data ?? []) as CollegeRow[]).map(collegeOption);
}

// The one college a typed name means. The ilike is escaped so a % or _
// in a name is literal, then only an exact key match counts: ilike
// alone would also match a name that differs only in inner spacing.
export async function resolveCollege(supabase: Client, name: string): Promise<CollegeOption | null> {
  const typed = name.trim();
  if (!typed) return null;
  const { data } = await supabase.from("schools").select(DIRECTORY_COLUMNS).ilike("name", escapeIlike(typed)).limit(50);
  const hit = pickUnique((data ?? []) as CollegeRow[], typed);
  return hit ? collegeOption(hit) : null;
}

// Coaches at the given colleges, keyed by college id, A to Z by name.
export async function loadCoachOptions(supabase: Client, schoolIds: readonly string[]): Promise<Record<string, CoachOption[]>> {
  const ids = [...new Set(schoolIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data } = await supabase.from("college_coaches").select("id, school_id, name, title, email, phone").in("school_id", ids);
  const out: Record<string, CoachOption[]> = {};
  for (const r of (data ?? []) as { id: string; school_id: string; name: string; title: string | null; email: string | null; phone: string | null }[]) {
    (out[r.school_id] ??= []).push({
      value: r.name,
      label: r.title?.trim() || undefined,
      id: r.id,
      schoolId: r.school_id,
      email: r.email?.trim() || null,
      phone: r.phone?.trim() || null,
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.value.localeCompare(b.value));
  return out;
}

// The coach at a college whose name matches what was typed, or null.
export function matchCoach(options: readonly CoachOption[] | undefined, name: string): CoachOption | null {
  const key = nameKey(name);
  if (!key || !options) return null;
  const same = options.filter((o) => nameKey(o.value) === key);
  return same.length === 1 ? same[0] : null;
}

// The events and places this org has logged metrics at before
// ("Fall Showcase", "PBR Connecticut"), most used first.
export async function loadPastSourceDetails(supabase: Client, orgId: string): Promise<string[]> {
  const { data } = await supabase.from("athlete_metrics").select("source_detail").eq("org_id", orgId);
  const counts = new Map<string, { value: string; n: number }>();
  for (const r of (data ?? []) as { source_detail: string | null }[]) {
    const v = (r.source_detail ?? "").trim();
    const k = nameKey(v);
    if (!k) continue;
    const hit = counts.get(k);
    if (hit) hit.n++;
    else counts.set(k, { value: v, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.value.localeCompare(b.value)).map((c) => c.value).slice(0, MAX_OPTIONS);
}
