// What an Athlete login reads of targets, visits and documents (migration
// 0063). Row-level security cannot hide a column, and those three tables
// carry staff-only ones: a target's notes and coach, a visit's notes, a
// document's reading (whose candidates name other athletes). So the
// family clause is off their read policies and an Athlete screen reads
// through these functions, which return only what the screen shows.
//
// The rows come back in the shape the screens already used, the school
// as an embedded object, so a page swaps its query and nothing else.
// Never select from recruiting_targets, target_visits or documents on a
// screen an Athlete login reaches: the law in src/laws/familyReadLaws
// walks the family screens for exactly that.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface FamilyTarget {
  id: string;
  athlete_id: string;
  school_id: string;
  status: string;
  offer_type: string | null;
  offer_scholarship_percent: number | null;
  closed_from: string | null;
  created_at: string;
  schools: { id: string; name: string; division: string; conference: string | null; state: string | null };
}

export interface FamilyVisit {
  id: string;
  target_id: string;
  visit_type: string;
  visit_date: string | null;
  impression: string | null;
  next_step: string | null;
}

export interface FamilyDocument {
  id: string;
  file_name: string;
  category: string | null;
  status: string;
  media_type: string;
  file_size: number;
  created_at: string;
}

interface TargetFnRow extends Omit<FamilyTarget, "schools"> {
  school_name: string;
  school_division: string;
  school_conference: string | null;
  school_state: string | null;
}

// Newest first, as the screens listed them.
export async function loadFamilyTargets(client: Client, orgId: string, athleteIds: string[]): Promise<FamilyTarget[]> {
  if (athleteIds.length === 0) return [];
  const { data } = await client.rpc("family_targets", { p_org: orgId, p_athletes: athleteIds });
  return ((data ?? []) as TargetFnRow[]).map(({ school_name, school_division, school_conference, school_state, ...t }) => ({
    ...t,
    schools: { id: t.school_id, name: school_name, division: school_division, conference: school_conference, state: school_state },
  }));
}

// Newest visit first.
export async function loadFamilyVisits(client: Client, orgId: string, targetIds: string[]): Promise<FamilyVisit[]> {
  if (targetIds.length === 0) return [];
  const { data } = await client.rpc("family_target_visits", { p_org: orgId, p_targets: targetIds });
  return (data ?? []) as FamilyVisit[];
}

// One athlete's documents, newest first.
export async function loadFamilyDocuments(client: Client, orgId: string, athleteId: string): Promise<FamilyDocument[]> {
  const { data } = await client.rpc("family_documents", { p_org: orgId, p_athlete: athleteId });
  return (data ?? []) as FamilyDocument[];
}

// The earlier copy of the same bytes, among the documents this login may
// see, or null.
export async function findFamilyTwin(client: Client, orgId: string, hash: string): Promise<{ id: string; file_name: string; created_at: string } | null> {
  const { data } = await client.rpc("family_document_twin", { p_org: orgId, p_hash: hash });
  return ((data ?? []) as { id: string; file_name: string; created_at: string }[])[0] ?? null;
}
