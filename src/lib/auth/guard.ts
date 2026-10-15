import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { getViewAs } from "@/lib/data/viewAs";

// Role names are generic on purpose. What a screen calls each one is
// fixed (src/lib/org/roleLabels.ts): owner is Admin, member is Viewer,
// family is Athlete, and what a person is called beyond that is their
// own Title (org_members.title, migration 0041), never a second role
// system. staff is retired (0041 moved every staff row to owner) but
// stays in the enum and in STAFF_ROLES so a leftover row still works.
// Mirrors the org_role enum in migrations/0001_core_schema.sql plus 0022.
//
// The first three read the whole org. `family` reads one athlete: the
// ones linked to them in athlete_guardians (migration 0023), and nothing
// else. The database enforces that; these lists are what the screens
// check before they even ask.
export type OrgRole = "owner" | "staff" | "member" | "family";

export const STAFF_ROLES: OrgRole[] = ["owner", "staff"];
export const OWNER_ROLES: OrgRole[] = ["owner"];
// Everyone who sees the org as a whole. Every org screen that is not
// written for a family checks this list, so a family member who types
// the URL of the roster lands on Not Authorized rather than on an empty
// roster.
// The roles that open the org's own screens. A member (Bridge: Board)
// has their own version under /member since 2026-09-21 and opens none
// of these; a family has theirs under /family.
export const ORG_WIDE_ROLES: OrgRole[] = ["owner", "staff"];
export const MEMBER_ROLES: OrgRole[] = ["member"];
export const FAMILY_ROLES: OrgRole[] = ["family"];

// Set while an Admin is viewing as someone else (migration 0047, Phase 5
// of docs/PLAN_STAGE5.md): the person, and when it ends. The CurrentUser
// it rides on is THAT person, seat and all, so every screen and every
// role check answers for them; the Admin behind the glass is only ever
// the caller of start and end.
export interface ViewingAs {
  sessionId: string;
  // The real Admin.
  viewerId: string;
  name: string;
  role: OrgRole;
  // Admin, Viewer or Athlete.
  roleLabel: string;
  expiresAt: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  org_id: string;
  role: OrgRole;
  // null unless this is a View As, in which case every other field is the
  // person being viewed. Nothing is written while it is set.
  viewingAs: ViewingAs | null;
}

// A signed-in person can belong to more than one org (a coach at Elite Squad
// who also volunteers for Bridge, say). activeOrgId narrows to the org they
// are currently working in; it comes from the session, not guessed.
//
// Identity comes from the session, and from one database row bound to it:
// a live view_as_sessions row (src/lib/data/viewAs.ts) makes the seat that
// is read the target's, exactly as the database makes every policy answer
// for the target. The database limits a session to the org it was started
// in, so in any other org there is nobody to be, and the answer is null.
export const getCurrentUser = cache(async function getCurrentUser(activeOrgId: string): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return null;

  const viewing = await getViewAs();
  if (viewing && viewing.orgId !== activeOrgId) return null;

  const { data, error } = await supabase
    .from("org_members")
    .select("user_id, org_id, role, users(email, full_name)")
    .eq("user_id", viewing ? viewing.targetId : user.id)
    .eq("org_id", activeOrgId)
    .single();

  if (error || !data) return null;

  // users() comes back as an array from the join; single-owner FK makes it one row.
  const userRow = Array.isArray(data.users) ? data.users[0] : data.users;

  return {
    id: data.user_id,
    org_id: data.org_id,
    role: data.role as OrgRole,
    email: userRow?.email ?? "",
    full_name: userRow?.full_name ?? "",
    viewingAs: viewing ? { sessionId: viewing.sessionId, viewerId: viewing.viewerId, name: viewing.name, role: viewing.role, roleLabel: viewing.roleLabel, expiresAt: viewing.expiresAt } : null,
  };
});

// Nobody to be here. Signed out goes to sign in; a View As that has no
// seat in this org (the org is not the one being viewed) goes to Not
// Authorized, which carries the Return control, because a sign-in screen
// would strand an Admin who is already signed in.
async function noOneHere(): Promise<never> {
  if (await getViewAs()) redirect("/unauthorized");
  redirect("/login");
}

export async function requireRole(
  activeOrgId: string,
  allowed: OrgRole[] = STAFF_ROLES
): Promise<CurrentUser> {
  const user = await getCurrentUser(activeOrgId);
  if (!user) {
    return noOneHere();
  }
  if (!allowed.includes(user.role)) {
    redirect("/unauthorized");
  }
  return user;
}

export async function requireOwner(activeOrgId: string): Promise<CurrentUser> {
  return requireRole(activeOrgId, OWNER_ROLES);
}

// The shared directory (schools, college coaches, transfer windows) is
// read by every org, so a write to it is a write for everybody. Owning
// an org is not enough: the org must also be one whose
// orgs.edits_shared_directory is on (migration 0040). Only create_org's
// first org on a fresh install gets it; any other is set by hand.
//
// The flag is read through the caller's own session, where RLS shows
// an org to its members only. A missing row or a missing column reads
// as off, so the door fails closed.
export async function orgEditsSharedDirectory(orgId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").select("edits_shared_directory").eq("id", orgId).maybeSingle();
  if (error || !data) return false;
  return (data as { edits_shared_directory?: unknown }).edits_shared_directory === true;
}

// For a screen deciding whether to show Add, Edit, Merge or Remove on
// the shared directory. Everyone else keeps read access.
export async function isDirectoryEditor(user: Pick<CurrentUser, "org_id" | "role">): Promise<boolean> {
  return user.role === "owner" && (await orgEditsSharedDirectory(user.org_id));
}

// Every service-role write to schools, college_coaches and
// transfer_windows starts here. The admin client bypasses RLS, so this
// is the whole authorization for those writes: an owner of this org,
// and the org edits the shared directory. Anyone else lands on Not
// Authorized before the admin client is created.
export async function requireDirectoryEditor(activeOrgId: string): Promise<CurrentUser> {
  const user = await requireOwner(activeOrgId);
  if (!(await orgEditsSharedDirectory(activeOrgId))) redirect("/unauthorized");
  return user;
}

// Where one athlete's screens live for this role. Staff open an athlete
// under the roster; a family opens the same screens under /family, with
// the family tab bar and no way into the rest of the org. The
// eligibility, transcript and metrics pages serve both and build their
// links from this.
export function athleteHome(slug: string, athleteId: string, role: OrgRole): string {
  return `/org/${slug}/${role === "family" ? "family" : "roster"}/${athleteId}`;
}

// The member screens are for the member role only: a board member's
// version of the app (Dave's picks, 2026-09-21). Staff have the whole
// org; a family has their athlete.
export async function requireMember(activeOrgId: string): Promise<CurrentUser> {
  const user = await getCurrentUser(activeOrgId);
  if (!user) return noOneHere();
  if (user.role !== "member") redirect("/unauthorized");
  return user;
}

// Where a role lands after signing in to an org.
export function homeFor(slug: string, role: OrgRole): string {
  if (role === "family") return `/org/${slug}/family`;
  if (role === "member") return `/org/${slug}/member`;
  return `/org/${slug}`;
}
