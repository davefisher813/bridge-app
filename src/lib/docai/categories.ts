// The document category registry. Faithful port of Bridge's
// Engine.categories (bffsa-site/index.html ~lines 2213-2354): a
// config-driven map from document type to extraction prompt, output
// shape, and versioning strategy. This part of Bridge's Doc AI was
// already coherent design, not a patch stack, so unlike the fit engine
// this is a port-and-generalize, not a redesign - see docs/ARCHITECTURE.md.
//
// Generalized from Bridge's version: prompts no longer say "BFFSA" (the
// walled-off-module rule in CLAUDE.md - this file may not depend on
// anything org-specific), and every category now carries a Zod schema
// (schemas.ts) that Bridge's version never had.

import type { z } from "zod";
import type { DocCategory, DocCategoryId } from "./types";
import { financialAidSchema, offerLetterSchema, recommendationSchema, testScoresSchema, transcriptSchema } from "./schemas";

export const CATEGORY_SCHEMAS: Record<Exclude<DocCategoryId, "film">, z.ZodTypeAny> = {
  transcript: transcriptSchema,
  test_scores: testScoresSchema,
  offer_letter: offerLetterSchema,
  recommendation: recommendationSchema,
  financial_aid: financialAidSchema,
};

const REGISTRY: Record<DocCategoryId, DocCategory> = {
  transcript: {
    id: "transcript",
    label: "Transcript",
    shape: "field_update",
    triageType: "transcript",
    extractionPrompt:
      "Extract structured data from an athlete's high school transcript. Return ONLY valid JSON, no markdown.\n\n" +
      "Schema:\n{\n" +
      '  "studentName": "full name as on transcript",\n' +
      '  "school": "high school name",\n' +
      '  "gradYear": number,\n' +
      '  "sport": "Baseball" | "Other" | null,\n' +
      '  "gpa": number | null,\n' +
      '  "gpaScale": "4.0" | "5.0" | "10" | "20" | "100" | "other",\n' +
      '  "gpaVerified": true,\n' +
      '  "courseLoad": "Regular" | "Mixed (some Honors)" | "Mostly Honors/AP" | "Heavy AP/IB",\n' +
      '  "apCount": number, "honorsCount": number, "regularCount": number, "ibCount": number, "dualCount": number,\n' +
      '  "courseRigorNotes": "1-2 sentences",\n' +
      '  "confidence": number 0-1,\n' +
      '  "warnings": []\n}',
  },
  test_scores: {
    id: "test_scores",
    label: "Test Scores",
    shape: "collection_append",
    collectionKey: "tests",
    triageType: "test_scores",
    extractionPrompt:
      "Extract test score data (SAT, ACT, AP, PSAT, Subject Test). Return ONLY valid JSON.\n\n" +
      "Schema:\n{\n" +
      '  "studentName": "full name on report",\n' +
      '  "tests": [{\n' +
      '    "type": "SAT"|"ACT"|"AP"|"PSAT"|"Subject"|"Other",\n' +
      '    "testDate": "YYYY-MM-DD or YYYY-MM",\n' +
      '    "totalScore": number | null,\n' +
      '    "breakdown": { "math": number, "ebrw": number, "english": number, "reading": number, "science": number, "writing": number, "subject": "string" },\n' +
      '    "percentile": number | null\n' +
      "  }],\n" +
      '  "confidence": number 0-1,\n' +
      '  "warnings": []\n}\n\nExtract ALL tests visible.',
  },
  offer_letter: {
    id: "offer_letter",
    label: "Offer Letter",
    shape: "collection_append",
    collectionKey: "offers",
    triageType: "offer_letter",
    extractionPrompt:
      "Extract a college athletic offer or admissions letter. Return ONLY valid JSON.\n\n" +
      "Schema:\n{\n" +
      '  "studentName": "string",\n' +
      '  "college": "full college name",\n' +
      '  "sport": "Baseball" | "Other" | null,\n' +
      '  "offerType": "verbal"|"written"|"scholarship"|"walk_on"|"preferred_walk_on"|"admission_only"|"other",\n' +
      '  "scholarshipPercent": number 0-100 | null,\n' +
      '  "offerDate": "YYYY-MM-DD or YYYY-MM",\n' +
      '  "decisionDeadline": "YYYY-MM-DD" | null,\n' +
      '  "position": "string or null",\n' +
      '  "coachName": "string or null",\n' +
      '  "coachTitle": "string or null",\n' +
      '  "isOfficial": boolean,\n' +
      '  "notes": "1-2 sentence summary",\n' +
      '  "confidence": number 0-1,\n' +
      '  "warnings": []\n}',
  },
  recommendation: {
    id: "recommendation",
    label: "Recommendation",
    shape: "collection_append",
    collectionKey: "recommendations",
    triageType: "recommendation",
    extractionPrompt:
      "Extract a recommendation letter. Return ONLY valid JSON.\n\n" +
      "Schema:\n{\n" +
      '  "studentName": "string",\n' +
      '  "recommenderName": "string",\n' +
      '  "recommenderTitle": "Coach"|"Teacher"|"Counselor"|"Mentor"|"Other",\n' +
      '  "recommenderOrg": "school or org",\n' +
      '  "recType": "academic"|"athletic"|"character"|"mixed",\n' +
      '  "letterDate": "YYYY-MM-DD",\n' +
      '  "addressedTo": "specific college, generic, or null",\n' +
      '  "tone": "strong"|"supportive"|"lukewarm"|"neutral",\n' +
      '  "themes": ["array of 2-4 short tags"],\n' +
      '  "summary": "2-3 sentence neutral summary",\n' +
      '  "wordCount": number | null,\n' +
      '  "confidence": number 0-1,\n' +
      '  "warnings": []\n}',
  },
  financial_aid: {
    id: "financial_aid",
    label: "Financial Aid",
    shape: "collection_append",
    collectionKey: "financialAid",
    triageType: "financial_aid",
    extractionPrompt:
      "Extract a financial aid document (FAFSA SAR, CSS Profile, school award letter, EFC report). Return ONLY valid JSON.\n\n" +
      "Schema:\n{\n" +
      '  "studentName": "string or null",\n' +
      '  "documentType": "fafsa_sar"|"css_profile"|"award_letter"|"efc_report"|"other",\n' +
      '  "college": "string or null",\n' +
      '  "academicYear": "YYYY-YYYY",\n' +
      '  "efc": number | null,\n' +
      '  "sai": number | null,\n' +
      '  "awards": [{ "type": "grant"|"scholarship"|"subsidized_loan"|"unsubsidized_loan"|"work_study"|"parent_plus"|"other", "name": "string", "amount": number, "renewable": boolean | null }],\n' +
      '  "totalCostOfAttendance": number | null,\n' +
      '  "netCost": number | null,\n' +
      '  "confidence": number 0-1,\n' +
      '  "warnings": []\n}',
  },
  film: {
    id: "film",
    label: "Film / Highlights",
    shape: "unsupported",
    triageType: "highlight_video_screenshot",
    extractionPrompt: "",
    unsupportedMessage: "Video pipeline is not yet built. Upload a screenshot of a metrics dashboard, or record a link to the film for now.",
  },
};

export function getCategory(id: DocCategoryId): DocCategory {
  const cat = REGISTRY[id];
  if (!cat) throw new Error(`Unknown document category: ${id}`);
  return cat;
}

export function listCategories(): DocCategory[] {
  return Object.values(REGISTRY);
}

export function buildExtractionSystemPrompt(id: DocCategoryId, rosterContext: unknown[], override?: string): string {
  const cat = getCategory(id);
  if (cat.shape === "unsupported") throw new Error(cat.unsupportedMessage || "Unsupported document type");
  return (
    `You are a structured-data extraction service for a youth sports recruiting platform. ${cat.extractionPrompt}\n\n` +
    "ROSTER CONTEXT (existing athletes, for reference only - do NOT match yourself; that is a separate step):\n" +
    JSON.stringify(rosterContext.slice(0, 50)) +
    "\n\n" +
    `USER OVERRIDE: ${override || "(none)"}\n\n` +
    "Return ONLY the JSON object, no preamble, no markdown fences."
  );
}
