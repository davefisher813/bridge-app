import { z } from "zod";

// recruiting_targets.aid (migration 0027): what an award letter says for
// one athlete at one school. Doc AI writes it when an award letter is
// applied (src/lib/data/applyExtraction.ts); this is the same shape typed
// or corrected by hand on the target's edit screen, so a misread number
// is fixed in place instead of by discarding the whole document.
//
// The award types are the ones the award-letter schema reads
// (src/lib/docai/schemas.ts, financialAidAwardSchema). Grants and
// scholarships are gift aid; the rest is money the family still pays or
// earns, which is why only gift aid comes off the cost when the net cost
// is worked out.
export const AWARD_TYPES = ["grant", "scholarship", "subsidized_loan", "unsubsidized_loan", "work_study", "parent_plus", "other"] as const;
export type AwardType = (typeof AWARD_TYPES)[number];

export const AWARD_TYPE_LABEL: Record<AwardType, string> = {
  grant: "Grant",
  scholarship: "Scholarship",
  subsidized_loan: "Subsidized loan",
  unsubsidized_loan: "Unsubsidized loan",
  work_study: "Work-study",
  parent_plus: "Parent PLUS loan",
  other: "Other",
};

const GIFT: readonly AwardType[] = ["grant", "scholarship"];

const money = z.number({ message: "A dollar amount" }).min(0, "Can't be negative").max(1_000_000, "That looks too large");

export const targetAidSchema = z.object({
  academicYear: z.string().trim().max(20, "Like 2026-27").nullable(),
  totalCostOfAttendance: money.nullable(),
  netCost: money.nullable(),
  efc: money.nullable(),
  sai: z.number().min(-1500, "The SAI floor is -1500").max(1_000_000).nullable(),
  awards: z
    .array(
      z.object({
        type: z.enum(AWARD_TYPES),
        name: z.string().trim().max(200),
        amount: money,
        renewable: z.boolean().nullable(),
      }),
    )
    .max(40),
  documentId: z.string().uuid().nullable(),
});

export type TargetAid = z.infer<typeof targetAidSchema>;

export interface TargetAidResult {
  ok: boolean;
  aid: TargetAid | null;
  errors: Record<string, string>;
}

function text(v: FormDataEntryValue | null): string {
  return v === null ? "" : String(v).trim();
}

// "", "$38,500" and "38500.00" all read; anything else is kept as NaN so
// the schema names the field rather than silently dropping it.
function moneyOrNull(v: FormDataEntryValue | null): number | null {
  const s = text(v).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

// A blank net cost is worked out the way the award-letter apply does it:
// the cost of attendance less the gift aid, never below zero. A typed
// net cost always wins.
export function netCostOf(aid: Pick<TargetAid, "totalCostOfAttendance" | "netCost" | "awards">): number | null {
  if (aid.netCost !== null) return aid.netCost;
  if (aid.totalCostOfAttendance === null) return null;
  const gift = aid.awards.filter((a) => GIFT.includes(a.type)).reduce((s, a) => s + a.amount, 0);
  return Math.max(0, aid.totalCostOfAttendance - gift);
}

// The form posts award rows as award_type_0, award_name_0 and so on.
// A row with no name and no amount is a blank the person added and did
// not fill, and is dropped rather than saved as a zero-dollar award.
export function parseTargetAidForm(formData: FormData, documentId: string | null = null): TargetAidResult {
  const awards: { type: string; name: string; amount: number; renewable: boolean | null }[] = [];
  const errors: Record<string, string> = {};
  for (let i = 0; formData.has(`award_type_${i}`); i++) {
    const name = text(formData.get(`award_name_${i}`));
    const rawAmount = text(formData.get(`award_amount_${i}`));
    if (!name && !rawAmount) continue;
    const amount = moneyOrNull(formData.get(`award_amount_${i}`));
    if (amount === null || Number.isNaN(amount)) errors[`award_amount_${i}`] = "A dollar amount";
    const renewable = text(formData.get(`award_renewable_${i}`));
    awards.push({
      type: text(formData.get(`award_type_${i}`)) || "other",
      name,
      amount: amount ?? 0,
      renewable: renewable === "yes" ? true : renewable === "no" ? false : null,
    });
  }

  const input = {
    academicYear: text(formData.get("academicYear")) || null,
    totalCostOfAttendance: moneyOrNull(formData.get("totalCostOfAttendance")),
    netCost: moneyOrNull(formData.get("netCost")),
    efc: moneyOrNull(formData.get("efc")),
    sai: moneyOrNull(formData.get("sai")),
    awards,
    documentId,
  };
  const result = targetAidSchema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const [head, index, field] = issue.path;
      const key = head === "awards" && typeof index === "number" ? `award_${String(field ?? "type")}_${index}` : String(head);
      errors[key] ??= issue.message === "Expected number, received nan" ? "A dollar amount" : issue.message;
    }
  }
  if (Object.keys(errors).length > 0 || !result.success) return { ok: false, aid: null, errors };
  if (result.data.totalCostOfAttendance === null && result.data.netCost === null && result.data.awards.length === 0) {
    return { ok: false, aid: null, errors: { form: "Enter the cost of attendance, the net cost or an award, or use Clear Award to remove it." } };
  }
  return { ok: true, aid: { ...result.data, netCost: netCostOf(result.data) }, errors: {} };
}

// Whatever is on the row now, read leniently for the form. A row Doc AI
// wrote before this form existed may lack keys; each missing one reads
// as blank rather than failing the screen.
export function aidFromRow(raw: unknown): TargetAid | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const awards = Array.isArray(a.awards) ? (a.awards as Record<string, unknown>[]) : [];
  return {
    academicYear: typeof a.academicYear === "string" ? a.academicYear : null,
    totalCostOfAttendance: num(a.totalCostOfAttendance),
    netCost: num(a.netCost),
    efc: num(a.efc),
    sai: num(a.sai),
    awards: awards.map((w) => ({
      type: (AWARD_TYPES as readonly string[]).includes(String(w.type)) ? (w.type as AwardType) : "other",
      name: typeof w.name === "string" ? w.name : "",
      amount: num(w.amount) ?? 0,
      renewable: typeof w.renewable === "boolean" ? w.renewable : null,
    })),
    documentId: typeof a.documentId === "string" ? a.documentId : null,
  };
}
