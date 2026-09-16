// Which orgs the signed-in person belongs to, and resolving a URL slug
// to an org. Both rely on RLS (org_members_self, orgs_by_membership) to
// do the actual access control - a slug for an org the caller isn't a
// member of resolves to "not found", not a permission error, because
// the row is invisible to them, not merely protected.

import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/auth/guard";
import { parseOrgModules, type OrgModules } from "@/lib/org/modules";
import { parseRoleLabels, type RoleLabels } from "@/lib/org/roleLabels";

export interface OrgMembership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: OrgRole;
}

export async function getOrgMemberships(): Promise<OrgMembership[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase.from("org_members").select("org_id, role, orgs(id, name, slug)").eq("user_id", user.id);

  if (error || !data) return [];

  return data
    .map((row) => {
      const org = Array.isArray(row.orgs) ? row.orgs[0] : row.orgs;
      if (!org) return null;
      return { orgId: row.org_id, orgName: org.name, orgSlug: org.slug, role: row.role as OrgRole };
    })
    .filter((m): m is OrgMembership => m !== null);
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  modules: OrgModules;
  // What this org calls its three roles. Bridge says Executive Director
  // and Coordinator; Elite Squad says Owner and Coach. The permission
  // enum stays generic either way.
  roleLabels: RoleLabels;
}

export async function getOrgBySlug(slug: string): Promise<OrgSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").select("id, name, slug, modules, role_labels").eq("slug", slug).single();
  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    modules: parseOrgModules(data.modules),
    roleLabels: parseRoleLabels(data.role_labels),
  };
}
