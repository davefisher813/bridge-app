// Confidence scoring and the auto-apply/review/reject routing decision.
// Faithful port of Bridge's Engine.provenance (bffsa-site/index.html
// ~lines 2356-2383) plus its EX-3/EX-10 confidence-routing constants and
// low-legibility downgrade (~lines 2648-2664, 2787-2790).

import type { ConfidenceTier, ProvenanceInfo, RouteDecision, SourceRole } from "./types";

// Same role weights Bridge used: an admin-uploaded document is trusted
// more than one forwarded by a parent or scraped from an email, because
// the upload path itself carries information about how likely the file
// is to be the right one for the right athlete.
export const ROLE_WEIGHTS: Record<SourceRole, number> = {
  admin: 1.0,
  coordinator: 0.95,
  email: 0.9,
  parent: 0.8,
  athlete: 0.75,
};

export function effectiveConfidence(modelConfidence: number | null | undefined, sourceRole: SourceRole, triageLegibility: number | null | undefined): number {
  const m = modelConfidence == null ? 0.7 : modelConfidence;
  const r = ROLE_WEIGHTS[sourceRole] ?? 0.8;
  const l = triageLegibility == null ? 1.0 : triageLegibility;
  return Math.max(0, Math.min(1, m * r * l));
}

export function classifyConfidence(c: number): ConfidenceTier {
  if (c >= 0.85) return "high";
  if (c >= 0.65) return "medium";
  return "low";
}

export function buildProvenance(
  extractedConfidence: number | null | undefined,
  sourceRole: SourceRole,
  triageLegibility: number | null | undefined,
  requestId: string | null
): ProvenanceInfo {
  return {
    source: "ai",
    sourceRole,
    confidence: effectiveConfidence(extractedConfidence, sourceRole, triageLegibility),
    modelConfidence: extractedConfidence ?? null,
    legibility: triageLegibility ?? null,
    ts: new Date().toISOString(),
    requestId,
  };
}

// EX-3 thresholds, ported as named constants instead of magic numbers
// scattered through the pipeline.
export const CONFIDENCE_AUTO_APPLY = 0.85;
export const CONFIDENCE_REVIEW_MIN = 0.4; // below this, treated as failed extraction
export const NAME_MATCH_AUTO = 0.7; // below this, identity check fails even at high confidence

export function routeDecision(confidence: number, nameMatchScore: number | null): RouteDecision {
  if (confidence < CONFIDENCE_REVIEW_MIN) return "reject";
  if (nameMatchScore != null && nameMatchScore < NAME_MATCH_AUTO) return "review";
  if (confidence >= CONFIDENCE_AUTO_APPLY) return "auto_apply";
  return "review";
}

// EX-10: a low-legibility scan should route to review instead of being
// auto-applied on the strength of a model that reported high confidence
// anyway - a blurry photo can produce a confidently wrong extraction.
//
// Bridge's original version (bffsa-site/index.html ~2658-2664) capped
// extracted.confidence at 0.55 here, on top of effectiveConfidence()
// separately multiplying by the same legibility score. That double-
// counts legibility: cap(0.55) * legibility(<0.6) * roleWeight(<=1.0) is
// always < 0.4, `CONFIDENCE_REVIEW_MIN` - so despite the comment saying
// this "routes to review", the actual arithmetic sent every
// low-legibility case straight to reject, never review. Confirmed this
// by working the algebra (see docs/DECISIONS.md) rather than assuming
// the comment matched the code.
//
// Fix: legibility suppresses confidence in exactly one place -
// effectiveConfidence()'s multiplier - so this function only adds the
// warning; it no longer also caps the score. That's what actually lets
// a blurry-but-legible scan land in the review band instead of always
// being rejected outright.
export function lowLegibilityWarning(legibilityScore: number | null | undefined): string | null {
  if (legibilityScore == null || legibilityScore >= 0.6) return null;
  return `Low-legibility scan detected (${Math.round(legibilityScore * 100)}%): extraction may be inaccurate, review carefully`;
}
