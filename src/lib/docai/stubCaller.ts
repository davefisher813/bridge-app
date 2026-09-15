// A stand-in for the real model, so the whole upload flow runs before an
// Anthropic API key exists.
//
// This is NOT a fake that pretends to be real. Nothing it returns was read
// off the document: it derives a deterministic result from the file's own
// bytes so the same upload always behaves the same way, and every screen
// that displays a stubbed result labels it as simulated. The moment a real
// ModelCaller is injected instead, the pipeline, the persistence and the
// screens are unchanged - that is the entire point of the injected
// ModelCaller seam in pipeline.ts.
//
// Kept outside src/lib/fit and free of Next/Supabase imports, like the rest
// of src/lib/docai (see CLAUDE.md's walled-off-modules rule).

import type { ModelCaller } from "./pipeline";
import type { DocCategoryId } from "./types";

// Deterministic 0-1 from a string, so one file always yields one outcome.
// Not a hash anyone should rely on for anything else.
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const TRIAGE_TYPE: Record<DocCategoryId, string> = {
  transcript: "transcript",
  test_scores: "test_scores",
  offer_letter: "offer_letter",
  recommendation: "recommendation",
  financial_aid: "financial_aid",
  film: "highlight_video_screenshot",
};

// One band per file, decided once, so triage and extraction agree with
// each other. Deriving them independently is how the first version ended
// up unable to produce an auto-apply at all: its best case was 0.99
// model confidence against 0.88 legibility, which is 0.83 effective once
// the coordinator weight is applied, just under the 0.85 auto-apply
// threshold in provenance.ts. The Applied screen was unreachable.
type Band = "unreadable" | "marginal" | "clean";

function bandOf(seed: number): Band {
  if (seed < 0.15) return "unreadable";
  if (seed < 0.45) return "marginal";
  return "clean";
}

// Legibility and model confidence per band, chosen against the real
// thresholds: clean x coordinator clears 0.85 and auto-applies, clean x
// parent does not and lands in review, marginal always reviews, and
// unreadable is refused at triage before extraction is even attempted.
function bandValues(seed: number, band: Band): { legibility: number; confidence: number } {
  const t = (seed - (band === "clean" ? 0.45 : 0.15)) / (band === "clean" ? 0.55 : 0.3);
  if (band === "unreadable") return { legibility: 0.3 + seed, confidence: 0.4 };
  if (band === "marginal") return { legibility: 0.62 + t * 0.16, confidence: 0.6 + t * 0.15 };
  return { legibility: 0.96 + t * 0.03, confidence: 0.95 + t * 0.04 };
}

function stubTriage(seed: number, category: DocCategoryId): string {
  const band = bandOf(seed);
  const { legibility } = bandValues(seed, band);
  const readable = band !== "unreadable";
  const issues = !readable
    ? ["Image is too blurry to read reliably", "Part of the page is cut off"]
    : band === "marginal"
      ? ["Some glare across the middle of the page"]
      : [];
  return JSON.stringify({
    readable,
    legibilityScore: Number(legibility.toFixed(2)),
    detectedType: TRIAGE_TYPE[category],
    typeMatchesExpected: true,
    pagesDetected: 1 + Math.floor(seed * 3),
    issues,
    recommendation: readable ? "proceed" : "retake",
    reason: readable
      ? "Simulated triage: the page is legible enough to extract from."
      : "Simulated triage: the page is not legible enough to trust an extraction.",
  });
}

function stubExtraction(seed: number, category: DocCategoryId): string {
  const band = bandOf(seed);
  const confidence = Number(bandValues(seed, band).confidence.toFixed(2));
  const base = { confidence, warnings: ["Simulated extraction, not read from the document"] };

  switch (category) {
    case "transcript":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        school: "Sample High School",
        gradYear: 2027,
        sport: "Baseball",
        gpa: Number((2.6 + seed * 1.4).toFixed(2)),
        gpaScale: "4.0",
        gpaVerified: true,
        courseLoad: "Mixed (some Honors)",
        apCount: 2,
        honorsCount: 3,
        regularCount: 4,
        ibCount: 0,
        dualCount: 0,
        courseRigorNotes: "Simulated. No course data was read from the file.",
      });
    case "test_scores":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        satTotal: 1000 + Math.round(seed * 400),
        actComposite: 20 + Math.round(seed * 10),
        testDate: "2026-04-11",
      });
    case "offer_letter":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        school: "Sample State University",
        offerType: "scholarship",
        scholarshipPercent: 25 + Math.round(seed * 50),
      });
    case "recommendation":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        recommenderName: "Sample Coach",
        recommenderRole: "Head Coach",
        summary: "Simulated recommendation text.",
      });
    case "financial_aid":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        school: "Sample State University",
        totalCostOfAttendance: 42000,
        grantAid: 12000 + Math.round(seed * 8000),
      });
    case "film":
      // The registry carries film as an explicit not-yet-supported
      // placeholder; the pipeline refuses it before it ever gets here.
      return JSON.stringify({ ...base, unsupported: true });
  }
}

export interface StubCallerOptions {
  category: DocCategoryId;
  // Anything stable about the upload. The file name plus its size is
  // enough to keep one document's behaviour consistent between a retry
  // and a reload.
  seedText: string;
}

export function createStubCaller(opts: StubCallerOptions): ModelCaller {
  const seed = seedOf(opts.seedText);
  return async (call) => {
    if (call.requestId.endsWith("_triage")) return stubTriage(seed, opts.category);
    return stubExtraction(seed, opts.category);
  };
}
