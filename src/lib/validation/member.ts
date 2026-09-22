import { z } from "zod";
import type { OrgRole } from "@/lib/auth/guard";

// Mirrors org_role in migrations/0001_core_schema.sql plus 0022. What
// each one is CALLED is the org's own config (orgs.role_labels); this is
// the enum.
export const ORG_ROLES = ["owner", "staff", "member", "family"] as const satisfies readonly OrgRole[];

// A family invite is an email AND an athlete: the membership row alone
// shows them nothing (see migrations/0023_athlete_guardians.sql), so an
// invite without the athlete would be a login to an empty screen.
const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Not a valid email"),
    role: z.enum(ORG_ROLES, { message: "Pick a role" }),
    fullName: z.string().trim().max(120).optional(),
    athleteId: z.string().uuid().optional(),
    // Parent, guardian, self. Display only, on the family's rows.
    relationship: z.string().trim().max(60).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === "family" && !v.athleteId) {
      ctx.addIssue({ code: "custom", path: ["athleteId"], message: "Pick the athlete this person belongs to" });
    }
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
    athleteId: String(formData.get("athleteId") ?? "").trim() || undefined,
    relationship: String(formData.get("relationship") ?? "").trim() || undefined,
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
