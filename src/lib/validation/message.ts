import { z } from "zod";

// One message on an athlete's thread (migration 0039). Written by staff
// or by that athlete's family; the database caps the body at 4,000
// characters and this says so before it gets there.

export const messageSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(4000, "Keep it under 4,000 characters."),
});

export type MessageFormValues = z.infer<typeof messageSchema>;

export interface MessageFormResult {
  ok: boolean;
  values: MessageFormValues | null;
  errors: Record<string, string>;
}

export function parseMessageForm(formData: FormData): MessageFormResult {
  const input = { body: String(formData.get("body") ?? "") };
  const result = messageSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
