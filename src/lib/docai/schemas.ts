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
//
// Strict about meaning, lenient about spelling. Every field goes
// through the preprocessors in lenient.ts, so "3.5" is the number 3.5,
// 04/11/2026 is 2026-04-11, "N/A" is null and "Walk-On" is walk_on.
// What is still refused is a value that means nothing: a GPA that is
// not a number, a date that is not a date, a metric key the engine
// does not have. A field that is descriptive rather than load-bearing
// (a course load, a letter's tone) falls back to a safe default rather
// than failing the whole document, because losing a four-year
// transcript over an unlisted adjective is the mistake this file exists
// to stop.

import { z } from "zod";
import { METRICS, SOURCES } from "@/lib/fit/contract";
import { bool, dated, datedOrNull, enumOr, int, num, str, strOrNull, toGpa, toNumber, toYear } from "./lenient";

const nullable = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" ? null : v), s.nullable());
const emptyToNullYear = (v: unknown) => {
  const y = toYear(v);
  return typeof y === "number" ? Math.round(y) : y;
};

const baseFields = {
  confidence: z.preprocess(toNumber, z.number().min(0).max(1).nullable()).optional(),
  warnings: z.preprocess((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((w) => typeof w === "string" && w.trim()) : []), z.array(z.string())).optional().default([]),
};

// A count that is missing or unreadable is zero, not a failed document.
const count = () => z.preprocess((v) => (v == null || v === "" ? 0 : v), int().pipe(z.number().min(0))).default(0);

export const transcriptSchema = z.object({
  ...baseFields,
  // Nullable on purpose. A student-portal transcript printed to PDF
  // often carries no name anywhere on the page, and requiring one here
  // threw away an otherwise perfect four-year transcript at the
  // validation step, before the coordinator's "this is for X" override
  // was ever consulted. The pipeline handles the missing name by
  // refusing to auto-apply it, which is the right place for that call.
  studentName: strOrNull().optional().default(null),
  // Also nullable: a transcript whose header is cut off is still a
  // course list, and the pipeline warns and sends it to review instead
  // of losing it.
  school: strOrNull().optional().default(null),
  // Which kind of school issued it. A college transcript belongs to a
  // transfer athlete and its courses are not the NCAA core list, so
  // the apply keeps the GPA and leaves the course table alone.
  level: z.preprocess((v) => (v == null || v === "" ? null : v), enumOr(["high_school", "college", "middle_school"], "high_school").nullable()).optional().default(null),
  gradYear: z.preprocess((v) => emptyToNullYear(v), z.number().int().min(2000).max(2100).nullable()).optional().default(null),
  sport: strOrNull().optional(),
  gpa: z.preprocess(toGpa, z.number().finite().nullable()).optional().default(null),
  gpaScale: enumOr(["4.0", "5.0", "10", "20", "100", "other"], "other").default("other"),
  gpaVerified: z.preprocess((v) => (v == null ? true : v), bool()).default(true),
  courseLoad: enumOr(["Regular", "Mixed (some Honors)", "Mostly Honors/AP", "Heavy AP/IB"], "Regular").default("Regular"),
  apCount: count(),
  honorsCount: count(),
  regularCount: count(),
  ibCount: count(),
  dualCount: count(),
  courseRigorNotes: strOrNull().optional(),
  // Needed for the age-based eligibility clock, which can start before
  // an athlete enrols anywhere. Transcripts usually print it.
  dateOfBirth: datedOrNull().optional(),
  // Many transcripts print the school's own numeric-to-letter table
  // (Westminster prints "86-83 = B", Cardinal Hayes weights H/R
  // courses). The NCAA converts numeric grades using the school's own
  // published scale, not a generic curve, so when the table is on the
  // page it is the authoritative thing to capture.
  gradingScale: z
    .array(z.object({ letter: str().pipe(z.string().min(1)), min: num(), max: num() }))
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
    .preprocess(
      (v) => (Array.isArray(v) ? v : []),
      z.array(
        z.object({
          title: str().pipe(z.string().min(1)),
          subject: enumOr(["english", "math", "science", "social_science", "other_academic", "non_academic"], "other_academic"),
          // A missing credit is zero, which the engine treats as a row
          // that carries no weight rather than as a failed transcript.
          credit: z.preprocess((v) => (v == null || v === "" ? 0 : v), num().pipe(z.number().min(0))).default(0),
          // A string because transcripts print letters, numbers, and
          // markers like W, P and CR, and coercing early loses the
          // difference between a C and a credit-only course.
          grade: z.preprocess((v) => (v == null ? "" : typeof v === "number" ? String(v) : v), str()),
          weighted: z.preprocess((v) => (v == null ? false : v), bool()).default(false),
          term: strOrNull().optional(),
          // The school this course was taken at, when the transcript says
          // so per row rather than only in the header.
          //
          // A transfer student's transcript legitimately covers two
          // schools, and two schools convert numeric grades differently:
          // one school's 85 is a B and another's is a C. The storage
          // (athlete_courses.school_name) and the adapter have supported
          // that since the core-GPA work, but the extractor could not
          // express it, so every course from one document took that
          // document's single header school and half a transfer student's
          // transcript converted against the wrong table.
          //
          // Null, not absent, when the row does not say: the caller falls
          // back to the document's header school, which is right for the
          // ordinary single-school transcript.
          school: strOrNull().optional(),
        })
      )
    )
    .default([]),
});

const sectionScore = () => nullable(num()).optional();

export const testScoreItemSchema = z.object({
  type: enumOr(["SAT", "ACT", "AP", "PSAT", "Subject", "Other"], "Other"),
  testDate: datedOrNull().optional().default(null),
  totalScore: nullable(num()).optional().default(null),
  breakdown: z
    .preprocess(
      (v) => (v && typeof v === "object" ? v : undefined),
      z.object({
        math: sectionScore(),
        ebrw: sectionScore(),
        english: sectionScore(),
        reading: sectionScore(),
        science: sectionScore(),
        writing: sectionScore(),
        subject: strOrNull().optional(),
      })
    )
    .optional(),
  percentile: nullable(num()).optional(),
});

export const testScoresSchema = z.object({
  ...baseFields,
  studentName: strOrNull().optional().default(null),
  tests: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(testScoreItemSchema).min(1)),
});

export const offerLetterSchema = z.object({
  ...baseFields,
  studentName: strOrNull().optional().default(null),
  college: str().pipe(z.string().min(1)),
  sport: strOrNull().optional(),
  offerType: enumOr(["verbal", "written", "scholarship", "walk_on", "preferred_walk_on", "admission_only", "other"], "other"),
  scholarshipPercent: nullable(num().pipe(z.number().min(0).max(100))).optional(),
  offerDate: datedOrNull().optional().default(null),
  decisionDeadline: datedOrNull().optional(),
  position: strOrNull().optional(),
  coachName: strOrNull().optional(),
  coachTitle: strOrNull().optional(),
  isOfficial: z.preprocess((v) => (v == null ? false : v), bool()).default(false),
  notes: strOrNull().optional(),
});

export const recommendationSchema = z.object({
  ...baseFields,
  studentName: strOrNull().optional().default(null),
  recommenderName: str().pipe(z.string().min(1)),
  recommenderTitle: enumOr(["Coach", "Teacher", "Counselor", "Mentor", "Other"], "Other"),
  recommenderOrg: strOrNull().optional(),
  recType: enumOr(["academic", "athletic", "character", "mixed"], "mixed"),
  letterDate: datedOrNull().optional().default(null),
  addressedTo: strOrNull().optional(),
  tone: enumOr(["strong", "supportive", "lukewarm", "neutral"], "neutral"),
  themes: z.preprocess((v) => (Array.isArray(v) ? v.filter((t) => typeof t === "string" && t.trim()) : []), z.array(z.string())).default([]),
  summary: z.preprocess((v) => (v == null ? "" : v), str()),
  wordCount: nullable(int()).optional(),
});

export const financialAidAwardSchema = z.object({
  type: enumOr(["grant", "scholarship", "subsidized_loan", "unsubsidized_loan", "work_study", "parent_plus", "other"], "other"),
  name: z.preprocess((v) => (v == null ? "" : v), str()),
  amount: z.preprocess((v) => (v == null || v === "" ? 0 : v), num()),
  renewable: nullable(bool()).optional(),
});

export const financialAidSchema = z.object({
  ...baseFields,
  studentName: strOrNull().optional(),
  documentType: enumOr(["fafsa_sar", "css_profile", "award_letter", "efc_report", "other"], "other"),
  college: strOrNull().optional(),
  academicYear: strOrNull().optional().default(null),
  efc: nullable(num()).optional(),
  sai: nullable(num()).optional(),
  awards: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(financialAidAwardSchema)).default([]),
  totalCostOfAttendance: nullable(num()).optional(),
  netCost: nullable(num()).optional(),
});

// A metrics report: a showcase profile, an event results sheet or a
// dashboard screenshot. The keys are the engine's own metric keys and
// the source is the trust tier from the contract, so a row goes
// straight into athlete_metrics.
const metricKeys = METRICS.map((m) => m.key) as [string, ...string[]];
const sourceKeys = SOURCES.map((s) => s.key) as [string, ...string[]];

export const metricsReportItemSchema = z.object({
  key: z.enum(metricKeys),
  value: num().pipe(z.number().min(0).max(10000)),
  note: strOrNull().optional(),
});

export const metricsReportSchema = z.object({
  ...baseFields,
  studentName: strOrNull().optional(),
  sport: strOrNull().optional(),
  source: enumOr(sourceKeys, "event"),
  eventName: strOrNull().optional(),
  // A day or a month, never a bare year: a metric is ranked by when it
  // was measured and a year is not a measurement date.
  measuredOn: dated().pipe(z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "YYYY-MM-DD or YYYY-MM")),
  metrics: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(metricsReportItemSchema).min(1)),
});

export const triageResultSchema = z.object({
  readable: z.preprocess((v) => (v == null ? true : v), bool()),
  legibilityScore: z.preprocess(toNumber, z.number().min(0).max(1)),
  detectedType: enumOr(
    ["transcript", "test_scores", "offer_letter", "recommendation", "financial_aid", "metrics_report", "highlight_video_screenshot", "id_document", "other", "unreadable"],
    "other"
  ),
  typeMatchesExpected: z.preprocess((v) => (v == null ? true : v), bool()),
  pagesDetected: z.preprocess((v) => (v == null || v === "" ? 0 : v), int().pipe(z.number().min(0))),
  issues: z.preprocess((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((w) => typeof w === "string" && w.trim()) : []), z.array(z.string())).default([]),
  recommendation: enumOr(["proceed", "retake", "wrong_category", "partial_only"], "proceed"),
  reason: z.preprocess((v) => (v == null ? "" : v), str()),
});

export type TranscriptExtraction = z.infer<typeof transcriptSchema>;
export type TestScoresExtraction = z.infer<typeof testScoresSchema>;
export type OfferLetterExtraction = z.infer<typeof offerLetterSchema>;
export type RecommendationExtraction = z.infer<typeof recommendationSchema>;
export type FinancialAidExtraction = z.infer<typeof financialAidSchema>;
export type MetricsReportExtraction = z.infer<typeof metricsReportSchema>;
