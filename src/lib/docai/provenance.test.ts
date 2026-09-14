import { describe, expect, it } from "vitest";
import { CONFIDENCE_AUTO_APPLY, effectiveConfidence, lowLegibilityWarning, routeDecision } from "./provenance";

describe("effectiveConfidence", () => {
  it("multiplies model confidence by role weight and legibility", () => {
    expect(effectiveConfidence(1.0, "admin", 1.0)).toBe(1.0);
    expect(effectiveConfidence(1.0, "parent", 1.0)).toBeCloseTo(0.8);
    expect(effectiveConfidence(1.0, "admin", 0.5)).toBeCloseTo(0.5);
  });

  it("defaults missing model confidence to 0.7 rather than treating it as 0", () => {
    expect(effectiveConfidence(null, "admin", 1.0)).toBeCloseTo(0.7);
  });
});

describe("routeDecision", () => {
  it("auto-applies a high-confidence, high-name-match extraction", () => {
    expect(routeDecision(0.9, 0.95)).toBe("auto_apply");
  });

  it("routes to review when confidence is high but identity match is weak", () => {
    expect(routeDecision(0.95, 0.5)).toBe("review");
  });

  it("routes to review when confidence sits in the middle band", () => {
    expect(routeDecision(0.6, 0.9)).toBe("review");
  });

  it("rejects when confidence is below the review floor", () => {
    expect(routeDecision(0.2, 0.9)).toBe("reject");
  });

  it("auto-applies when there's no candidate to check identity against (a brand-new athlete)", () => {
    expect(routeDecision(CONFIDENCE_AUTO_APPLY, null)).toBe("auto_apply");
  });
});

describe("lowLegibilityWarning", () => {
  it("returns null above the legibility floor", () => {
    expect(lowLegibilityWarning(0.8)).toBeNull();
  });

  it("returns a warning below the legibility floor", () => {
    expect(lowLegibilityWarning(0.3)).toMatch(/Low-legibility/);
  });

  it("returns null when legibility is unknown", () => {
    expect(lowLegibilityWarning(null)).toBeNull();
  });
});

describe("effectiveConfidence is the only place legibility suppresses confidence", () => {
  // Regression test for the double-penalty bug this session found and
  // fixed: Bridge's original code also capped confidence in the
  // low-legibility branch, on top of this multiplier, which made the
  // "review" band mathematically unreachable for any low-legibility
  // case (see docs/DECISIONS.md). A blurry-but-legible admin upload
  // should be able to land in "review", not just "auto_apply" or
  // "reject".
  it("a moderately low legibility score can still land in the review band, not just reject", () => {
    const conf = effectiveConfidence(0.9, "admin", 0.55);
    expect(routeDecision(conf, 0.9)).toBe("review");
  });
});
