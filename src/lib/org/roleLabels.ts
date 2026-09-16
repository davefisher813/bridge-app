// What an org calls each of its three roles.
//
// `org_role` is deliberately generic (owner | staff | member) so the
// permission model stays one thing across every organization. What a
// person is CALLED is org config, and it differs: Bridge says Executive
// Director and Coordinator, Elite Squad says Owner and Coach. That
// separation has been in CLAUDE.md and in the schema since day one, and
// `orgs.role_labels` was never read anywhere, so every screen showed the
// generic word or nothing at all. Onboarding a second org is what
// surfaced it, which is the whole reason for onboarding a second org.
//
// Parsed the same way orgs.modules is: Postgres validates ownership,
// this validates shape.

import { z } from "zod";
import type { OrgRole } from "@/lib/auth/guard";

const roleLabelsSchema = z
  .object({
    owner: z.string().trim().min(1).catch(""),
    staff: z.string().trim().min(1).catch(""),
    member: z.string().trim().min(1).catch(""),
  })
  .partial()
  .catch({});

export type RoleLabels = z.infer<typeof roleLabelsSchema>;

// The fallback when an org has said nothing. Plain English rather than
// the enum value: "member" is a database word and "Owner" is not a title
// anybody would object to.
export const DEFAULT_ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  staff: "Staff",
  member: "Member",
};

export function parseRoleLabels(raw: unknown): RoleLabels {
  const parsed = roleLabelsSchema.parse(raw);
  // An empty string means the org supplied a blank, which is not a
  // label. Dropped here so callers only ever see a real one or nothing.
  const out: RoleLabels = {};
  for (const key of ["owner", "staff", "member"] as const) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}

export function labelForRole(labels: RoleLabels, role: OrgRole): string {
  return labels[role] ?? DEFAULT_ROLE_LABEL[role];
}
