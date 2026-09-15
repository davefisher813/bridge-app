import { z } from "zod";

// recruiting_targets.status per migrations/0001_core_schema.sql's inline
// comment; mirrors STATUS_ORDER in board/page.tsx. Kept here as the
// single source so the form's <select> and the board's grouping order
// can't drift apart silently.
export const TARGET_STATUSES = ["Target", "In Contact", "Visit", "Offer", "Committed", "Not Interested"] as const;

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

export const targetBaseSchema = z.object({
  athleteId: z.string().uuid("Pick an athlete"),
  schoolId: z.string().uuid("Pick a school"),
  status: z.enum(TARGET_STATUSES).default("Target"),
  coachName: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  visitDate: z.string().date().optional(),
});

export type TargetFormValues = z.infer<typeof targetBaseSchema>;

export interface TargetFormResult {
  ok: boolean;
  values: TargetFormValues | null;
  errors: Record<string, string>;
}

export function parseTargetForm(formData: FormData): TargetFormResult {
  const input = {
    athleteId: String(formData.get("athleteId") ?? ""),
    schoolId: String(formData.get("schoolId") ?? ""),
    status: String(formData.get("status") ?? "Target"),
    coachName: strOrUndef(formData.get("coachName")),
    notes: strOrUndef(formData.get("notes")),
    visitDate: strOrUndef(formData.get("visitDate")),
  };

  const result = targetBaseSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
