import { z } from "zod";
import type { OrgRole } from "@/lib/auth/guard";

// Mirrors org_role in migrations/0001_core_schema.sql. What each one is
// CALLED is the org's own config (orgs.role_labels); this is the enum.
export const ORG_ROLES = ["owner", "staff", "member"] as const satisfies readonly OrgRole[];

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Not a valid email"),
  role: z.enum(ORG_ROLES, { message: "Pick a role" }),
  fullName: z.string().trim().max(120).optional(),
});

export type InviteFormValues = z.infer<typeof inviteSchema>;

export interface InviteFormResult {
  ok: boolean;
  values: InviteFormValues | null;
  errors: Record<string, string>;
}

export function parseInviteForm(formData: FormData): InviteFormResult {
  const raw = {
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? ""),
    fullName: String(formData.get("fullName") ?? "").trim() || undefined,
  };
  const result = inviteSchema.safeParse(raw);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}

export function parseRole(value: unknown): OrgRole | null {
  const r = z.enum(ORG_ROLES).safeParse(value);
  return r.success ? r.data : null;
}
