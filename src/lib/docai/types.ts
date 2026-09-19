// Doc AI: document upload + structured-data extraction. Rebuild of
// Bridge's Engine/EngineBridge (bffsa-site/index.html ~lines 1621-2660,
// 13358-14973). Unlike the fit engine, Bridge's Doc AI pipeline was
// already coherent, config-driven design (a categories registry, not a
// patch stack) - see docs/ARCHITECTURE.md for what's a faithful port vs.
// a genuine redesign here.

export type DocCategoryId = "transcript" | "test_scores" | "offer_letter" | "recommendation" | "financial_aid" | "film";

// A category's extraction "shape" says how the parsed JSON gets applied
// to an athlete record: field_update overwrites scalar fields (a
// transcript replaces GPA/course-rigor fields), collection_append adds
// an item to an array the athlete already has (a new test score, a new
// offer), unsupported means the pipeline stops at triage.
export type ExtractionShape = "field_update" | "collection_append" | "unsupported";

export interface DocCategory {
  id: DocCategoryId;
  label: string;
  shape: ExtractionShape;
  collectionKey?: string; // e.g. "tests", "offers" - required when shape is collection_append
  triageType: string; // matches the triage model's detectedType enum
  extractionPrompt: string;
  unsupportedMessage?: string;
}

// A single ingested file, ready to send to the model. mediaType/base64
// mirror the Anthropic content-block shape directly so toContentBlocks()
// is a trivial map, same as Bridge's ingest.toContentBlocks.
export interface IngestedRecord {
  originalName: string;
  originalSize: number;
  originalMime: string;
  kind: "pdf" | "image" | "heic" | "unknown";
  sourceRole: SourceRole;
  ingestedAt: string;
  requestId: string;
  mediaType: string;
  base64: string;
  blockType: "document" | "image";
  width?: number;
  height?: number;
  normalizedSkipped?: boolean;
  fallbackReason?: string;
}

// What the server receives once the browser has put a file in Storage:
// everything an IngestedRecord carries except the bytes, plus where the
// bytes are. The server reads them back and rebuilds the IngestedRecord
// the pipeline expects. Base64 never rides a request body: a server
// action's body is capped at 1MB by Next and a scanned transcript is not.
export type StoredRecord = Omit<IngestedRecord, "base64"> & { storagePath: string };

export type SourceRole = "admin" | "coordinator" | "email" | "parent" | "athlete";

export interface TriageResult {
  readable: boolean;
  legibilityScore: number;
  detectedType: string;
  typeMatchesExpected: boolean;
  pagesDetected: number;
  issues: string[];
  recommendation: "proceed" | "retake" | "wrong_category" | "partial_only";
  reason: string;
}

export interface ProvenanceInfo {
  source: "ai";
  sourceRole: SourceRole;
  confidence: number; // effective confidence: model confidence x role weight x legibility
  modelConfidence: number | null;
  legibility: number | null;
  ts: string;
  requestId: string | null;
}

export type ConfidenceTier = "high" | "medium" | "low";

export type RouteDecision = "auto_apply" | "review" | "reject";

export interface VersionEntry {
  requestId: string;
  category: DocCategoryId;
  gpa?: number | null;
  gradYear?: number | null;
  ts: string;
}

export type VersionClassification =
  | { kind: "first" }
  | { kind: "likely_replacement"; latest: VersionEntry; reason: string }
  | { kind: "new_period"; latest: VersionEntry };

// Minimal roster-row shape the resolver needs. The real Athlete type
// (src/lib/fit/types.ts) has more fields; the resolver only needs these.
export interface ResolverAthlete {
  id: string;
  name: string;
  school?: string;
  gradYear?: number;
}

export interface ResolverCandidate {
  athlete: ResolverAthlete;
  score: number;
  reasons: string[];
}

// Shape of what a model call returns, before category-specific Zod
// validation. Every category's extraction schema also carries these.
export interface ExtractedBase {
  confidence?: number | null;
  warnings?: string[];
}
