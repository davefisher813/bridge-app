// What a family login is allowed to look at, resolved once.
//
// A family member is an org_members row with role family plus one
// athlete_guardians row per athlete they may see. The database enforces
// that (migrations 0022 to 0024); these helpers are what the family
// screens call so a page cannot forget to ask, and so the fixture, which
// has no row level security, is held to the same line.

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/guard";

export interface FamilyAthlete {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  recruit_type: string;
  relationship: string | null;
}

interface GuardianRow {
  athlete_id: string;
  relationship: string | null;
  athletes:
    | { id: string; name: string; sport: string; position: string | null; recruit_type: string; deleted_at: string | null }
    | { id: string; name: string; sport: string; position: string | null; recruit_type: string; deleted_at: string | null }[]
    | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// The family screens are for the family role only. Staff have the same
// records under the roster, with more on them.
export async function requireFamily(orgId: string): Promise<CurrentUser> {
  const user = await getCurrentUser(orgId);
  if (!user) redirect("/login");
  if (user.role !== "family") redirect("/unauthorized");
  return user;
}

export async function loadFamilyAthletes(orgId: string, userId: string): Promise<FamilyAthlete[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("athlete_guardians")
    .select("athlete_id, relationship, athletes(id, name, sport, position, recruit_type, deleted_at)")
    .eq("org_id", orgId)
    .eq("user_id", userId);
  return ((data ?? []) as GuardianRow[])
    .map((g) => {
      const a = unwrap(g.athletes);
      if (!a || a.deleted_at) return null;
      return { id: a.id, name: a.name, sport: a.sport, position: a.position, recruit_type: a.recruit_type, relationship: g.relationship };
    })
    .filter((a): a is FamilyAthlete => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// One athlete, and only if this person is linked to them. Anything else
// is not found, the same answer the database gives.
export async function requireFamilyAthlete(orgId: string, userId: string, athleteId: string): Promise<{ athlete: FamilyAthlete; all: FamilyAthlete[] }> {
  const all = await loadFamilyAthletes(orgId, userId);
  const athlete = all.find((a) => a.id === athleteId);
  if (!athlete) notFound();
  return { athlete, all };
}

// For the athlete screens that serve staff and family alike: a family
// login must be linked to the athlete it is opening. Staff are already
// inside the org and the roster query answers for them.
export async function assertMayViewAthlete(orgId: string, user: CurrentUser, athleteId: string): Promise<void> {
  if (user.role !== "family") return;
  await requireFamilyAthlete(orgId, user.id, athleteId);
}
