// Stored fits. docs/MATCHING_CONTRACT.md: "A match is stored, not
// recomputed on view." Every athlete by school score lives in
// athlete_school_fits with its dimensions, reasons, warnings, a hash of
// the inputs and a timestamp. It is recomputed here, inside the server
// action that changed an input, and screens read the rows.
//
// The engine (src/lib/fit/) is pure and cheap: fifty athletes by three
// hundred schools is fifteen thousand calls that finish in well under a
// second, so a recompute runs inline in the action rather than in a job.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreFit } from "@/lib/fit/score";
import type { Athlete, FitResult, KnownAid, School, TransferWindow } from "@/lib/fit/types";
import { DEFAULT_PRESET, type ScoringPreset } from "@/lib/fit/contract";
import {
  ATHLETE_FIT_COLUMNS,
  SCHOOL_FIT_COLUMNS,
  athleteRowToFitAthlete,
  noteRowToPositionalNeed,
  schoolRowToFitSchool,
  targetAidToKnownAid,
  transferWindowRowToFit,
  type AthleteRow,
  type MetricRow,
  type OrgSchoolNoteRow,
  type SchoolRow,
  type TransferWindowRow,
} from "@/lib/data/fitAdapters";

// Bumped when the engine's meaning changes so old rows recompute.
export const FIT_ENGINE_VERSION = 2;

// Any client: the user's (RLS-scoped) for one org, the admin client for
// a shared school across every org.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface FitRow {
  id?: string;
  org_id: string;
  athlete_id: string;
  school_id: string;
  score: number;
  tag: string;
  partial: boolean;
  dimensions: Record<string, unknown>;
  reasons: string[];
  warnings: string[];
  inputs_hash: string;
  computed_at: string;
}

// FNV-1a over a stable JSON string. Not security; just "did an input
// change", so a recompute that would write the same row can skip it.
export function inputsHash(value: unknown): string {
  const s = JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v${FIT_ENGINE_VERSION}-${h.toString(16)}`;
}

export function fitToRow(orgId: string, athlete: Athlete, school: School, fit: FitResult, hash: string, now = new Date()): FitRow {
  return {
    org_id: orgId,
    athlete_id: athlete.id,
    school_id: school.id,
    score: fit.score,
    tag: fit.tag,
    partial: fit.partial,
    dimensions: {
      academic: fit.academic,
      athletic: fit.athletic,
      financial: fit.financial,
      ...(fit.eligibility ? { eligibility: fit.eligibility } : {}),
      counted: fit.counted,
    },
    reasons: fit.reasons,
    warnings: fit.warnings,
    inputs_hash: hash,
    computed_at: now.toISOString(),
  };
}

// A stored row back into the shape the screens already render.
export function rowToFit(row: FitRow): FitResult {
  const d = (row.dimensions ?? {}) as Record<string, FitResult["academic"] | string[] | undefined>;
  const dim = (k: string): FitResult["academic"] => (d[k] as FitResult["academic"]) ?? { score: 50, confidence: "unknown", veto: false, reasons: [], warnings: [] };
  return {
    tag: row.tag as FitResult["tag"],
    score: row.score,
    academic: dim("academic"),
    athletic: dim("athletic"),
    financial: dim("financial"),
    eligibility: d.eligibility ? (d.eligibility as FitResult["academic"]) : undefined,
    reasons: row.reasons ?? [],
    warnings: row.warnings ?? [],
    partial: row.partial,
    counted: (d.counted as string[]) ?? [],
  };
}

interface OrgContext {
  orgId: string;
  preset: ScoringPreset;
  windows: TransferWindow[];
  needBySchool: Map<string, ReturnType<typeof noteRowToPositionalNeed>>;
  targetStatusByPair: Map<string, string>;
  // An applied award letter per athlete and school pair.
  aidByPair: Map<string, KnownAid>;
}

async function loadOrgContext(client: Client, orgId: string): Promise<OrgContext> {
  const [{ data: org }, { data: windowRows }, { data: noteRows }, { data: targetRows }] = await Promise.all([
    client.from("orgs").select("scoring_preset").eq("id", orgId).maybeSingle(),
    client.from("transfer_windows").select("sport, division, season_year, window_label, opens_on, closes_on"),
    client.from("org_school_notes").select("school_id, coach_name, coach_email, positions_of_need, notes").eq("org_id", orgId),
    client.from("recruiting_targets").select("athlete_id, school_id, status, aid").eq("org_id", orgId),
  ]);
  const needBySchool = new Map<string, ReturnType<typeof noteRowToPositionalNeed>>();
  for (const n of (noteRows ?? []) as OrgSchoolNoteRow[]) needBySchool.set(n.school_id, noteRowToPositionalNeed(n));
  const targetStatusByPair = new Map<string, string>();
  const aidByPair = new Map<string, KnownAid>();
  for (const t of (targetRows ?? []) as { athlete_id: string; school_id: string; status: string; aid?: unknown }[]) {
    targetStatusByPair.set(`${t.athlete_id}:${t.school_id}`, t.status);
    const aid = targetAidToKnownAid(t.aid);
    if (aid) aidByPair.set(`${t.athlete_id}:${t.school_id}`, aid);
  }
  const preset = ((org as { scoring_preset?: string } | null)?.scoring_preset ?? DEFAULT_PRESET) as ScoringPreset;
  return { orgId, preset, windows: ((windowRows ?? []) as TransferWindowRow[]).map(transferWindowRowToFit), needBySchool, targetStatusByPair, aidByPair };
}

async function loadAthletes(client: Client, orgId: string, athleteId?: string): Promise<Athlete[]> {
  let q = client.from("athletes").select(ATHLETE_FIT_COLUMNS).eq("org_id", orgId).is("deleted_at", null);
  if (athleteId) q = q.eq("id", athleteId);
  const { data: rows } = await q;
  const ids = ((rows ?? []) as AthleteRow[]).map((r) => r.id);
  if (ids.length === 0) return [];
  const { data: metricRows } = await client.from("athlete_metrics").select("id, athlete_id, metric, value, measured_on, source").in("athlete_id", ids);
  const byAthlete = new Map<string, MetricRow[]>();
  for (const m of (metricRows ?? []) as (MetricRow & { athlete_id: string })[]) {
    const list = byAthlete.get(m.athlete_id) ?? [];
    list.push(m);
    byAthlete.set(m.athlete_id, list);
  }
  return ((rows ?? []) as AthleteRow[]).map((r) => athleteRowToFitAthlete(r, byAthlete.get(r.id) ?? []));
}

async function loadSchools(client: Client, schoolId?: string): Promise<School[]> {
  let q = client.from("schools").select(SCHOOL_FIT_COLUMNS);
  if (schoolId) q = q.eq("id", schoolId);
  const { data: rows } = await q;
  return ((rows ?? []) as SchoolRow[]).map(schoolRowToFitSchool);
}

function computeRows(ctx: OrgContext, athletes: Athlete[], schools: School[], now: Date): FitRow[] {
  const out: FitRow[] = [];
  for (const athlete of athletes) {
    for (const school of schools) {
      const positionalNeed = ctx.needBySchool.get(school.id) ?? [];
      const status = ctx.targetStatusByPair.get(`${athlete.id}:${school.id}`);
      const aid = ctx.aidByPair.get(`${athlete.id}:${school.id}`);
      const inputs = { athlete, school, positionalNeed, preset: ctx.preset, windows: ctx.windows, isPlaced: status === "Committed", aid };
      const fit = scoreFit(athlete, school, { preset: ctx.preset, positionalNeed, transferWindows: ctx.windows, isPlaced: status === "Committed", today: now, aid });
      out.push(fitToRow(ctx.orgId, athlete, school, fit, inputsHash(inputs), now));
    }
  }
  return out;
}

async function store(client: Client, rows: FitRow[]): Promise<{ error: string | null }> {
  if (rows.length === 0) return { error: null };
  // Batches, so a big import never sends one giant statement.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client.from("athlete_school_fits").upsert(rows.slice(i, i + 500), { onConflict: "athlete_id,school_id" });
    if (error) return { error: error.message };
  }
  return { error: null };
}

// One athlete against every school. After an athlete's profile, goal,
// budget, grades or a metric changes.
export async function recomputeFitsForAthlete(client: Client, orgId: string, athleteId: string, now = new Date()): Promise<{ error: string | null; count: number }> {
  const [ctx, athletes, schools] = await Promise.all([loadOrgContext(client, orgId), loadAthletes(client, orgId, athleteId), loadSchools(client)]);
  const rows = computeRows(ctx, athletes, schools, now);
  const { error } = await store(client, rows);
  return { error, count: rows.length };
}

// Every athlete in one org against every school. After the org's preset
// changes, on Recalculate All, and after an import for the importing org.
export async function recomputeFitsForOrg(client: Client, orgId: string, now = new Date()): Promise<{ error: string | null; count: number }> {
  const [ctx, athletes, schools] = await Promise.all([loadOrgContext(client, orgId), loadAthletes(client, orgId), loadSchools(client)]);
  const rows = computeRows(ctx, athletes, schools, now);
  const { error } = await store(client, rows);
  return { error, count: rows.length };
}

// Every athlete in one org against one school. After the org's overlay
// on that school changes (needs, notes).
export async function recomputeFitsForOrgSchool(client: Client, orgId: string, schoolId: string, now = new Date()): Promise<{ error: string | null; count: number }> {
  const [ctx, athletes, schools] = await Promise.all([loadOrgContext(client, orgId), loadAthletes(client, orgId), loadSchools(client, schoolId)]);
  const rows = computeRows(ctx, athletes, schools, now);
  const { error } = await store(client, rows);
  return { error, count: rows.length };
}

// Every athlete in every org against the given schools. After a shared
// school's facts change or an import lands. Needs the admin client,
// since one org's owner cannot write another org's rows.
export async function recomputeFitsForSchools(admin: Client, schoolIds: string[], now = new Date()): Promise<{ error: string | null; count: number }> {
  if (schoolIds.length === 0) return { error: null, count: 0 };
  const { data: orgRows } = await admin.from("orgs").select("id");
  let count = 0;
  for (const org of (orgRows ?? []) as { id: string }[]) {
    const [ctx, athletes, schoolsAll] = await Promise.all([loadOrgContext(admin, org.id), loadAthletes(admin, org.id), loadSchools(admin)]);
    const schools = schoolsAll.filter((s) => schoolIds.includes(s.id));
    const rows = computeRows(ctx, athletes, schools, now);
    const { error } = await store(admin, rows);
    if (error) return { error, count };
    count += rows.length;
  }
  return { error: null, count };
}

// Read side. Stored rows for one athlete, best first.
export async function loadFitsForAthlete(client: Client, orgId: string, athleteId: string): Promise<(FitRow & { school: { id: string; name: string; division: string; conference: string | null; state: string | null } })[]> {
  const { data } = await client
    .from("athlete_school_fits")
    .select("id, org_id, athlete_id, school_id, score, tag, partial, dimensions, reasons, warnings, inputs_hash, computed_at, schools(id, name, division, conference, state)")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .order("score", { ascending: false });
  return ((data ?? []) as (FitRow & { schools: unknown })[])
    .map((r) => {
      const s = Array.isArray(r.schools) ? r.schools[0] : r.schools;
      if (!s) return null;
      const { schools: _drop, ...rest } = r;
      void _drop;
      return { ...rest, school: s as { id: string; name: string; division: string; conference: string | null; state: string | null } };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

// Stored rows for a set of athlete and school pairs, for the board.
export async function loadFitsForPairs(client: Client, orgId: string, pairs: { athleteId: string; schoolId: string }[]): Promise<Map<string, FitRow>> {
  const out = new Map<string, FitRow>();
  const athleteIds = [...new Set(pairs.map((p) => p.athleteId))];
  if (athleteIds.length === 0) return out;
  const { data } = await client
    .from("athlete_school_fits")
    .select("id, org_id, athlete_id, school_id, score, tag, partial, dimensions, reasons, warnings, inputs_hash, computed_at")
    .eq("org_id", orgId)
    .in("athlete_id", athleteIds);
  for (const r of (data ?? []) as FitRow[]) out.set(`${r.athlete_id}:${r.school_id}`, r);
  return out;
}
