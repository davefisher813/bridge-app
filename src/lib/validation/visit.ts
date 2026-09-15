import { z } from "zod";

// Mirrors target_visit_type in migrations/0006_contacts_and_target_visits.sql.
export const VISIT_TYPES = ["official", "unofficial", "junior_day", "camp", "other"] as const;

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

export const visitBaseSchema = z.object({
  visitType: z.enum(VISIT_TYPES),
  visitDate: z.string().date().optional(),
  impression: z.string().trim().optional(),
  nextStep: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export type VisitFormValues = z.infer<typeof visitBaseSchema>;

export interface VisitFormResult {
  ok: boolean;
  values: VisitFormValues | null;
  errors: Record<string, string>;
}

export function parseVisitForm(formData: FormData): VisitFormResult {
  const input = {
    visitType: String(formData.get("visitType") ?? ""),
    visitDate: strOrUndef(formData.get("visitDate")),
    impression: strOrUndef(formData.get("impression")),
    nextStep: strOrUndef(formData.get("nextStep")),
    notes: strOrUndef(formData.get("notes")),
  };

  const result = visitBaseSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
