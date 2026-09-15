// Zod schemas for what each document category's extraction prompt asks
// the model to return. Bridge never validated this shape at all - it
// JSON.parse'd the model's response and trusted every field
// (bffsa-site/index.html ~line 2343-2350). That's a real gap: a model
// that returns "gpa": "3.5" (a string) or omits a required field
// silently corrupts an athlete record. Every category here gets a
// schema, and extraction goes through safeParse before anything is
// applied - same "Postgres validates ownership, the app validates
// shape" principle as src/lib/fit/schema.ts, applied to model output
// instead of a jsonb column.

import { z } from "zod";

const baseFields = {
  confidence: z.number().min(0).max(1).nullable().optional(),
  warnings: z.array(z.string()).optional().default([]),
};

export const transcriptSchema = z.object({
  ...baseFields,
  // Nullable on purpose. A student-portal transcript printed to PDF
  // often carries no name anywhere on the page, and requiring one here
  // threw away an otherwise perfect four-year transcript at the
  // validation step, before the coordinator's "this is for X" override
  // was ever consulted. The pipeline handles the missing name by
  // refusing to auto-apply it, which is the right place for that call.
  studentName: z.string().min(1).nullable(),
  school: z.string().min(1),
  gradYear: z.number().int().min(2000).max(2100),
  sport: z.string().nullable().optional(),
  gpa: z.number().nullable(),
  gpaScale: z.enum(["4.0", "5.0", "10", "20", "100", "other"]),
  gpaVerified: z.boolean().default(true),
  courseLoad: z.enum(["Regular", "Mixed (some Honors)", "Mostly Honors/AP", "Heavy AP/IB"]),
  apCount: z.number().int().min(0).default(0),
  honorsCount: z.number().int().min(0).default(0),
  regularCount: z.number().int().min(0).default(0),
  ibCount: z.number().int().min(0).default(0),
  dualCount: z.number().int().min(0).default(0),
  courseRigorNotes: z.string().optional(),
  // Needed for the age-based eligibility clock, which can start before
  // an athlete enrols anywhere. Transcripts usually print it.
  dateOfBirth: z.string().nullable().optional(),
  // Many transcripts print the school's own numeric-to-letter table
  // (Westminster prints "86-83 = B", Cardinal Hayes weights H/R
  // courses). The NCAA converts numeric grades using the school's own
  // published scale, not a generic curve, so when the table is on the
  // page it is the authoritative thing to capture.
  gradingScale: z
    .array(z.object({ letter: z.string().min(1), min: z.number(), max: z.number() }))
    .nullable()
    .optional(),
  // The per-course rows an NCAA core-course GPA is actually computed
  // from. A cumulative transcript GPA cannot be converted into a core
  // GPA, so without these there is no NCAA number to give anyone.
  //
  // Optional on purpose: a transcript whose course table is unreadable
  // is still a useful document, and losing the whole extraction over a
  // missing course list is the mistake that was already made once with
  // studentName.
  courses: z
    .array(
      z.object({
        title: z.string().min(1),
        subject: z.enum(["english", "math", "science", "social_science", "other_academic", "non_academic"]),
        credit: z.number().min(0),
        // A string because transcripts print letters, numbers, and
        // markers like W, P and CR, and coercing early loses the
        // difference between a C and a credit-only course.
        grade: z.string(),
        weighted: z.boolean().optional().default(false),
        term: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
});

export const testScoreItemSchema = z.object({
  type: z.enum(["SAT", "ACT", "AP", "PSAT", "Subject", "Other"]),
  testDate: z.string(),
  totalScore: z.number().nullable(),
  breakdown: z
    .object({
      math: z.number().optional(),
      ebrw: z.number().optional(),
      english: z.number().optional(),
      reading: z.number().optional(),
      science: z.number().optional(),
      writing: z.number().optional(),
      subject: z.string().optional(),
    })
    .optional(),
  percentile: z.number().nullable().optional(),
});

export const testScoresSchema = z.object({
  ...baseFields,
  studentName: z.string().min(1),
  tests: z.array(testScoreItemSchema).min(1),
});

export const offerLetterSchema = z.object({
  ...baseFields,
  studentName: z.string().min(1),
  college: z.string().min(1),
  sport: z.string().nullable().optional(),
  offerType: z.enum(["verbal", "written", "scholarship", "walk_on", "preferred_walk_on", "admission_only", "other"]),
  scholarshipPercent: z.number().min(0).max(100).nullable().optional(),
  offerDate: z.string(),
  decisionDeadline: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  coachName: z.string().nullable().optional(),
  coachTitle: z.string().nullable().optional(),
  isOfficial: z.boolean().default(false),
  notes: z.string().optional(),
});

export const recommendationSchema = z.object({
  ...baseFields,
  studentName: z.string().min(1),
  recommenderName: z.string().min(1),
  recommenderTitle: z.enum(["Coach", "Teacher", "Counselor", "Mentor", "Other"]),
  recommenderOrg: z.string().optional(),
  recType: z.enum(["academic", "athletic", "character", "mixed"]),
  letterDate: z.string(),
  addressedTo: z.string().nullable().optional(),
  tone: z.enum(["strong", "supportive", "lukewarm", "neutral"]),
  themes: z.array(z.string()).default([]),
  summary: z.string(),
  wordCount: z.number().int().nullable().optional(),
});

export const financialAidAwardSchema = z.object({
  type: z.enum(["grant", "scholarship", "subsidized_loan", "unsubsidized_loan", "work_study", "parent_plus", "other"]),
  name: z.string(),
  amount: z.number(),
  renewable: z.boolean().nullable().optional(),
});

export const financialAidSchema = z.object({
  ...baseFields,
  studentName: z.string().nullable().optional(),
  documentType: z.enum(["fafsa_sar", "css_profile", "award_letter", "efc_report", "other"]),
  college: z.string().nullable().optional(),
  academicYear: z.string(),
  efc: z.number().nullable().optional(),
  sai: z.number().nullable().optional(),
  awards: z.array(financialAidAwardSchema).default([]),
  totalCostOfAttendance: z.number().nullable().optional(),
  netCost: z.number().nullable().optional(),
});

export const triageResultSchema = z.object({
  readable: z.boolean(),
  legibilityScore: z.number().min(0).max(1),
  detectedType: z.enum([
    "transcript",
    "test_scores",
    "offer_letter",
    "recommendation",
    "financial_aid",
    "highlight_video_screenshot",
    "id_document",
    "other",
    "unreadable",
  ]),
  typeMatchesExpected: z.boolean(),
  pagesDetected: z.number().int().min(0),
  issues: z.array(z.string()).default([]),
  recommendation: z.enum(["proceed", "retake", "wrong_category", "partial_only"]),
  reason: z.string(),
});

export type TranscriptExtraction = z.infer<typeof transcriptSchema>;
export type TestScoresExtraction = z.infer<typeof testScoresSchema>;
export type OfferLetterExtraction = z.infer<typeof offerLetterSchema>;
export type RecommendationExtraction = z.infer<typeof recommendationSchema>;
export type FinancialAidExtraction = z.infer<typeof financialAidSchema>;
