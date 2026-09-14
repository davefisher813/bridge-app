import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Role names are generic on purpose: the label shown to a person (Coordinator,
// Coach, Board) is org-level config (see org_settings.role_labels), not a
// second role system. Underneath there are always exactly three tiers.
// Mirrors user_role enum in migrations/0001_core_schema.sql.
export type OrgRole = "owner" | "staff" | "member";

export const STAFF_ROLES: OrgRole[] = ["owner", "staff"];
export const OWNER_ROLES: OrgRole[] = ["owner"];

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
export async function getCurrentUser(
  activeOrgId: string
): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
}

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
