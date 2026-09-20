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
    sportsSponsored: z.string().trim().optional(),
    gpaMin: z.number().min(0).max(4, "GPA runs 0 to 4").optional(),
    gpaAvg: z.number().min(0).max(4, "GPA runs 0 to 4").optional(),
    satRange: z.string().trim().optional(),
    actRange: z.string().trim().optional(),
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
    sportsSponsored: strOrUndef(formData.get("sportsSponsored")),
    gpaMin: numOrUndef(formData.get("gpaMin")),
    gpaAvg: numOrUndef(formData.get("gpaAvg")),
    satRange: strOrUndef(formData.get("satRange")),
    actRange: strOrUndef(formData.get("actRange")),
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

// The row the schools table takes, from parsed values.
export function schoolColumnsFrom(v: SchoolFormValues) {
  const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));
  return {
    name: v.name,
    division: v.division,
    program_tier: v.programTier ?? null,
    conference: v.conference ?? null,
    state: v.state ?? null,
    sports_sponsored: parseSportsSponsored(v.sportsSponsored),
    majors: parseSportsSponsored(v.majors),
    academics: drop({ gpaMin: v.gpaMin, gpaAvg: v.gpaAvg, satRange: v.satRange, actRange: v.actRange }),
    financials: drop({
      athleticScholarship: v.athleticScholarship,
      avgAthleticAid: v.avgAthleticAid,
      avgMeritAid: v.avgMeritAid,
      avgNeedAid: v.avgNeedAid,
      instateTotal: v.instateTotal,
      outstateTotal: v.outstateTotal,
      rosterSpotsOpen: v.rosterSpotsOpen,
    }),
    athletics: drop({ playingTimeOutlook: v.playingTimeOutlook, positionDepth: v.positionDepth }),
    profile_date: new Date().toISOString(),
  };
}
