import { z } from "zod";
import { CHECKIN_KINDS } from "@/lib/checkins";

// A check-in an advisor logs on an athlete (migration 0039). Staff only:
// the family never reads the log or its notes.

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v));

export const checkinSchema = z.object({
  kind: z.enum(CHECKIN_KINDS, { errorMap: () => ({ message: "Pick call, meeting, text or other." }) }),
  // Not ahead of today (one day of slack for the UTC date the form
  // defaults to). A typo like 2062 would otherwise keep the athlete off
  // every reminder for decades, since the gap would read as zero days.
  occurredOn: z
    .string()
    .date("Pick the date it happened.")
    .refine((d) => d <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), "That date hasn't happened yet.")
    .optional(),
  notes: z.string().trim().max(2000, "Keep notes under 2,000 characters.").optional(),
});

export type CheckinFormValues = z.infer<typeof checkinSchema>;

export interface CheckinFormResult {
  ok: boolean;
  values: CheckinFormValues | null;
  errors: Record<string, string>;
}

export function parseCheckinForm(formData: FormData): CheckinFormResult {
  const input = {
    kind: String(formData.get("kind") ?? ""),
    occurredOn: strOrUndef(formData.get("occurredOn")),
    notes: strOrUndef(formData.get("notes")),
  };
  const result = checkinSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
