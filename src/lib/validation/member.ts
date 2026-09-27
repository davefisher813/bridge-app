import { z } from "zod";
import type { OrgRole } from "@/lib/auth/guard";
import { TITLE_MAX } from "@/lib/org/roleLabels";

// Mirrors org_role in migrations/0001_core_schema.sql plus 0022. What
// each one is called on screen is fixed in src/lib/org/roleLabels.ts.
export const ORG_ROLES = ["owner", "staff", "member", "family"] as const satisfies readonly OrgRole[];

// What an Admin can hand out: Admin, Viewer, Athlete, in that order.
// staff is retired (Dave, 2026-09-27; migration 0041 moved every staff
// row to owner), so no invite and no role change offers or accepts it.
export const ASSIGNABLE_ROLES = ["owner", "member", "family"] as const satisfies readonly OrgRole[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

// A family invite is an email AND an athlete: the membership row alone
// shows them nothing (see migrations/0023_athlete_guardians.sql), so an
// invite without the athlete would be a login to an empty screen.
const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Not a valid email"),
    role: z.enum(ASSIGNABLE_ROLES, { message: "Pick Admin, Viewer or Athlete" }),
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

// A role an Admin may assign, or null. 'staff' is null: it is retired.
export function parseRole(value: unknown): AssignableRole | null {
  const r = z.enum(ASSIGNABLE_ROLES).safeParse(value);
  return r.success ? r.data : null;
}

// A person's Title (org_members.title, migration 0041): display only.
// Blank clears it. The database holds the same 1 to 80 rule.
export function parseMemberTitle(value: unknown): { ok: true; title: string | null } | { ok: false; error: string } {
  const t = typeof value === "string" ? value.trim() : "";
  if (!t) return { ok: true, title: null };
  if (t.length > TITLE_MAX) return { ok: false, error: `Keep a Title to ${TITLE_MAX} characters.` };
  return { ok: true, title: t };
}
