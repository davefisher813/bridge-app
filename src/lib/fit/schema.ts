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

// Same split applies to schools.academics/financials/athletics/conflicts:
// bare jsonb in Postgres, shape owned here. Keys are camelCase to match
// School in ./types.ts directly, same convention as athletes.detail above
// (0001_core_schema.sql's inline comments show snake_case examples from
// before this was decided; camelCase is the actual convention). Schools
// are shared reference data any org can eventually edit, so a malformed
// field degrades to "not on file" rather than throwing and taking down a
// page over one bad value.
//
// Per field, not per object. The object-level catch this used to have
// meant one wrong-typed value emptied the whole column: a bulk load on
// 2026-09-26 wrote athleticScholarship as true/false and the engine
// silently lost every school's cost data with it. The object catch stays
// only for input that is not an object at all.
const field = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);

const schoolAcademicsSchema = z
  .object({
    gpaMin: field(z.number()),
    gpaAvg: field(z.number()),
    satRange: field(z.string()),
    actRange: field(z.string()),
    majorAvailability: field(z.record(z.string(), z.object({ offered: z.boolean(), accreditationNotes: z.string().optional() }))),
    // Free text about the programs families ask about. Shown, never scored.
    majorsNote: field(z.string()),
  })
  .catch({});

const schoolFinancialsSchema = z
  .object({
    athleticScholarship: field(z.enum(["full", "partial", "none"])),
    avgAthleticAid: field(z.number()),
    avgMeritAid: field(z.number()),
    avgNeedAid: field(z.number()),
    outstateTotal: field(z.number()),
    instateTotal: field(z.number()),
    rosterSpotsOpen: field(z.number()),
  })
  .catch({});

const schoolAthleticsSchema = z
  .object({
    playingTimeOutlook: field(z.enum(["realistic", "competitive", "difficult"])),
    positionDepth: field(z.string()),
  })
  .catch({});

const schoolConflictSchema = z.object({
  type: z.string(),
  severity: z.enum(["conflict", "warning"]),
  message: z.string(),
});

const schoolConflictsSchema = z.array(schoolConflictSchema).catch([]);

export function parseSchoolAcademics(input: unknown) {
  return schoolAcademicsSchema.parse(input);
}

export function parseSchoolFinancials(input: unknown) {
  return schoolFinancialsSchema.parse(input);
}

export function parseSchoolAthletics(input: unknown) {
  return schoolAthleticsSchema.parse(input);
}

export function parseSchoolConflicts(input: unknown) {
  return schoolConflictsSchema.parse(input);
}
