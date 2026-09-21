// Orchestration: ingest -> triage -> extract -> validate -> route.
// Faithful port of Bridge's EngineBridge.processOneFile
// (bffsa-site/index.html ~lines 2608-2669) plus its EX-10 low-legibility
// downgrade, decoupled from Bridge's global `D` object and from any
// specific model SDK. The caller supplies a `ModelCaller` (a thin
// wrapper around whatever calls the Anthropic API), which is what makes
// this file testable without a real API key or network access, and
// swappable if the model or provider ever changes.
//
// Two deliberate departures from Bridge's version, both documented in
// docs/DECISIONS.md:
//   1. Extraction output is validated against a Zod schema
//      (categories.ts / schemas.ts) before anything downstream sees it.
//      Bridge trusted raw JSON.parse output completely.
//   2. This function returns a result; it never writes to a database or
//      a review queue itself. Bridge's applyTranscriptToAthlete wrote
//      straight into the global D object. Persisting the result (auto
//      apply vs. review queue vs. reject) is the caller's job, because
//      that's where org_id, RLS, and the actual athlete row live.

import type { DocCategoryId, IngestedRecord, ProvenanceInfo, ResolverAthlete, RouteDecision, SourceRole, TriageResult, VersionEntry } from "./types";
import { buildExtractionSystemPrompt, getCategory } from "./categories";
import { CATEGORY_SCHEMAS } from "./categories";
import { triageResultSchema } from "./schemas";
import { parseModelJson } from "./parseModelJson";
import { buildProvenance, lowLegibilityWarning, routeDecision } from "./provenance";
import { findCandidates, type ExtractedIdentity } from "./resolver";
import { classifyAgainstPrior } from "./versioning";
import type { VersionClassification } from "./types";

export interface ModelCallOptions {
  model: string;
  maxTokens: number;
  system: string;
  userText: string;
  records: IngestedRecord[];
  requestId: string;
}

// Returns the model's raw text response. The caller's implementation is
// responsible for actually calling the Anthropic API (or whatever
// provider), including auth, retries, and budget tracking - none of
// which this file knows about. See docs/ARCHITECTURE.md for why that
// split exists and what's still unbuilt on the caller's side.
export type ModelCaller = (opts: ModelCallOptions) => Promise<string>;

export interface PipelineInput {
  categoryId: DocCategoryId;
  records: IngestedRecord[];
  sourceRole: SourceRole;
  override?: string;
  roster: ResolverAthlete[];
  rosterContext: unknown[]; // what actually goes in the extraction prompt; may carry more than the resolver needs
  priorVersions: VersionEntry[];
  callModel: ModelCaller;
  triageModel?: string;
  extractionModel?: string;
}

export type PipelineResult =
  | { ok: false; stage: "unsupported" | "ingest" | "triage_retake" | "triage_wrong_category" | "extraction_parse" | "extraction_invalid"; error: string; triage?: TriageResult }
  | {
      ok: true;
      extracted: Record<string, unknown>;
      triage: TriageResult | null;
      provenance: ProvenanceInfo;
      route: RouteDecision;
      candidates: ReturnType<typeof findCandidates>;
      versionClassification: VersionClassification;
    };

// Triage is a cheap classification, so the small model; extraction is
// where the reading happens, so the most capable one.
const DEFAULT_TRIAGE_MODEL = "claude-haiku-4-5";
const DEFAULT_EXTRACTION_MODEL = "claude-opus-5";

async function runTriage(input: PipelineInput, requestId: string): Promise<TriageResult | null> {
  const cat = getCategory(input.categoryId);
  const systemPrompt =
    "You are a document triage assistant for a youth sports recruiting platform. You receive 1+ images or PDF pages and must rapidly assess whether they can be processed for structured data extraction.\n\n" +
    "Return ONLY valid JSON, no markdown, with this exact schema:\n" +
    '{\n  "readable": boolean,\n  "legibilityScore": number 0-1,\n  "detectedType": "transcript" | "test_scores" | "offer_letter" | "recommendation" | "financial_aid" | "metrics_report" | "highlight_video_screenshot" | "id_document" | "other" | "unreadable",\n  "typeMatchesExpected": boolean,\n  "pagesDetected": number,\n  "issues": ["array of short specific problems"],\n  "recommendation": "proceed" | "retake" | "wrong_category" | "partial_only",\n  "reason": "1-2 sentence explanation"\n}\n\n' +
    "Be strict. If anything material is illegible or cropped, recommend retake. Do NOT extract data; this is triage only.";
  const userText = `Expected category: ${cat.triageType}\nFiles attached: ${input.records.length}\n\nAssess and return JSON only.`;

  try {
    const text = await input.callModel({
      model: input.triageModel || DEFAULT_TRIAGE_MODEL,
      maxTokens: 600,
      system: systemPrompt,
      userText,
      records: input.records,
      requestId: `${requestId}_triage`,
    });
    const parsed = triageResultSchema.parse(parseModelJson(text));
    return parsed;
  } catch {
    // Triage failing is not fatal, same as Bridge: proceed to extraction
    // anyway rather than blocking the whole upload on a pre-flight check.
    return null;
  }
}

// Dave wants both ways in: triage names the document type by default, and
// he can force one up front (see docs/DECISIONS.md). The pipeline itself
// takes a categoryId as an input, so detection is a separate pass that
// runs triage on its own first and hands the answer back.
//
// The triage prompt already returns `detectedType` regardless of what
// category it was told to expect, so this costs one triage call and no new
// prompt. It is a different job from runTriage's: that one asks "is this
// readable and does it match what you were told", this one asks "what is
// it".
const DETECTED_TO_CATEGORY: Record<string, DocCategoryId | null> = {
  transcript: "transcript",
  test_scores: "test_scores",
  offer_letter: "offer_letter",
  recommendation: "recommendation",
  financial_aid: "financial_aid",
  // A showcase profile, an event results sheet, a metrics dashboard.
  metrics_report: "metrics",
  highlight_video_screenshot: "film",
  // A driving licence, a random page, or something unreadable is not a
  // category. Null means "ask the user", never a guess.
  id_document: null,
  other: null,
  unreadable: null,
};

export interface DetectInput {
  records: IngestedRecord[];
  callModel: ModelCaller;
  triageModel?: string;
}

export interface DetectResult {
  categoryId: DocCategoryId | null;
  triage: TriageResult | null;
}

export async function detectCategory(input: DetectInput): Promise<DetectResult> {
  if (!input.records.length) return { categoryId: null, triage: null };
  const requestId = input.records[0]!.requestId;

  // Told to expect nothing in particular, so `typeMatchesExpected` is
  // meaningless here and deliberately ignored by the caller.
  const triage = await runTriage(
    {
      categoryId: "transcript",
      records: input.records,
      callModel: input.callModel,
      triageModel: input.triageModel,
    } as PipelineInput,
    requestId
  );
  if (!triage) return { categoryId: null, triage: null };
  return { categoryId: DETECTED_TO_CATEGORY[triage.detectedType] ?? null, triage };
}

export async function runExtractionPipeline(input: PipelineInput): Promise<PipelineResult> {
  const cat = getCategory(input.categoryId);
  if (cat.shape === "unsupported") {
    return { ok: false, stage: "unsupported", error: cat.unsupportedMessage || "Unsupported document type" };
  }
  if (!input.records.length) {
    return { ok: false, stage: "ingest", error: "No files to process" };
  }

  const requestId = input.records[0]!.requestId;
  const triage = await runTriage(input, requestId);

  if (triage && triage.recommendation === "retake") {
    return { ok: false, stage: "triage_retake", error: `Document not readable: ${triage.issues[0] || triage.reason}`, triage };
  }

  // `wrong_category` was in the triage schema and in the triage prompt
  // from the start, and nothing ever read it. Running a real Elite Squad
  // player profile through the pipeline as a transcript showed the cost:
  // triage correctly answered detectedType "other", recommendation
  // "wrong_category", and the pipeline extracted it as a transcript
  // anyway and offered a self-reported profile-sheet GPA for review as
  // though it came off a school document. Refusing here is what makes
  // the forced-category path safe to offer.
  if (triage && triage.recommendation === "wrong_category") {
    const detected = triage.detectedType === "other" ? "something else" : triage.detectedType.replace(/_/g, " ");
    return {
      ok: false,
      stage: "triage_wrong_category",
      error: `This looks like ${detected}, not a ${cat.label.toLowerCase()}. ${triage.issues[0] || triage.reason}`,
      triage,
    };
  }

  const lowLegibility = triage != null && triage.legibilityScore < 0.6;

  const systemPrompt = buildExtractionSystemPrompt(input.categoryId, input.rosterContext, input.override);
  const userText = `${input.records.length} file(s) attached. Extract data and return ONLY the JSON object.`;

  let rawText: string;
  try {
    rawText = await input.callModel({
      model: input.extractionModel || DEFAULT_EXTRACTION_MODEL,
      maxTokens: 2000,
      system: systemPrompt,
      userText,
      records: input.records,
      requestId: `${requestId}_extract`,
    });
  } catch (e) {
    return { ok: false, stage: "extraction_parse", error: `Extraction call failed: ${(e as Error).message}`, triage: triage ?? undefined };
  }

  let rawJson: unknown;
  try {
    rawJson = parseModelJson(rawText);
  } catch (e) {
    return { ok: false, stage: "extraction_parse", error: (e as Error).message, triage: triage ?? undefined };
  }

  const schema = CATEGORY_SCHEMAS[cat.id as keyof typeof CATEGORY_SCHEMAS];
  const validated = schema.safeParse(rawJson);
  if (!validated.success) {
    return {
      ok: false,
      stage: "extraction_invalid",
      error: `Model output didn't match the ${cat.label} schema: ${validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      triage: triage ?? undefined,
    };
  }

  const extracted = validated.data as Record<string, unknown> & { confidence?: number | null; warnings?: string[] };

  const warning = lowLegibilityWarning(triage?.legibilityScore ?? null);
  if (warning) {
    extracted.warnings = [...(extracted.warnings ?? []), warning];
  }

  const provenance = buildProvenance(extracted.confidence ?? null, input.sourceRole, triage?.legibilityScore ?? null, requestId);

  const identity: ExtractedIdentity = {
    studentName: (extracted as { studentName?: string }).studentName ?? null,
    school: (extracted as { school?: string }).school ?? null,
    gradYear: (extracted as { gradYear?: number }).gradYear ?? null,
  };
  const candidates = findCandidates(identity, input.roster, input.override);
  const topScore = candidates[0]?.score ?? null;
  const runnerUpScore = candidates[1]?.score ?? null;

  let route = routeDecision(provenance.confidence, topScore, runnerUpScore);

  // Nobody on the roster resembles the name on the document. That is not
  // a high-confidence result, it is an athlete who has not been added
  // yet, and routeDecision cannot see it because a null score skips its
  // identity checks entirely. Auto-applying here would mean writing to
  // no record at all.
  if (!candidates.length) {
    if (route === "auto_apply") route = "review";
    extracted.warnings = [...(extracted.warnings ?? []), "No athlete on this roster matches the name on this document."];
  }

  // A transcript that never prints the student's name is a real and
  // common export (Alma and similar portals put the name in page
  // furniture that does not survive print-to-PDF). It used to be
  // rejected outright by the schema. It is now allowed through, but the
  // only thing tying it to an athlete is whoever typed the override, so
  // it never auto-applies: a human says whose it is, and a human
  // confirms it.
  if (!identity.studentName) {
    if (route === "auto_apply") route = "review";
    extracted.warnings = [...(extracted.warnings ?? []), "This document does not name the student, so the athlete was set by hand and needs confirming."];
  }
  const versionClassification = classifyAgainstPrior(
    { gpa: (extracted as { gpa?: number }).gpa ?? null, gradYear: (extracted as { gradYear?: number }).gradYear ?? null },
    input.priorVersions
  );

  return { ok: true, extracted, triage, provenance, route, candidates, versionClassification };
}
