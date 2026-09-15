// Regressions found by running the shipped pipeline against Dave's real
// Google Drive documents: three transcripts from three schools, an
// iPhone photo of a fourth, an Elite Squad player profile, and the real
// 25-athlete Bridge roster.
//
// The documents are not in this repo and must not be. They are real
// student records carrying dates of birth, home addresses and parent
// phone numbers. The fixtures below reproduce the SHAPE of what broke
// (name formats, GPA scales, a sibling pair, a nameless export) with
// invented people, which is all the code ever sees.
//
// Every case here failed before the fix in the same commit.

import { describe, expect, it } from "vitest";
import { findCandidates, nameMatch } from "./resolver";
import { routeDecision, AMBIGUOUS_MATCH_GAP, NAME_MATCH_AUTO } from "./provenance";
import { normalizeGpa } from "./gpa";
import { transcriptSchema } from "./schemas";
import { runExtractionPipeline, type ModelCaller } from "./pipeline";
import type { IngestedRecord, ResolverAthlete } from "./types";

// Two brothers on one roster, which is the situation that made a
// mis-resolution possible in the first place.
const roster: ResolverAthlete[] = [
  { id: "1", name: "Darnell Whitfield", school: "Monroe (Comp Sci HS)", gradYear: 2027 },
  { id: "2", name: "Ervin Whitfield", school: "James Monroe", gradYear: 2022 },
  { id: "3", name: "Mateo Santoro", school: "Westminister", gradYear: 2027 },
  { id: "4", name: "Jayden (JJ) Pereira", school: "Elite Squad Academy", gradYear: 2025 },
  { id: "5", name: "Kengri De Los Reyes", school: "Inwood", gradYear: 2026 },
];

describe("names as official transcripts actually print them", () => {
  // Every real transcript in the sample prints "Lastname, Firstname
  // Middlename". Token overlap scored that 0.667, under NAME_MATCH_AUTO,
  // so a document naming the athlete exactly could never auto-apply.
  it("matches Lastname, Firstname Middlename against a roster First Last", () => {
    expect(nameMatch("Mateo Santoro", "Santoro, Mateo Alexander")).toBeGreaterThanOrEqual(NAME_MATCH_AUTO);
  });

  it("ignores a parenthesised nickname on the roster side", () => {
    expect(nameMatch("Jayden (JJ) Pereira", "Pereira, Jayden")).toBeGreaterThanOrEqual(NAME_MATCH_AUTO);
  });

  it("treats a multi-word surname the same in both name orders", () => {
    expect(nameMatch("Kengri De Los Reyes", "De Los Reyes, Kengri")).toBeGreaterThanOrEqual(NAME_MATCH_AUTO);
  });

  it("ignores a generational suffix", () => {
    expect(nameMatch("Mateo Santoro", "Santoro, Mateo Jr.")).toBeGreaterThanOrEqual(NAME_MATCH_AUTO);
  });

  it("still scores two unrelated people low", () => {
    expect(nameMatch("Mateo Santoro", "Darnell Whitfield")).toBeLessThan(0.3);
  });

  // The old surname fallback was worth 0.85 by itself, which is how a
  // bare surname cleared the auto-apply bar against both brothers.
  it("refuses to treat a surname with no given name as an identification", () => {
    expect(nameMatch("Darnell Whitfield", "Whitfield")).toBeLessThan(NAME_MATCH_AUTO);
    expect(nameMatch("Ervin Whitfield", "Whitfield")).toBeLessThan(NAME_MATCH_AUTO);
  });
});

describe("a document must not be written to a sibling's record", () => {
  it("sends a document to review when the runner-up is close behind", () => {
    const candidates = findCandidates({ studentName: "D. Whitfield", school: "Comp Sci High", gradYear: 2027 }, roster);
    const top = candidates[0]!.score;
    const second = candidates[1]?.score ?? null;
    const route = routeDecision(0.95, top, second);
    if (second != null && top - second < AMBIGUOUS_MATCH_GAP) {
      expect(route).toBe("review");
    }
    // Whatever the gap turns out to be, an initial plus a shared surname
    // must never be enough to write to a record unattended.
    expect(routeDecision(0.99, 0.8, 0.72)).toBe("review");
  });

  it("still auto-applies when the best candidate is clear of the field", () => {
    expect(routeDecision(0.95, 0.95, 0.4)).toBe("auto_apply");
  });

  it("a lone candidate with no runner-up is not treated as ambiguous", () => {
    expect(routeDecision(0.95, 0.95, null)).toBe("auto_apply");
  });
});

describe("GPA numbers that appear on real transcripts", () => {
  it("accepts a weighted 100-scale average above 100 instead of discarding it", () => {
    const n = normalizeGpa(102, "100");
    expect(n).not.toBeNull();
    expect(n!.gpa).toBe(4.0);
    expect(n!.origValue).toBe(102);
  });

  it("accepts an above-100 value with no scale hint", () => {
    expect(normalizeGpa(101)).not.toBeNull();
  });

  it("still rejects a number that is not a GPA on any scale", () => {
    expect(normalizeGpa(250)).toBeNull();
  });

  it("converts the two 100-scale cumulative averages in the sample", () => {
    expect(normalizeGpa(86.2, "100")!.gpa).toBeCloseTo(2.94, 2);
    expect(normalizeGpa(84.3636, "100")!.gpa).toBeCloseTo(2.8, 2);
  });
});

describe("a transcript that does not name the student", () => {
  it("passes schema validation instead of being thrown away", () => {
    const parsed = transcriptSchema.safeParse({
      studentName: null,
      school: "Comp Sci High",
      gradYear: 2026,
      gpa: 3.99,
      gpaScale: "4.0",
      courseLoad: "Mostly Honors/AP",
    });
    expect(parsed.success).toBe(true);
  });

  it("is routed to review even when the coordinator pinned an athlete and confidence is high", async () => {
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [stubRecord()],
      sourceRole: "admin",
      override: "Darnell Whitfield",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: namelessTranscriptCaller,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.athlete.id).toBe("1");
    expect(result.route).toBe("review");
    expect(result.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/does not name the student/i)]));
  });
});

describe("a document for someone who is not on the roster yet", () => {
  it("never auto-applies just because the model was confident", async () => {
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [stubRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: strangerCaller,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toEqual([]);
    expect(result.route).toBe("review");
    expect(result.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/No athlete on this roster matches/i)]));
  });
});

describe("a document that is not the category it was filed under", () => {
  it("stops at triage instead of being extracted as one anyway", async () => {
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [stubRecord()],
      sourceRole: "parent",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: wrongCategoryCaller,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("triage_wrong_category");
    expect(result.error).toMatch(/not a transcript/i);
  });
});

function stubRecord(): IngestedRecord {
  return {
    originalName: "t.pdf",
    originalSize: 1000,
    originalMime: "application/pdf",
    kind: "pdf",
    sourceRole: "admin",
    ingestedAt: new Date().toISOString(),
    requestId: "req_real",
    mediaType: "application/pdf",
    base64: "AAAA",
    blockType: "document",
  };
}

const namelessTranscriptCaller: ModelCaller = async (opts) => {
  if (opts.requestId.endsWith("_triage")) {
    return JSON.stringify({
      readable: true,
      legibilityScore: 0.95,
      detectedType: "transcript",
      typeMatchesExpected: true,
      pagesDetected: 4,
      issues: ["No student name printed on any page"],
      recommendation: "proceed",
      reason: "Complete transcript, student not identified on the document.",
    });
  }
  return JSON.stringify({
    studentName: null,
    school: "Comp Sci High",
    gradYear: 2027,
    gpa: 3.74,
    gpaScale: "4.0",
    courseLoad: "Mostly Honors/AP",
    apCount: 6,
    confidence: 0.97,
  });
};

const strangerCaller: ModelCaller = async (opts) => {
  if (opts.requestId.endsWith("_triage")) {
    return JSON.stringify({
      readable: true,
      legibilityScore: 1,
      detectedType: "transcript",
      typeMatchesExpected: true,
      pagesDetected: 1,
      issues: [],
      recommendation: "proceed",
      reason: "Clean transcript.",
    });
  }
  return JSON.stringify({
    studentName: "Priya Raghunathan",
    school: "Somewhere Else High",
    gradYear: 2028,
    gpa: 3.9,
    gpaScale: "4.0",
    courseLoad: "Heavy AP/IB",
    confidence: 0.99,
  });
};

const wrongCategoryCaller: ModelCaller = async (opts) => {
  if (opts.requestId.endsWith("_triage")) {
    return JSON.stringify({
      readable: true,
      legibilityScore: 0.98,
      detectedType: "other",
      typeMatchesExpected: false,
      pagesDetected: 1,
      issues: ["This is a recruiting profile sheet, not a transcript"],
      recommendation: "wrong_category",
      reason: "One page player profile with velocity and contact details.",
    });
  }
  throw new Error("extraction must never be reached for a wrong-category document");
};
