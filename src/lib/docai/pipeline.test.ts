import { describe, expect, it } from "vitest";
import { detectCategory, runExtractionPipeline, type ModelCaller } from "./pipeline";
import type { IngestedRecord, ResolverAthlete } from "./types";

function fakeRecord(): IngestedRecord {
  return {
    originalName: "transcript.pdf",
    originalSize: 12345,
    originalMime: "application/pdf",
    kind: "pdf",
    sourceRole: "admin",
    ingestedAt: new Date().toISOString(),
    requestId: "r_test_1",
    mediaType: "application/pdf",
    base64: "ZmFrZQ==",
    blockType: "document",
  };
}

const roster: ResolverAthlete[] = [{ id: "1", name: "Xavier Davis", school: "Stamford High", gradYear: 2027 }];

function scriptedCaller(byRequestSuffix: Record<string, string>): ModelCaller {
  return async (opts) => {
    const suffix = opts.requestId.endsWith("_triage") ? "_triage" : "_extract";
    const response = byRequestSuffix[suffix];
    if (!response) throw new Error(`No scripted response for ${suffix}`);
    return response;
  };
}

const GOOD_TRIAGE = JSON.stringify({
  readable: true,
  legibilityScore: 0.95,
  detectedType: "transcript",
  typeMatchesExpected: true,
  pagesDetected: 1,
  issues: [],
  recommendation: "proceed",
  reason: "Clear scan.",
});

const GOOD_TRANSCRIPT = JSON.stringify({
  studentName: "Xavier Davis",
  school: "Stamford High",
  gradYear: 2027,
  sport: "Baseball",
  gpa: 3.7,
  gpaScale: "4.0",
  gpaVerified: true,
  courseLoad: "Heavy AP/IB",
  apCount: 5,
  honorsCount: 2,
  regularCount: 1,
  ibCount: 0,
  dualCount: 0,
  confidence: 0.92,
  warnings: [],
});

describe("runExtractionPipeline", () => {
  it("auto-applies a clean, high-confidence, well-matched transcript", async () => {
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: scriptedCaller({ _triage: GOOD_TRIAGE, _extract: GOOD_TRANSCRIPT }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("auto_apply");
      expect(result.candidates[0]?.athlete.id).toBe("1");
      expect(result.versionClassification).toEqual({ kind: "first" });
    }
  });

  it("stops at triage when the model recommends a retake", async () => {
    const badTriage = JSON.stringify({
      readable: false,
      legibilityScore: 0.2,
      detectedType: "transcript",
      typeMatchesExpected: true,
      pagesDetected: 1,
      issues: ["Bottom third of page is cut off"],
      recommendation: "retake",
      reason: "Cropped.",
    });
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: scriptedCaller({ _triage: badTriage, _extract: GOOD_TRANSCRIPT }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("triage_retake");
  });

  it("routes a low-legibility scan to review even when the model claims high confidence", async () => {
    const lowLegTriage = JSON.stringify({
      readable: true,
      legibilityScore: 0.55,
      detectedType: "transcript",
      typeMatchesExpected: true,
      pagesDetected: 1,
      issues: ["Slightly blurry"],
      recommendation: "proceed",
      reason: "Readable but blurry.",
    });
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: scriptedCaller({ _triage: lowLegTriage, _extract: GOOD_TRANSCRIPT }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("review");
      expect(result.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Low-legibility/)]));
    }
  });

  it("rejects extraction output that fails schema validation instead of trusting it", async () => {
    const badShape = JSON.stringify({ studentName: "Xavier Davis", gpa: "not a number" });
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: scriptedCaller({ _triage: GOOD_TRIAGE, _extract: badShape }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("extraction_invalid");
  });

  it("handles a model response wrapped in markdown fences", async () => {
    const fenced = "```json\n" + GOOD_TRANSCRIPT + "\n```";
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: scriptedCaller({ _triage: GOOD_TRIAGE, _extract: fenced }),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses to run the unsupported film category without calling the model at all", async () => {
    let called = false;
    const result = await runExtractionPipeline({
      categoryId: "film",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: async () => {
        called = true;
        return "{}";
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("unsupported");
    expect(called).toBe(false);
  });

  it("proceeds to extraction when triage itself throws, same as Bridge's original behavior", async () => {
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: async (opts) => {
        if (opts.requestId.endsWith("_triage")) throw new Error("triage service unavailable");
        return GOOD_TRANSCRIPT;
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.triage).toBeNull();
  });
});

describe("detectCategory", () => {
  const triageOf = (detectedType: string) =>
    JSON.stringify({
      readable: true,
      legibilityScore: 0.9,
      detectedType,
      typeMatchesExpected: true,
      pagesDetected: 1,
      issues: [],
      recommendation: "proceed",
      reason: "ok",
    });

  it("names the category when triage recognizes the document", async () => {
    for (const [detected, expected] of [
      ["transcript", "transcript"],
      ["test_scores", "test_scores"],
      ["offer_letter", "offer_letter"],
      ["recommendation", "recommendation"],
      ["financial_aid", "financial_aid"],
      ["highlight_video_screenshot", "film"],
    ] as const) {
      const result = await detectCategory({
        records: [fakeRecord()],
        callModel: scriptedCaller({ _triage: triageOf(detected) }),
      });
      expect(result.categoryId).toBe(expected);
    }
  });

  // The point of returning null rather than a best guess: a driving
  // licence is not a transcript, and guessing would send the wrong
  // extraction prompt at it and produce confident nonsense.
  it("returns null rather than guessing on something it does not recognize", async () => {
    for (const detected of ["id_document", "other", "unreadable", "something_new"]) {
      const result = await detectCategory({
        records: [fakeRecord()],
        callModel: scriptedCaller({ _triage: triageOf(detected) }),
      });
      expect(result.categoryId).toBeNull();
    }
  });

  it("returns null when triage itself fails", async () => {
    const result = await detectCategory({
      records: [fakeRecord()],
      callModel: async () => {
        throw new Error("model down");
      },
    });
    expect(result).toEqual({ categoryId: null, triage: null });
  });

  it("has nothing to detect from no files", async () => {
    const result = await detectCategory({ records: [], callModel: scriptedCaller({}) });
    expect(result).toEqual({ categoryId: null, triage: null });
  });
});

describe("a metrics report", () => {
  it("extracts dated, sourced metric entries the engine can log", async () => {
    const { runExtractionPipeline } = await import("./pipeline");
    const { createStubCaller } = await import("./stubCaller");
    const { metricsReportSchema } = await import("./schemas");
    const record = {
      originalName: "pbr-profile.pdf",
      originalSize: 2048,
      originalMime: "application/pdf",
      kind: "pdf" as const,
      sourceRole: "coordinator" as const,
      ingestedAt: "2026-09-21T00:00:00.000Z",
      requestId: "req_metrics",
      mediaType: "application/pdf",
      base64: "JVBERi0=",
      blockType: "document" as const,
    };
    const result = await runExtractionPipeline({
      categoryId: "metrics",
      records: [record],
      sourceRole: "coordinator",
      roster: [{ id: "a1", name: "Sample Athlete" }],
      rosterContext: [],
      priorVersions: [],
      callModel: createStubCaller({ category: "metrics", seedText: "pbr-profile.pdf:2048" }),
    });
    if (!result.ok) throw new Error(`${result.stage}: ${result.error}`);
    const parsed = metricsReportSchema.parse(result.extracted);
    expect(parsed.source).toBe("pbr");
    expect(parsed.measuredOn).toBe("2026-08-15");
    expect(parsed.metrics.map((m) => m.key)).toEqual(["fbVelo", "sixty", "exitVelo"]);
  });

  it("refuses a metric key the engine does not know", async () => {
    const { metricsReportSchema } = await import("./schemas");
    const r = metricsReportSchema.safeParse({ source: "pbr", measuredOn: "2026-08", metrics: [{ key: "verticalJump", value: 30 }] });
    expect(r.success).toBe(false);
  });
});
