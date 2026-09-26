// Validation for the athlete add/edit form. Separate from
// src/lib/fit/schema.ts on purpose: that file validates athletes.detail's
// shape for the fit engine's own consumption (and must stay walled off
// from anything DB/form-specific, per CLAUDE.md); this validates the
// full form payload, including the plain columns detail doesn't cover,
// and reuses athleteDetailSchema's pieces rather than duplicating them.

import { z } from "zod";
import { athleteDetailSchema } from "@/lib/fit/schema";
import type { AthleteDetail, RecruitType } from "@/lib/fit/types";
import { GOAL_LABEL, GRADE_KEYS, GRADE_MAX, GRADE_MIN, type AthleteGoal } from "@/lib/fit/contract";
import { METRICS, SOURCES } from "@/lib/fit/contract";

export const RECRUIT_TYPES: { value: RecruitType; label: string }[] = [
  { value: "hs", label: "High School" },
  { value: "transfer_4to4", label: "Transfer (4-to-4)" },
  { value: "transfer_juco", label: "Transfer (JUCO)" },
  { value: "transfer_grad", label: "Transfer (Grad)" },
];

// Enrolled is the status after Committed: the athlete is actually
// attending now, not just signed. It is the one value that closes
// recruiting out - see src/lib/data/enrollment.ts - so it is reachable
// from the Edit form (a permissive escape hatch, for correcting an
// import or a mistake) as well as from the dedicated Mark Enrolled
// screen (which requires a Committed target first and lets the date be
// picked). Both paths run the same close-out. Dave, 2026-09-26: "it
// can't just be like high school recruiting to transfer recruiting, it
// needs to make sense" - ruling out reusing recruit_type for this, which
// describes what KIND of recruit someone is, not whether they still are
// one.
export const ATHLETE_STATUSES = ["Active", "Committed", "Enrolled", "Graduated", "Drafted", "Inactive"] as const;

export const ATHLETE_GOALS: { value: AthleteGoal; label: string }[] = (Object.keys(GOAL_LABEL) as AthleteGoal[]).map((value) => ({ value, label: GOAL_LABEL[value] }));

const gradeSchema = z.number().int().min(GRADE_MIN, `Grades run ${GRADE_MIN} to ${GRADE_MAX}`).max(GRADE_MAX, `Grades run ${GRADE_MIN} to ${GRADE_MAX}`).optional();

const numOrUndef = (v: FormDataEntryValue | null) => {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

export const athleteBaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  sport: z.string().trim().min(1, "Sport is required"),
  position: z.string().trim().optional(),
  recruitType: z.enum(["hs", "transfer_4to4", "transfer_juco", "transfer_grad"]),
  gpa: z.number().min(0).max(4.0).optional(),
  gpaVerified: z.boolean().default(false),
  status: z.enum(ATHLETE_STATUSES).default("Active"),
  isInternational: z.boolean().default(false),
  toeflScore: z.number().int().min(0).max(120).optional(),
  ieltsScore: z.number().min(0).max(9).optional(),
  f1VisaStatus: z.string().trim().optional(),
  ncaaEligibilityStatus: z.string().trim().optional(),
  // docs/MATCHING_CONTRACT.md: the goal shifts the blend, the budget
  // drives financial fit, the home state picks in-state cost, the grades
  // blend into the athletic score.
  goal: z.enum(["education", "balanced", "development"]).default("balanced"),
  familyBudget: z.number().min(0, "A budget cannot be negative").max(1000000, "That budget is more than a year of any school").optional(),
  homeState: z.string().trim().toUpperCase().length(2, "Two letters, like CT").optional(),
  frame: gradeSchema,
  athleticism: gradeSchema,
  skill: gradeSchema,
  iq: gradeSchema,
  competitiveness: gradeSchema,
});

export type AthleteFormValues = z.infer<typeof athleteBaseSchema>;

export interface AthleteFormResult {
  ok: boolean;
  values: AthleteFormValues;
  detail: AthleteDetail | null;
  errors: Record<string, string>;
}

// Parses a raw FormData into the base fields plus a validated `detail`
// (hs or transfer, matching recruitType), or collects field-level errors
// instead of throwing - a form re-render needs to say what to fix, not
// just that something was wrong.
export function parseAthleteForm(formData: FormData): AthleteFormResult {
  const errors: Record<string, string> = {};

  const baseInput = {
    name: String(formData.get("name") ?? ""),
    sport: String(formData.get("sport") ?? ""),
    position: strOrUndef(formData.get("position")),
    recruitType: String(formData.get("recruitType") ?? "hs"),
    gpa: numOrUndef(formData.get("gpa")),
    gpaVerified: formData.get("gpaVerified") === "on",
    status: String(formData.get("status") ?? "Active"),
    isInternational: formData.get("isInternational") === "on",
    toeflScore: numOrUndef(formData.get("toeflScore")),
    ieltsScore: numOrUndef(formData.get("ieltsScore")),
    f1VisaStatus: strOrUndef(formData.get("f1VisaStatus")),
    ncaaEligibilityStatus: strOrUndef(formData.get("ncaaEligibilityStatus")),
    goal: String(formData.get("goal") ?? "balanced"),
    familyBudget: numOrUndef(formData.get("familyBudget")),
    homeState: strOrUndef(formData.get("homeState")),
    frame: numOrUndef(formData.get("frame")),
    athleticism: numOrUndef(formData.get("athleticism")),
    skill: numOrUndef(formData.get("skill")),
    iq: numOrUndef(formData.get("iq")),
    competitiveness: numOrUndef(formData.get("competitiveness")),
  };

  const baseResult = athleteBaseSchema.safeParse(baseInput);
  if (!baseResult.success) {
    for (const issue of baseResult.error.issues) {
      errors[String(issue.path[0])] = issue.message;
    }
  }
  const values = baseResult.success ? baseResult.data : (baseInput as unknown as AthleteFormValues);

  const recruitType = values.recruitType;
  const detailInput =
    recruitType === "hs"
      ? {
          kind: "hs" as const,
          gradYear: numOrUndef(formData.get("gradYear")),
          apCount: numOrUndef(formData.get("apCount")),
          ibCount: numOrUndef(formData.get("ibCount")),
          honorsCount: numOrUndef(formData.get("honorsCount")),
          dualCount: numOrUndef(formData.get("dualCount")),
          satTotal: numOrUndef(formData.get("satTotal")),
          actComposite: numOrUndef(formData.get("actComposite")),
          desiredMajor: strOrUndef(formData.get("desiredMajor")),
        }
      : {
          kind: "transfer" as const,
          currentSchool: String(formData.get("currentSchool") ?? ""),
          currentDivision: strOrUndef(formData.get("currentDivision")),
          collegeGpa: numOrUndef(formData.get("collegeGpa")),
          creditHoursCompleted: numOrUndef(formData.get("creditHoursCompleted")),
          eligibilityYearsRemaining: numOrUndef(formData.get("eligibilityYearsRemaining")) ?? 0,
          portalEntryDate: strOrUndef(formData.get("portalEntryDate")),
          transferCount: numOrUndef(formData.get("transferCount")) ?? 0,
          degreeCompleted: recruitType === "transfer_grad" ? formData.get("degreeCompleted") === "on" : undefined,
          desiredMajor: strOrUndef(formData.get("desiredMajor")),
        };

  const detailResult = athleteDetailSchema.safeParse(detailInput);
  let detail: AthleteDetail | null = null;
  if (detailResult.success) {
    detail = detailResult.data as AthleteDetail;
  } else {
    for (const issue of detailResult.error.issues) {
      errors[String(issue.path[0] ?? "detail")] = issue.message;
    }
  }

  return { ok: baseResult.success && detailResult.success, values, detail, errors };
}

// The columns migration 0021 added, from parsed form values.
export function matchingColumnsFrom(values: AthleteFormValues): { goal: string; family_budget_cents: number | null; home_state: string | null; grades: Record<string, number> } {
  const grades: Record<string, number> = {};
  for (const k of GRADE_KEYS) {
    const v = values[k];
    if (typeof v === "number") grades[k] = v;
  }
  return {
    goal: values.goal,
    family_budget_cents: values.familyBudget === undefined ? null : Math.round(values.familyBudget * 100),
    home_state: values.homeState ?? null,
    grades,
  };
}


// ── First metrics, typed while the profile is built ──────────────────
// Dave, 2026-09-21: "when building the athlete's profile, I should be
// able to log metrics." Each number typed becomes a dated entry in the
// log, all sharing one date and one source, so the record is complete
// the first time anyone opens it. Every field is optional; a value with
// no date is the one thing refused.


export interface FirstMetrics {
  entries: { metric: string; value: number }[];
  measuredOn: string;
  source: string;
  sourceDetail: string | null;
}

export function parseFirstMetrics(formData: FormData): { ok: true; metrics: FirstMetrics | null } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const entries: { metric: string; value: number }[] = [];
  for (const m of METRICS) {
    const raw = String(formData.get(`metric_${m.key}`) ?? "").trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 10000) {
      errors[`metric_${m.key}`] = "A number, zero or more";
      continue;
    }
    entries.push({ metric: m.key, value: n });
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  if (entries.length === 0) return { ok: true, metrics: null };

  const measuredOn = String(formData.get("metricsMeasuredOn") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn)) return { ok: false, errors: { metricsMeasuredOn: "Pick the date these were measured" } };
  const source = String(formData.get("metricsSource") ?? "").trim();
  if (!SOURCES.some((s) => s.key === source)) return { ok: false, errors: { metricsSource: "Say where they were measured" } };
  const detail = String(formData.get("metricsSourceDetail") ?? "").trim().slice(0, 120);
  return { ok: true, metrics: { entries, measuredOn, source, sourceDetail: detail || null } };
}
