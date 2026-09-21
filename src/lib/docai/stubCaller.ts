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
  metrics: "metrics_report",
  film: "highlight_video_screenshot",
};

// One band per file, decided once, so triage and extraction agree with
// each other. Deriving them independently is how the first version ended
// up unable to produce an auto-apply at all: its best case was 0.99
// model confidence against 0.88 legibility, which is 0.83 effective once
// the coordinator weight is applied, just under the 0.85 auto-apply
// threshold in provenance.ts. The Applied screen was unreachable.
type Band = "unreadable" | "marginal" | "clean";

// A simulated course table. Grades slide with the seed so a "better"
// file produces a better core GPA, which is what makes the eligibility
// screen's three outcomes reachable from the bench without an API key.
function buildStubCourses(
  seed: number
): Array<{ title: string; subject: string; credit: number; grade: string; weighted: boolean; term: string; school?: string | null }> {
  // seed 0 -> mostly C, seed 1 -> mostly A. The bands are chosen so the
  // middle of the range lands in the academic-redshirt window rather
  // than skipping straight from nonqualifier to qualifier.
  const pick = (offset: number): string => {
    const v = seed + offset;
    if (v >= 0.75) return "A";
    if (v >= 0.45) return "B";
    if (v >= 0.2) return "C";
    return "D";
  };
  const core: Array<[string, string, number, number, boolean]> = [
    ["English 9", "english", 1, 0, false],
    ["English 10", "english", 1, 0.05, false],
    ["English 11", "english", 1, 0.1, false],
    ["AP Literature", "english", 1, 0.15, true],
    ["Algebra 1", "math", 1, -0.05, false],
    ["Geometry", "math", 1, 0, false],
    ["Algebra 2", "math", 1, 0.05, false],
    ["Biology", "science", 1, 0, false],
    ["Chemistry", "science", 1, -0.05, false],
    ["Global History", "social_science", 1, 0.1, false],
    ["US History", "social_science", 1, 0.05, false],
    ["Spanish 1", "other_academic", 1, 0.1, false],
    ["Spanish 2", "other_academic", 1, 0.1, false],
    ["Economics", "other_academic", 0.5, 0.05, false],
    ["Computer Science", "other_academic", 1, 0.15, false],
    ["Psychology", "other_academic", 0.5, 0.05, false],
  ];
  type StubCourse = { title: string; subject: string; credit: number; grade: string; weighted: boolean; term: string; school?: string | null };
  const rows: StubCourse[] = core.map(([title, subject, credit, offset, weighted]) => ({
    title: title as string,
    subject: subject as string,
    credit: credit as number,
    grade: pick(offset as number),
    weighted: weighted as boolean,
    term: "24-25",
  }));

  // Not core courses. These are the A grades that lift a transcript
  // average and are excluded from the NCAA one, which is the single
  // thing the screen exists to show.
  rows.push(
    { title: "Phys. Ed. 11", subject: "non_academic", credit: 0.5, grade: "A", weighted: false, term: "24-25" },
    { title: "Art 1", subject: "non_academic", credit: 0.5, grade: "A", weighted: false, term: "23-24" }
  );

  // A withdrawn course, which carries no quality points at all.
  rows.push({ title: "Physics", subject: "science", credit: 0, grade: "W", weighted: false, term: "25-26" });

  // A repeated title. Deliberately left untagged, because a repeat and a
  // year-long course split across two terms look identical from here and
  // the engine asks a human rather than guessing.
  rows.push({ title: "Algebra 2", subject: "math", credit: 1, grade: pick(0.2), weighted: false, term: "25-26" });

  // Above this seed the stub produces a TRANSFER transcript: two rows
  // from a different school, tagged per row. Two schools convert numeric
  // grades differently, so one school's 85 is a B and another's is a C,
  // and the whole per-course school field exists for this case. Making
  // it reachable from the stub is what lets the flow be exercised
  // without an API key, the same way the three eligibility outcomes are.
  if (seed > 0.7) {
    rows.push(
      { title: "English 9", subject: "english", credit: 1, grade: pick(0.1), weighted: false, term: "22-23", school: "Previous High School" },
      { title: "Biology", subject: "science", credit: 1, grade: pick(0.15), weighted: false, term: "22-23", school: "Previous High School" }
    );
  }

  return rows;
}

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
        dateOfBirth: "2008-03-15",
        // A real transcript's course table, simulated, because without
        // one the eligibility screen has nothing to compute from and the
        // whole feature is undemonstrable with no API key wired up. The
        // shape is what matters: a mix of subjects, a weighted course, a
        // withdrawn one, PE that must not count, and one repeated title
        // that a human has to resolve.
        courses: buildStubCourses(seed),
        // Numeric grades need the school's own table, which real
        // transcripts sometimes print. This stub returns letters, so it
        // returns no scale rather than a made-up one.
        gradingScale: null,
      });
    case "test_scores":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        tests: [
          { type: "SAT", testDate: "2026-04-11", totalScore: 1000 + Math.round(seed * 400), breakdown: { math: 500 + Math.round(seed * 200), ebrw: 500 + Math.round(seed * 200) }, percentile: null },
          { type: "ACT", testDate: "2026-06-13", totalScore: 20 + Math.round(seed * 10), percentile: null },
        ],
      });
    case "offer_letter":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        college: "Sample State University",
        sport: "Baseball",
        offerType: "scholarship",
        scholarshipPercent: 25 + Math.round(seed * 50),
        offerDate: "2026-08-01",
        decisionDeadline: "2026-11-01",
        position: "RHP",
        coachName: "Sample Coach",
        coachTitle: "Head Coach",
        isOfficial: true,
        notes: "Simulated offer letter.",
      });
    case "recommendation":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        recommenderName: "Sample Coach",
        recommenderTitle: "Coach",
        recommenderOrg: "Sample High School",
        recType: "athletic",
        letterDate: "2026-05-20",
        addressedTo: null,
        tone: "strong",
        themes: ["work ethic", "leadership"],
        summary: "Simulated recommendation text.",
        wordCount: 320,
      });
    case "financial_aid":
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        documentType: "award_letter",
        college: "Sample State University",
        academicYear: "2027-2028",
        efc: null,
        sai: null,
        awards: [
          { type: "scholarship", name: "Athletic Scholarship", amount: 12000 + Math.round(seed * 8000), renewable: true },
          { type: "grant", name: "University Grant", amount: 4000, renewable: true },
        ],
        totalCostOfAttendance: 42000,
        netCost: null,
      });
    case "metrics":
      // A showcase sheet. The numbers slide with the seed so a "better"
      // file reads as a better athlete on the metrics screen.
      return JSON.stringify({
        ...base,
        studentName: "Sample Athlete",
        sport: "Baseball",
        source: "pbr",
        eventName: "Sample Showcase",
        measuredOn: "2026-08-15",
        metrics: [
          { key: "fbVelo", value: 80 + Math.round(seed * 12), note: null },
          { key: "sixty", value: Number((7.4 - seed * 0.7).toFixed(2)), note: null },
          { key: "exitVelo", value: 84 + Math.round(seed * 14), note: null },
        ],
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
