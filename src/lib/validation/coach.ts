import { z } from "zod";

// One coach in the shared college directory (migration 0036). Owners
// add, correct and remove them (crud F2); the school they coach at is
// never typed, it is the school whose page the form sits on.

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v).trim());

export const coachSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Keep it under 120 characters"),
  title: z.string().trim().max(120, "Keep it under 120 characters").optional(),
  email: z.string().trim().email("That does not look like an email").max(200).optional(),
  phone: z
    .string()
    .trim()
    .max(40, "Keep it under 40 characters")
    .regex(/^[0-9+().\-\s x]+$/i, "Digits, spaces and + ( ) - only")
    .optional(),
  isRecruitingCoordinator: z.boolean(),
});

export type CoachValues = z.infer<typeof coachSchema>;

export interface CoachFormResult {
  ok: boolean;
  values: CoachValues | null;
  errors: Record<string, string>;
}

export function parseCoachForm(formData: FormData): CoachFormResult {
  const input = {
    name: String(formData.get("name") ?? ""),
    title: strOrUndef(formData.get("title")),
    email: strOrUndef(formData.get("email")),
    phone: strOrUndef(formData.get("phone")),
    isRecruitingCoordinator: formData.get("isRecruitingCoordinator") === "on",
  };
  const result = coachSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
