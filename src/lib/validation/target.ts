import { z } from "zod";

// recruiting_targets.status per migrations/0001_core_schema.sql's inline
// comment; mirrors STATUS_ORDER in board/page.tsx. Kept here as the
// single source so the form's <select> and the board's grouping order
// can't drift apart silently.
export const TARGET_STATUSES = ["Target", "In Contact", "Visit", "Offer", "Committed", "Not Interested"] as const;

// Mirrors recruiting_offer_type in migrations/0005_recruiting_target_offer_fields.sql
// and RecruitingSignals["offer"]["offerType"] in src/lib/fit/types.ts.
export const OFFER_TYPES = ["scholarship", "written", "verbal", "preferred_walk_on", "admission_only", "walk_on"] as const;

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));
const numOrUndef = (v: FormDataEntryValue | null) => {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

export const targetBaseSchema = z
  .object({
    athleteId: z.string().uuid("Pick an athlete"),
    schoolId: z.string().uuid("Pick a school"),
    status: z.enum(TARGET_STATUSES).default("Target"),
    coachName: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    visitDate: z.string().date().optional(),
    offerType: z.enum(OFFER_TYPES).optional(),
    offerScholarshipPercent: z.number().int().min(0).max(100).optional(),
  })
  .refine((v) => v.offerType === "scholarship" || v.offerScholarshipPercent === undefined, {
    message: "Scholarship percent only applies to a scholarship offer",
    path: ["offerScholarshipPercent"],
  });

export type TargetFormValues = z.infer<typeof targetBaseSchema>;

export interface TargetFormResult {
  ok: boolean;
  values: TargetFormValues | null;
  errors: Record<string, string>;
}

export function parseTargetForm(formData: FormData): TargetFormResult {
  const offerType = strOrUndef(formData.get("offerType"));
  const input = {
    athleteId: String(formData.get("athleteId") ?? ""),
    schoolId: String(formData.get("schoolId") ?? ""),
    status: String(formData.get("status") ?? "Target"),
    coachName: strOrUndef(formData.get("coachName")),
    notes: strOrUndef(formData.get("notes")),
    visitDate: strOrUndef(formData.get("visitDate")),
    offerType,
    offerScholarshipPercent: offerType === "scholarship" ? numOrUndef(formData.get("offerScholarshipPercent")) : undefined,
  };

  const result = targetBaseSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
