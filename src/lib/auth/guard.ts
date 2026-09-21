import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Role names are generic on purpose: the label shown to a person (Coordinator,
// Coach, Board) is org-level config (see orgs.role_labels), not a second
// role system. Underneath there are exactly four tiers. Mirrors the
// org_role enum in migrations/0001_core_schema.sql plus 0022.
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

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  org_id: string;
  role: OrgRole;
}

// A signed-in person can belong to more than one org (a coach at Elite Squad
// who also volunteers for Bridge, say). activeOrgId narrows to the org they
// are currently working in; it comes from the session, not guessed.
// The auth check is a network call to Supabase Auth, not a cookie read,
// and it used to run once per lookup. Once per request now.
const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getCurrentUser = cache(async function getCurrentUser(activeOrgId: string): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("org_members")
    .select("user_id, org_id, role, users(email, full_name)")
    .eq("user_id", user.id)
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
  };
});

export async function requireRole(
  activeOrgId: string,
  allowed: OrgRole[] = STAFF_ROLES
): Promise<CurrentUser> {
  const user = await getCurrentUser(activeOrgId);
  if (!user) {
    redirect("/login");
  }
  if (!allowed.includes(user.role)) {
    redirect("/unauthorized");
  }
  return user;
}

export async function requireOwner(activeOrgId: string): Promise<CurrentUser> {
  return requireRole(activeOrgId, OWNER_ROLES);
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
  if (!user) redirect("/login");
  if (user.role !== "member") redirect("/unauthorized");
  return user;
}

// Where a role lands after signing in to an org.
export function homeFor(slug: string, role: OrgRole): string {
  if (role === "family") return `/org/${slug}/family`;
  if (role === "member") return `/org/${slug}/member`;
  return `/org/${slug}`;
}
