// View As, the app's half (migration 0047, docs/PLAN_STAGE5.md Phase 5).
//
// An Admin sees exactly what an Athlete login, a Viewer or another Admin
// sees, read only, for at most 30 minutes. The switch is a row in
// view_as_sessions that only start_view_as and end_view_as write; while
// it is live the database answers every policy and every helper for the
// person being viewed, on the Admin's own token, and refuses every
// write. This file is the app reading that row so its own screens agree
// with the database: the guard reads the target's seat, the banner names
// the person, and every server action asks isViewing() before it does
// anything, because the service role bypasses row level security and no
// policy stands in front of it.
//
// Nothing here mints a token, and nothing reads on anyone's behalf: the
// row is read through the caller's own client, and the row policy shows
// an Admin their own sessions and nobody else's.
//
// The rule for "live" is the SQL's (private._view_target()): not ended,
// not past expires_at, the viewer still an owner of the org, the target
// still a member of it. An expired row nobody has closed yet keeps
// ended_at null until the next start or end, so the clock is applied
// here, in code, exactly as the database applies it.

import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { labelForRole } from "@/lib/org/roleLabels";
import type { OrgRole } from "@/lib/auth/guard";

// The longest a session lasts. The database holds the same number
// (migration 0047, the coherence trigger); this one is for the words on
// the banner and the screen that starts one.
export const VIEW_AS_MINUTES = 30;

export interface ViewAs {
  sessionId: string;
  orgId: string;
  orgSlug: string;
  // The real Admin, who never stopped being the caller.
  viewerId: string;
  // Whose eyes the app and the database are using.
  targetId: string;
  // The target's full name, else their email, else a plain stand-in.
  name: string;
  role: OrgRole;
  // Admin, Viewer or Athlete (src/lib/org/roleLabels.ts).
  roleLabel: string;
  expiresAt: string;
}

// Whole minutes left, never less than one while the session is live, so
// the banner never says "0 minutes" on a session that still works.
export function minutesLeft(expiresAt: string, now: number = Date.now()): number {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms)) return 0;
  return Math.max(1, Math.ceil(ms / 60_000));
}

// A table that is not there means migration 0047 has not run in this
// database, which means no View As can exist in it: not viewing. Any
// other failure is not an answer, and the caller must not guess "not
// viewing" from it: the service role would then write for a person who is
// in fact looking through someone else's eyes. So it throws.
const NO_TABLE = new Set(["42P01", "PGRST205"]);

interface SessionRow {
  id: string;
  org_id: string;
  viewer_id: string;
  target_id: string;
  expires_at: string;
}

interface SeatRow {
  user_id: string;
  role: string;
  users: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
  orgs: { slug: string } | { slug: string }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// The caller's live View As, or null. Read through the caller's own
// client: the row policy answers an Admin with their own sessions and
// anyone else with nothing.
export const getViewAs = cache(async function getViewAs(): Promise<ViewAs | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("view_as_sessions")
    .select("id, org_id, viewer_id, target_id, expires_at")
    .eq("viewer_id", user.id)
    .is("ended_at", null);
  if (error) {
    if (NO_TABLE.has(String((error as { code?: string }).code ?? ""))) return null;
    throw new Error(`Could not tell whether a View As is open: ${error.message}`);
  }
  const now = Date.now();
  const session = ((rows ?? []) as SessionRow[]).find((r) => Date.parse(r.expires_at) > now);
  if (!session) return null;

  // The viewer must still be an owner of the org and the target still a
  // member of it, or the database has already stopped applying the row.
  const { data: seats, error: seatError } = await supabase
    .from("org_members")
    .select("user_id, role, users(email, full_name), orgs(slug)")
    .eq("org_id", session.org_id)
    .in("user_id", [session.viewer_id, session.target_id]);
  if (seatError) throw new Error(`Could not read who a View As is showing: ${seatError.message}`);
  const list = (seats ?? []) as SeatRow[];
  const viewerSeat = list.find((s) => s.user_id === session.viewer_id);
  const targetSeat = list.find((s) => s.user_id === session.target_id);
  if (!viewerSeat || viewerSeat.role !== "owner" || !targetSeat) return null;

  const person = unwrap(targetSeat.users);
  const org = unwrap(targetSeat.orgs) ?? unwrap(viewerSeat.orgs);
  if (!org) return null;
  const role = targetSeat.role as OrgRole;
  return {
    sessionId: session.id,
    orgId: session.org_id,
    orgSlug: org.slug,
    viewerId: session.viewer_id,
    targetId: session.target_id,
    name: person?.full_name?.trim() || person?.email?.trim() || "Someone",
    role,
    roleLabel: labelForRole(role),
    expiresAt: session.expires_at,
  };
});

export async function isViewing(): Promise<boolean> {
  return (await getViewAs()) !== null;
}

// The sentence for a refused write.
export function readOnlyMessage(v: Pick<ViewAs, "name">): string {
  return `Read only while viewing as ${v.name}. Return to Admin to make changes.`;
}

// Where a refused write sends the person: the page they were on, with the
// refusal in its address like every other action's error, or the start
// when the request says nothing of where they were. Only the path is
// taken from the Referer header, and only a path inside the app, so the
// header can never send anyone elsewhere.
async function backWithError(message: string): Promise<string> {
  let path = "/";
  try {
    const ref = (await headers()).get("referer");
    if (ref) {
      const p = new URL(ref).pathname;
      if (p === "/" || p.startsWith("/org/")) path = p;
    }
  } catch {
    // No request in scope (a build-time render, a test): the start.
  }
  return `${path}?error=${encodeURIComponent(message)}`;
}

// The first line of every server action that changes anything. While an
// Admin is viewing as someone, no write is made in their name and none is
// made in the target's: the database refuses the ones that go through
// the caller's own client, and this refuses the ones it cannot see, the
// service role's above all. Redirects back with the refusal; returns
// quietly when nobody is viewing. Throws, and so refuses too, when it
// cannot tell (getViewAs).
export async function requireNotViewing(): Promise<void> {
  const v = await getViewAs();
  if (!v) return;
  redirect(await backWithError(readOnlyMessage(v)));
}
