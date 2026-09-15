import { z } from "zod";

// Mirrors the division comment on migrations/0001_core_schema.sql's schools table.
export const SCHOOL_DIVISIONS = ["D1", "D2", "D3", "NAIA", "JUCO D1", "JUCO D2", "JUCO D3", "Prep School"] as const;

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

export const schoolBaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  division: z.enum(SCHOOL_DIVISIONS),
  conference: z.string().trim().optional(),
  sportsSponsored: z.string().trim().optional(),
});

export type SchoolFormValues = z.infer<typeof schoolBaseSchema>;

export interface SchoolFormResult {
  ok: boolean;
  values: SchoolFormValues | null;
  errors: Record<string, string>;
}

export function parseSchoolForm(formData: FormData): SchoolFormResult {
  const input = {
    name: String(formData.get("name") ?? ""),
    division: String(formData.get("division") ?? ""),
    conference: strOrUndef(formData.get("conference")),
    sportsSponsored: strOrUndef(formData.get("sportsSponsored")),
  };

  const result = schoolBaseSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}

// "baseball, softball" -> ["baseball", "softball"]. Empty/whitespace-only
// input becomes an empty array, matching the column's own default.
export function parseSportsSponsored(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
