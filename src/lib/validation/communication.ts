import { z } from "zod";

// Mirrors target_communication_kind in migrations/0004_target_communications.sql.
export const COMMUNICATION_KINDS = ["call", "text", "email", "visit", "other"] as const;

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

export const communicationBaseSchema = z.object({
  kind: z.enum(COMMUNICATION_KINDS),
  occurredOn: z.string().date().optional(),
  notes: z.string().trim().optional(),
});

export type CommunicationFormValues = z.infer<typeof communicationBaseSchema>;

export interface CommunicationFormResult {
  ok: boolean;
  values: CommunicationFormValues | null;
  errors: Record<string, string>;
}

export function parseCommunicationForm(formData: FormData): CommunicationFormResult {
  const input = {
    kind: String(formData.get("kind") ?? ""),
    occurredOn: strOrUndef(formData.get("occurredOn")),
    notes: strOrUndef(formData.get("notes")),
  };
  const result = communicationBaseSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
