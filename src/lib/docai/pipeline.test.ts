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

  it("proceeds to extraction when triage answers something unreadable, same as Bridge's original behavior", async () => {
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: async (opts) => {
        if (opts.requestId.endsWith("_triage")) return "I cannot assess this.";
        return GOOD_TRANSCRIPT;
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.triage).toBeNull();
  });

  it("stops after a triage CALL fails rather than paying for an extraction that will fail the same way", async () => {
    const calls: string[] = [];
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: async (opts) => {
        calls.push(opts.requestId);
        throw new Error("budget ledger unavailable");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("model_call");
      expect(result.error).toMatch(/budget ledger unavailable/);
    }
    expect(calls).toEqual(["r_test_1_triage"]);
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

  it("says so when the triage call itself fails", async () => {
    const result = await detectCategory({
      records: [fakeRecord()],
      callModel: async () => {
        throw new Error("model down");
      },
    });
    expect(result).toEqual({ ok: false, error: "model down", categoryId: null, triage: null });
  });

  it("has nothing to detect from no files", async () => {
    const result = await detectCategory({ records: [], callModel: scriptedCaller({}) });
    expect(result).toEqual({ ok: true, categoryId: null, triage: null });
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

describe("the guards against a misread", () => {
  const rec = () => fakeRecord();
  const base = { records: [rec()], sourceRole: "admin" as const, roster, rosterContext: roster, priorVersions: [] };
  const triage = (over: Record<string, unknown>) =>
    JSON.stringify({ readable: true, legibilityScore: 0.95, detectedType: "transcript", typeMatchesExpected: true, pagesDetected: 1, issues: [], recommendation: "proceed", reason: "ok", ...over });

  it("a triage already in hand is used, not asked for again", async () => {
    const calls: string[] = [];
    const result = await runExtractionPipeline({
      ...base,
      categoryId: "transcript",
      priorTriage: JSON.parse(triage({})) ,
      callModel: async (opts) => {
        calls.push(opts.requestId);
        return GOOD_TRANSCRIPT;
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["r_test_1_extract"]);
  });

  it("a partly readable document is never applied on its own", async () => {
    const result = await runExtractionPipeline({
      ...base,
      categoryId: "transcript",
      callModel: scriptedCaller({ _triage: triage({ recommendation: "partial_only", issues: ["Page 2 is cut off"] }), _extract: GOOD_TRANSCRIPT }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("review");
      expect(result.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Only part of this document/)]));
    }
  });

  it("triage naming another supported type is a wrong category even when it says proceed", async () => {
    const result = await runExtractionPipeline({
      ...base,
      categoryId: "transcript",
      callModel: scriptedCaller({ _triage: triage({ detectedType: "test_scores", typeMatchesExpected: false }), _extract: GOOD_TRANSCRIPT }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe("triage_wrong_category");
  });

  it("a page that names someone other than the athlete it was pinned to goes to review", async () => {
    const two: ResolverAthlete[] = [...roster, { id: "2", name: "Marcus Lee", school: "Stamford High", gradYear: 2027 }];
    const result = await runExtractionPipeline({
      ...base,
      roster: two,
      rosterContext: two,
      categoryId: "transcript",
      override: "Marcus Lee",
      callModel: scriptedCaller({ _triage: triage({}), _extract: GOOD_TRANSCRIPT }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates[0]?.athlete.id).toBe("2");
      expect(result.route).toBe("review");
      expect(result.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/names "Xavier Davis", which does not look like Marcus Lee/)]));
    }
  });

  it("a pinned upload whose page agrees still applies on its own", async () => {
    const result = await runExtractionPipeline({
      ...base,
      categoryId: "transcript",
      override: "Xavier Davis",
      callModel: scriptedCaller({ _triage: triage({}), _extract: GOOD_TRANSCRIPT }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.route).toBe("auto_apply");
  });

  it("a transcript with neither a GPA nor a course list is held for a human", async () => {
    const empty = JSON.stringify({ ...JSON.parse(GOOD_TRANSCRIPT), gpa: null, courses: [] });
    const result = await runExtractionPipeline({ ...base, categoryId: "transcript", callModel: scriptedCaller({ _triage: triage({}), _extract: empty }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("review");
      expect(result.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/nothing here to put on a record/)]));
    }
  });

  it("a date of birth that is not a student's is dropped rather than written", async () => {
    const odd = JSON.stringify({ ...JSON.parse(GOOD_TRANSCRIPT), dateOfBirth: "2024-03-15" });
    const result = await runExtractionPipeline({ ...base, categoryId: "transcript", callModel: scriptedCaller({ _triage: triage({}), _extract: odd }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.extracted.dateOfBirth).toBeNull();
      expect(result.route).toBe("review");
    }
  });

  it("a metric that is not a plausible reading is left out and named", async () => {
    const report = JSON.stringify({ studentName: "Xavier Davis", source: "pbr", measuredOn: "2026-08-15", metrics: [{ key: "fbVelo", value: 8.8 }, { key: "sixty", value: 6.9 }], confidence: 0.97, warnings: [] });
    const result = await runExtractionPipeline({ ...base, categoryId: "metrics", callModel: scriptedCaller({ _triage: triage({ detectedType: "metrics_report" }), _extract: report }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.extracted.metrics as { key: string }[]).map((m) => m.key)).toEqual(["sixty"]);
      expect(result.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/fbVelo read as 8.8/)]));
      expect(result.route).toBe("review");
    }
  });

  it("a measurement dated in the future is a misread, not a reading", async () => {
    const report = JSON.stringify({ studentName: "Xavier Davis", source: "pbr", measuredOn: "2099-08-15", metrics: [{ key: "fbVelo", value: 88 }], confidence: 0.97, warnings: [] });
    const result = await runExtractionPipeline({ ...base, categoryId: "metrics", callModel: scriptedCaller({ _triage: triage({ detectedType: "metrics_report" }), _extract: report }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("review");
      expect(result.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/in the future/)]));
    }
  });

  it("an SAT total the agency cannot have scored is dropped", async () => {
    const report = JSON.stringify({ studentName: "Xavier Davis", tests: [{ type: "SAT", testDate: "2026-04-11", totalScore: 12500 }], confidence: 0.97, warnings: [] });
    const result = await runExtractionPipeline({ ...base, categoryId: "test_scores", callModel: scriptedCaller({ _triage: triage({ detectedType: "test_scores" }), _extract: report }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.extracted.tests as { totalScore: number | null }[])[0]!.totalScore).toBeNull();
      expect(result.route).toBe("review");
    }
  });

  it("the model's own doubt is kept on the document, in its words", async () => {
    const doubtful = JSON.stringify({ ...JSON.parse(GOOD_TRANSCRIPT), warnings: ["The GPA cell was smudged; 3.7 could be 3.1"], confidence: 0.5 });
    const result = await runExtractionPipeline({ ...base, categoryId: "transcript", callModel: scriptedCaller({ _triage: triage({}), _extract: doubtful }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("review");
      expect(result.extracted.warnings).toContain("The GPA cell was smudged; 3.7 could be 3.1");
    }
  });
});

describe("the stub drives every supported category through its own schema", () => {
  for (const c of ["transcript", "test_scores", "offer_letter", "recommendation", "financial_aid", "metrics"] as const) {
    it(`${c} reads to a result, not a schema failure`, async () => {
      const { createStubCaller } = await import("./stubCaller");
      const result = await runExtractionPipeline({
        categoryId: c,
        records: [fakeRecord()],
        sourceRole: "coordinator",
        roster: [{ id: "a1", name: "Sample Athlete" }],
        rosterContext: [],
        priorVersions: [],
        callModel: createStubCaller({ category: c, seedText: "clean-scan.pdf:9000" }),
      });
      if (!result.ok) throw new Error(`${c}: ${result.stage} ${result.error}`);
      expect(["auto_apply", "review"]).toContain(result.route);
    });
  }
});

describe("the shapes a model wraps its answer in", () => {
  it("one extra layer around the object is unwrapped", async () => {
    const wrapped = JSON.stringify({ transcript: JSON.parse(GOOD_TRANSCRIPT) });
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: scriptedCaller({ _triage: GOOD_TRIAGE, _extract: wrapped }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.extracted.gpa).toBe(3.7);
  });

  it("a page that lists several students is not forced onto one", async () => {
    const sheet = JSON.stringify({ ...JSON.parse(GOOD_TRANSCRIPT), studentName: null, confidence: 0.2, warnings: ["The page lists several students."] });
    const result = await runExtractionPipeline({
      categoryId: "transcript",
      records: [fakeRecord()],
      sourceRole: "admin",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: scriptedCaller({ _triage: GOOD_TRIAGE, _extract: sheet }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("reject");
      expect(result.extracted.warnings).toContain("The page lists several students.");
    }
  });

  it("a college transcript is flagged, a middle school one is held", async () => {
    const college = JSON.stringify({ ...JSON.parse(GOOD_TRANSCRIPT), level: "College" });
    const r1 = await runExtractionPipeline({ categoryId: "transcript", records: [fakeRecord()], sourceRole: "admin", roster, rosterContext: roster, priorVersions: [], callModel: scriptedCaller({ _triage: GOOD_TRIAGE, _extract: college }) });
    expect(r1.ok && r1.extracted.level).toBe("college");
    expect(r1.ok && r1.extracted.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/college transcript/)]));
    const middle = JSON.stringify({ ...JSON.parse(GOOD_TRANSCRIPT), level: "middle_school" });
    const r2 = await runExtractionPipeline({ categoryId: "transcript", records: [fakeRecord()], sourceRole: "admin", roster, rosterContext: roster, priorVersions: [], callModel: scriptedCaller({ _triage: GOOD_TRIAGE, _extract: middle }) });
    expect(r2.ok && r2.route).toBe("review");
  });
});
