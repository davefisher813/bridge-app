// Zod validation for athletes.detail. Postgres stores this column as
// bare jsonb ("Postgres validates ownership; the app validates shape" -
// jarvis-core's split, adopted here for the same reason: a new
// recruit_type or a new field on an existing one is a code change, not
// a migration). Every write to athletes.detail should go through
// parseAthleteDetail() first.

import { z } from "zod";
import type { AthleteDetail } from "./types";

const hsDetailSchema = z.object({
  kind: z.literal("hs"),
  gradYear: z.number().int().min(2000).max(2100).optional(),
  apCount: z.number().int().min(0).optional(),
  ibCount: z.number().int().min(0).optional(),
  honorsCount: z.number().int().min(0).optional(),
  dualCount: z.number().int().min(0).optional(),
  satTotal: z.number().int().min(400).max(1600).optional(),
  actComposite: z.number().int().min(1).max(36).optional(),
  desiredMajor: z.string().optional(),
});

const transferDetailSchema = z.object({
  kind: z.literal("transfer"),
  currentSchool: z.string().min(1, "currentSchool is required for a transfer athlete"),
  currentDivision: z.string().optional(),
  collegeGpa: z.number().min(0).max(4.0).optional(),
  creditHoursCompleted: z.number().int().min(0).optional(),
  eligibilityYearsRemaining: z.number().min(0).max(5),
  portalEntryDate: z.string().date().optional(),
  transferCount: z.number().int().min(0),
  degreeCompleted: z.boolean().optional(),
  desiredMajor: z.string().optional(),
});

export const athleteDetailSchema = z.discriminatedUnion("kind", [hsDetailSchema, transferDetailSchema]);

export function parseAthleteDetail(input: unknown): AthleteDetail {
  return athleteDetailSchema.parse(input) as AthleteDetail;
}

export function safeParseAthleteDetail(input: unknown) {
  return athleteDetailSchema.safeParse(input);
}
