import { z } from "zod";

// Mirrors contact_role in migrations/0006_contacts_and_target_visits.sql.
export const CONTACT_ROLES = ["hs_coach", "travel_coach", "parent_guardian", "advisor", "college_coach", "other"] as const;

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

export const contactBaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  role: z.enum(CONTACT_ROLES),
  schoolId: z.string().uuid().optional(),
  email: z.string().trim().email("Not a valid email").optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type ContactFormValues = z.infer<typeof contactBaseSchema>;

export interface ContactFormResult {
  ok: boolean;
  values: ContactFormValues | null;
  errors: Record<string, string>;
}

export function parseContactForm(formData: FormData): ContactFormResult {
  const input = {
    name: String(formData.get("name") ?? ""),
    role: String(formData.get("role") ?? ""),
    schoolId: strOrUndef(formData.get("schoolId")),
    email: strOrUndef(formData.get("email")) ?? "",
    phone: strOrUndef(formData.get("phone")),
    notes: strOrUndef(formData.get("notes")),
  };

  const result = contactBaseSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
