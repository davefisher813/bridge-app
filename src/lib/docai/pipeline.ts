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
import { ModelJsonParseError, parseModelJson } from "./parseModelJson";
import { buildProvenance, lowLegibilityWarning, NAME_MATCH_AUTO, routeDecision } from "./provenance";
import { findCandidates, nameMatch, type ExtractedIdentity } from "./resolver";
import { classifyAgainstPrior } from "./versioning";
import type { VersionClassification } from "./types";
import { METRIC_PLAUSIBLE, metricPlausible, TEST_TOTAL_RANGE } from "./plausibility";
import { daysAhead } from "./lenient";

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
  // A triage result already in hand, from detectCategory. The pipeline
  // uses it instead of asking again: the detect path used to run
  // triage twice on the same pages, once to name the type and once to
  // check it, which was a second model call and a second wait for no
  // new information.
  priorTriage?: TriageResult | null;
}

export type PipelineStage = "unsupported" | "ingest" | "model_call" | "triage_retake" | "triage_wrong_category" | "extraction_parse" | "extraction_invalid";

export type PipelineResult =
  | { ok: false; stage: PipelineStage; error: string; triage?: TriageResult }
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

// The model could not be reached, refused, or its answer could not be
// recorded. Distinct from a bad answer: a call that failed once will
// fail again, so the pipeline stops rather than paying for a second one.
export class ModelCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCallError";
  }
}

async function callOrThrow(input: PipelineInput, opts: ModelCallOptions): Promise<string> {
  try {
    return await input.callModel(opts);
  } catch (e) {
    throw new ModelCallError((e as Error).message || "The model could not be reached.");
  }
}

// `expected` null means detect mode: the model is asked what the pages
// are, and told nothing to compare against, so `typeMatchesExpected`
// and `wrong_category` are not meaningful and the caller ignores them.
async function runTriage(input: PipelineInput, requestId: string, expected: DocCategoryId | null): Promise<TriageResult | null> {
  const systemPrompt =
    "You are a document triage assistant for a youth sports recruiting platform. You receive 1+ images or PDF pages and must rapidly assess whether they can be processed for structured data extraction.\n\n" +
    "Return ONLY valid JSON, no markdown, with this exact schema:\n" +
    '{\n  "readable": boolean,\n  "legibilityScore": number 0-1,\n  "detectedType": "transcript" | "test_scores" | "offer_letter" | "recommendation" | "financial_aid" | "metrics_report" | "highlight_video_screenshot" | "id_document" | "other" | "unreadable",\n  "typeMatchesExpected": boolean,\n  "pagesDetected": number,\n  "issues": ["array of short specific problems"],\n  "recommendation": "proceed" | "retake" | "wrong_category" | "partial_only",\n  "reason": "1-2 sentence explanation"\n}\n\n' +
    "Type guide: transcript is a school's record of courses and grades; test_scores is an SAT, ACT, PSAT or AP score report; offer_letter is a college's athletic or admissions offer; recommendation is a letter about the student written by a coach, teacher or counselor; financial_aid is a FAFSA report, CSS Profile, award letter or EFC report; metrics_report is a showcase profile, event results sheet, scouting report or a measured-metrics dashboard (PBR, Perfect Game, Rapsodo, a combine); highlight_video_screenshot is a still from a video; id_document is a licence, passport or school ID.\n\n" +
    "legibilityScore is how much of the text a careful reader could make out: 1.0 is a clean print, below 0.6 means material text is guesswork. Recommend retake if anything material is illegible or cropped. Recommend partial_only if some pages or sections are usable and others are not, and list which in issues. Do NOT extract data; this is triage only.";
  const userText = expected
    ? `Expected category: ${getCategory(expected).triageType}\nFiles attached: ${input.records.length}\n\nAssess and return JSON only.`
    : `Expected category: not specified. Name what these pages are in detectedType and set typeMatchesExpected to true.\nFiles attached: ${input.records.length}\n\nAssess and return JSON only.`;

  const text = await callOrThrow(input, {
    model: input.triageModel || DEFAULT_TRIAGE_MODEL,
    maxTokens: 600,
    system: systemPrompt,
    userText,
    records: input.records,
    requestId: `${requestId}_triage`,
  });
  try {
    return triageResultSchema.parse(parseModelJson(text));
  } catch {
    // A triage answer that cannot be read is not fatal, same as Bridge:
    // proceed to extraction rather than blocking the whole upload on a
    // pre-flight check. A call that FAILED is different and is thrown
    // through, see callOrThrow.
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

export type DetectResult =
  | { ok: true; categoryId: DocCategoryId | null; triage: TriageResult | null }
  | { ok: false; error: string; categoryId: null; triage: null };

export async function detectCategory(input: DetectInput): Promise<DetectResult> {
  if (!input.records.length) return { ok: true, categoryId: null, triage: null };
  const requestId = input.records[0]!.requestId;

  let triage: TriageResult | null;
  try {
    triage = await runTriage(
      {
        categoryId: "transcript",
        records: input.records,
        callModel: input.callModel,
        triageModel: input.triageModel,
      } as PipelineInput,
      requestId,
      null
    );
  } catch (e) {
    return { ok: false, error: (e as Error).message, categoryId: null, triage: null };
  }
  if (!triage) return { ok: true, categoryId: null, triage: null };
  return { ok: true, categoryId: DETECTED_TO_CATEGORY[triage.detectedType] ?? null, triage };
}

// The extraction answer, once the schema has accepted it, checked for
// the things a schema cannot see: a metric that is the wrong unit, a
// test total the agency does not score, a date in the future, a field
// the record needs that the page did not carry. Each finding becomes a
// warning on the document and, where the value is unusable, the value
// is dropped so nothing downstream has to know. Returns whether the
// document should be kept from auto-applying.
function sanityCheck(categoryId: DocCategoryId, extracted: Record<string, unknown>, warnings: string[], now: Date): { holdForReview: boolean } {
  let hold = false;
  const warn = (s: string) => {
    if (!warnings.includes(s)) warnings.push(s);
  };
  const future = (label: string, v: unknown, allowance = 1) => {
    if (typeof v === "string" && daysAhead(v, now) > allowance) {
      warn(`The ${label} (${v}) is in the future, which is a misread.`);
      hold = true;
      return true;
    }
    return false;
  };

  if (categoryId === "transcript") {
    if (!extracted.school) warn("No school name was read off this transcript.");
    if (extracted.gradYear == null) warn("No graduation year was read off this transcript.");
    const courses = Array.isArray(extracted.courses) ? extracted.courses : [];
    if (extracted.gpa == null && courses.length === 0) {
      warn("Neither a GPA nor a course list was read, so there is nothing here to put on a record.");
      hold = true;
    }
    if (extracted.gpa != null && typeof extracted.gpa === "number" && (extracted.gpa < 0 || extracted.gpa > 110)) {
      warn(`A GPA of ${extracted.gpa} is not on any scale, so it was dropped.`);
      extracted.gpa = null;
      hold = true;
    }
    if (typeof extracted.dateOfBirth === "string") {
      if (future("date of birth", extracted.dateOfBirth, 0) || daysAhead(extracted.dateOfBirth, now) > -10 * 365) {
        warn(`The date of birth read (${extracted.dateOfBirth}) is not a high school student's, so it was dropped.`);
        extracted.dateOfBirth = null;
        hold = true;
      }
    }
  }

  if (categoryId === "test_scores") {
    const tests = Array.isArray(extracted.tests) ? (extracted.tests as Record<string, unknown>[]) : [];
    for (const t of tests) {
      const range = TEST_TOTAL_RANGE[String(t.type)];
      if (range && typeof t.totalScore === "number" && (t.totalScore < range[0] || t.totalScore > range[1])) {
        warn(`A ${t.type} total of ${t.totalScore} is outside ${range[0]} to ${range[1]}, so it was dropped.`);
        t.totalScore = null;
        hold = true;
      }
      if (typeof t.testDate === "string") future("test date", t.testDate);
    }
  }

  if (categoryId === "offer_letter") {
    if (typeof extracted.offerDate === "string") future("offer date", extracted.offerDate, 7);
    if (typeof extracted.decisionDeadline === "string" && typeof extracted.offerDate === "string" && extracted.decisionDeadline < extracted.offerDate) {
      warn("The decision deadline is before the offer date, so one of them was misread.");
      hold = true;
    }
  }

  if (categoryId === "recommendation") {
    if (typeof extracted.letterDate === "string") future("letter date", extracted.letterDate, 7);
  }

  if (categoryId === "financial_aid") {
    const total = extracted.totalCostOfAttendance;
    const net = extracted.netCost;
    if (typeof total === "number" && typeof net === "number" && net > total) {
      warn("The net cost read is higher than the cost of attendance, so one of them was misread.");
      hold = true;
    }
    if (typeof total === "number" && total > 150000) {
      warn(`A cost of attendance of ${total} is not a yearly figure, so it was dropped.`);
      extracted.totalCostOfAttendance = null;
      hold = true;
    }
  }

  if (categoryId === "metrics") {
    const items = Array.isArray(extracted.metrics) ? (extracted.metrics as { key: string; value: number }[]) : [];
    const kept = items.filter((m) => {
      if (metricPlausible(m.key, m.value)) return true;
      const r = METRIC_PLAUSIBLE[m.key];
      warn(`${m.key} read as ${m.value}, which is not ${r ? r.hint : "a reading"}, so it was left out.`);
      hold = true;
      return false;
    });
    extracted.metrics = kept;
    if (kept.length === 0) {
      warn("None of the numbers read were plausible readings, so nothing from this can be logged.");
    }
    if (typeof extracted.measuredOn === "string") future("measured-on date", extracted.measuredOn);
  }

  return { holdForReview: hold };
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
  const reusedTriage = input.priorTriage !== undefined;
  let triage: TriageResult | null;
  try {
    triage = reusedTriage ? (input.priorTriage ?? null) : await runTriage(input, requestId, input.categoryId);
  } catch (e) {
    return { ok: false, stage: "model_call", error: `The document could not be read: ${(e as Error).message}` };
  }

  if (triage && (triage.recommendation === "retake" || triage.detectedType === "unreadable")) {
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
  //
  // A reused triage came from detect mode, where the category was
  // chosen FROM the detected type, so the mismatch checks are skipped:
  // there is nothing to mismatch. The same refusal applies when the
  // model said "proceed" but named a different supported type: it is
  // the same disagreement with a politer recommendation.
  if (!reusedTriage && triage) {
    const detected = DETECTED_TO_CATEGORY[triage.detectedType];
    const namesAnotherType = detected !== undefined && detected !== null && detected !== input.categoryId;
    if (triage.recommendation === "wrong_category" || (!triage.typeMatchesExpected && namesAnotherType)) {
      const what = triage.detectedType === "other" ? "something else" : triage.detectedType.replace(/_/g, " ");
      return {
        ok: false,
        stage: "triage_wrong_category",
        error: `This looks like ${what}, not a ${cat.label.toLowerCase()}. ${triage.issues[0] || triage.reason}`,
        triage,
      };
    }
  }

  const systemPrompt = buildExtractionSystemPrompt(input.categoryId, input.rosterContext, input.override);
  const userText = `${input.records.length} file(s) attached. Extract data and return ONLY the JSON object.`;

  let rawText: string;
  try {
    rawText = await callOrThrow(input, {
      model: input.extractionModel || DEFAULT_EXTRACTION_MODEL,
      maxTokens: 8000,
      system: systemPrompt,
      userText,
      records: input.records,
      requestId: `${requestId}_extract`,
    });
  } catch (e) {
    return { ok: false, stage: "model_call", error: `The document could not be read: ${(e as Error).message}`, triage: triage ?? undefined };
  }

  let rawJson: unknown;
  try {
    rawJson = parseModelJson(rawText);
  } catch (e) {
    const msg = e instanceof ModelJsonParseError ? "The model's answer was not the JSON it was asked for." : (e as Error).message;
    return { ok: false, stage: "extraction_parse", error: msg, triage: triage ?? undefined };
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
  const warnings: string[] = [...(extracted.warnings ?? [])];
  let holdForReview = false;

  const warning = lowLegibilityWarning(triage?.legibilityScore ?? null);
  if (warning) warnings.push(warning);

  // Triage said part of the document is unusable. What was read may
  // well be right, and it may be from the pages that were, so it is a
  // human's call.
  if (triage?.recommendation === "partial_only") {
    warnings.push(`Only part of this document was readable: ${triage.issues.join("; ") || triage.reason}`);
    holdForReview = true;
  }

  // The model's own doubt, in its own words, and the values a schema
  // cannot judge.
  if (extracted.confidence != null && extracted.confidence < 0.3) {
    warnings.push("The model reported very low confidence in what it read.");
  }
  if (sanityCheck(input.categoryId, extracted, warnings, new Date()).holdForReview) holdForReview = true;

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
    warnings.push("No athlete on this roster matches the name on this document.");
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
    warnings.push("This document does not name the student, so the athlete was set by hand and needs confirming.");
  }

  // The upload was pinned to an athlete (started from their page), and
  // the page names somebody else. The pin scores 1.0 in the resolver by
  // design, which is exactly what would have written one athlete's
  // transcript onto another's record without anybody looking. The name
  // on the page outranks the page the upload started from.
  const pinned = candidates[0]?.reasons.some((r) => r.startsWith("User override")) ? candidates[0] : null;
  if (pinned && identity.studentName) {
    const agreement = nameMatch(pinned.athlete.name, identity.studentName);
    if (agreement < NAME_MATCH_AUTO) {
      if (route === "auto_apply") route = "review";
      warnings.push(`This document names "${identity.studentName}", which does not look like ${pinned.athlete.name}. Check it is theirs before applying.`);
    }
  }

  if (holdForReview && route === "auto_apply") route = "review";

  extracted.warnings = warnings;

  const versionClassification = classifyAgainstPrior(
    { gpa: (extracted as { gpa?: number }).gpa ?? null, gradYear: (extracted as { gradYear?: number }).gradYear ?? null },
    input.priorVersions
  );

  return { ok: true, extracted, triage, provenance, route, candidates, versionClassification };
}
