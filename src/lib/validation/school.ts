import { z } from "zod";
import { PROGRAM_TIERS } from "@/lib/fit/contract";

// Mirrors the division comment on migrations/0001_core_schema.sql's schools table.
export const SCHOOL_DIVISIONS = ["D1", "D2", "D3", "NAIA", "JUCO D1", "JUCO D2", "JUCO D3", "Prep School"] as const;
export const SCHOLARSHIP_TYPES = ["full", "partial", "none"] as const;
export const OUTLOOKS = ["realistic", "competitive", "difficult"] as const;
export const PROGRAM_TIER_KEYS = PROGRAM_TIERS.map((t) => t.key) as [string, ...string[]];

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v).trim());
const numOrUndef = (v: FormDataEntryValue | null) => {
  if (v === null || String(v).trim() === "") return undefined;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isNaN(n) ? undefined : n;
};

// Every shared fact on a school: what the fit engine reads and what the
// CSV template carries (docs/MATCHING_CONTRACT.md section 4).
export const schoolBaseSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    division: z.enum(SCHOOL_DIVISIONS, { message: "Pick a division" }),
    programTier: z.enum(PROGRAM_TIER_KEYS).optional(),
    conference: z.string().trim().optional(),
    state: z.string().trim().toUpperCase().length(2, "Two letters, like CT").optional(),
    location: z.string().trim().max(120, "Keep it under 120 characters").optional(),
    sportsSponsored: z.string().trim().optional(),
    gpaMin: z.number().min(0).max(4, "GPA runs 0 to 4").optional(),
    gpaAvg: z.number().min(0).max(4, "GPA runs 0 to 4").optional(),
    satRange: z.string().trim().optional(),
    actRange: z.string().trim().optional(),
    majorsNote: z.string().trim().max(500, "Keep it under 500 characters").optional(),
    athleticScholarship: z.enum(SCHOLARSHIP_TYPES).optional(),
    avgAthleticAid: z.number().min(0).optional(),
    avgMeritAid: z.number().min(0).optional(),
    avgNeedAid: z.number().min(0).optional(),
    instateTotal: z.number().min(0).optional(),
    outstateTotal: z.number().min(0).optional(),
    rosterSpotsOpen: z.number().int().min(0).optional(),
    playingTimeOutlook: z.enum(OUTLOOKS).optional(),
    positionDepth: z.string().trim().optional(),
    majors: z.string().trim().optional(),
  })
  .refine((v) => v.division !== "D3" || !v.athleticScholarship || v.athleticScholarship === "none", {
    message: "A D3 school cannot offer athletic scholarships under NCAA rules",
    path: ["athleticScholarship"],
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
    programTier: strOrUndef(formData.get("programTier")),
    conference: strOrUndef(formData.get("conference")),
    state: strOrUndef(formData.get("state")),
    location: strOrUndef(formData.get("location")),
    sportsSponsored: strOrUndef(formData.get("sportsSponsored")),
    gpaMin: numOrUndef(formData.get("gpaMin")),
    gpaAvg: numOrUndef(formData.get("gpaAvg")),
    satRange: strOrUndef(formData.get("satRange")),
    actRange: strOrUndef(formData.get("actRange")),
    majorsNote: strOrUndef(formData.get("majorsNote")),
    athleticScholarship: strOrUndef(formData.get("athleticScholarship")),
    avgAthleticAid: numOrUndef(formData.get("avgAthleticAid")),
    avgMeritAid: numOrUndef(formData.get("avgMeritAid")),
    avgNeedAid: numOrUndef(formData.get("avgNeedAid")),
    instateTotal: numOrUndef(formData.get("instateTotal")),
    outstateTotal: numOrUndef(formData.get("outstateTotal")),
    rosterSpotsOpen: numOrUndef(formData.get("rosterSpotsOpen")),
    playingTimeOutlook: strOrUndef(formData.get("playingTimeOutlook")),
    positionDepth: strOrUndef(formData.get("positionDepth")),
    majors: strOrUndef(formData.get("majors")),
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
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// The keys inside each jsonb column that a surface owns. A save sets
// the keys it owns and leaves every other key on the row alone, so a
// fact written by something else (academics.majorAvailability, read by
// src/lib/fit/academic.ts; anything a later loader adds) survives an
// edit. A key the surface owns and was left blank is removed, so
// clearing a field still clears it (crud F4).
export const FORM_OWNED_KEYS = {
  academics: ["gpaMin", "gpaAvg", "satRange", "actRange", "majorsNote"],
  financials: ["athleticScholarship", "avgAthleticAid", "avgMeritAid", "avgNeedAid", "instateTotal", "outstateTotal", "rosterSpotsOpen"],
  athletics: ["playingTimeOutlook", "positionDepth"],
} as const;

// The CSV template (public/templates/schools.csv) carries fewer: no
// programs note and no depth chart.
export const CSV_OWNED_KEYS = {
  academics: ["gpaMin", "gpaAvg", "satRange", "actRange"],
  financials: ["athleticScholarship", "avgAthleticAid", "avgMeritAid", "avgNeedAid", "instateTotal", "outstateTotal", "rosterSpotsOpen"],
  athletics: ["playingTimeOutlook"],
} as const;

export type SchoolJsonbColumns = { academics?: unknown; financials?: unknown; athletics?: unknown };

export function mergeOwned(existing: unknown, owned: readonly string[], values: Record<string, unknown>): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
  for (const k of owned) delete base[k];
  for (const [k, v] of Object.entries(values)) if (v !== undefined && owned.includes(k)) base[k] = v;
  return base;
}

// The row the schools table takes, from parsed values. `existing` is
// the row's current jsonb columns on an edit; a new school has none.
export function schoolColumnsFrom(v: SchoolFormValues, existing?: SchoolJsonbColumns | null) {
  return {
    name: v.name,
    division: v.division,
    program_tier: v.programTier ?? null,
    conference: v.conference ?? null,
    state: v.state ?? null,
    location: v.location ?? null,
    sports_sponsored: parseSportsSponsored(v.sportsSponsored),
    majors: parseSportsSponsored(v.majors),
    academics: mergeOwned(existing?.academics, FORM_OWNED_KEYS.academics, { gpaMin: v.gpaMin, gpaAvg: v.gpaAvg, satRange: v.satRange, actRange: v.actRange, majorsNote: v.majorsNote }),
    financials: mergeOwned(existing?.financials, FORM_OWNED_KEYS.financials, {
      athleticScholarship: v.athleticScholarship,
      avgAthleticAid: v.avgAthleticAid,
      avgMeritAid: v.avgMeritAid,
      avgNeedAid: v.avgNeedAid,
      instateTotal: v.instateTotal,
      outstateTotal: v.outstateTotal,
      rosterSpotsOpen: v.rosterSpotsOpen,
    }),
    athletics: mergeOwned(existing?.athletics, FORM_OWNED_KEYS.athletics, { playingTimeOutlook: v.playingTimeOutlook, positionDepth: v.positionDepth }),
    profile_date: new Date().toISOString(),
  };
}
