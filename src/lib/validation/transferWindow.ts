import { z } from "zod";
import { normalizeSport, SPORTS } from "@/lib/fit/contract";
import { SCHOOL_DIVISIONS } from "@/lib/validation/school";

// A transfer portal window is data, never a constant in code (CLAUDE.md;
// docs/BUSINESS_RULES.md): the NCAA moves the dates most years by vote.
// This is the shape an owner types one in as, with the page it was read
// from, so the next person can check it.

export const TRANSFER_DIVISIONS = SCHOOL_DIVISIONS;

const transferWindowSchema = z
  .object({
    sport: z
      .string()
      .trim()
      .min(1, "Pick a sport")
      .transform((s) => normalizeSport(s))
      .refine((s) => SPORTS.some((x) => x.key === s), "Pick a sport the app knows"),
    division: z.enum(TRANSFER_DIVISIONS, { message: "Pick a division" }),
    seasonYear: z
      .string()
      .trim()
      .regex(/^\d{4}(-\d{2})?$/, "A season like 2026-27, or a year like 2026"),
    windowLabel: z.string().trim().min(1, "Say which window this is").max(80),
    opensOn: z.string().date("Not a date"),
    closesOn: z.string().date("Not a date"),
    sourceUrl: z.string().trim().url("The NCAA or conference page these dates came from"),
  })
  .superRefine((v, ctx) => {
    if (v.closesOn < v.opensOn) ctx.addIssue({ code: "custom", path: ["closesOn"], message: "The window closes before it opens" });
  });

export type TransferWindowFormValues = z.infer<typeof transferWindowSchema>;

export interface TransferWindowFormResult {
  ok: boolean;
  values: TransferWindowFormValues | null;
  errors: Record<string, string>;
}

export function parseTransferWindowForm(formData: FormData): TransferWindowFormResult {
  const input = {
    sport: String(formData.get("sport") ?? ""),
    division: String(formData.get("division") ?? ""),
    seasonYear: String(formData.get("seasonYear") ?? ""),
    windowLabel: String(formData.get("windowLabel") ?? ""),
    opensOn: String(formData.get("opensOn") ?? ""),
    closesOn: String(formData.get("closesOn") ?? ""),
    sourceUrl: String(formData.get("sourceUrl") ?? ""),
  };
  const result = transferWindowSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
