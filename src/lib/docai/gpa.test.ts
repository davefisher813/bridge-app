import { describe, expect, it } from "vitest";
import { normalizeGpa } from "./gpa";

describe("normalizeGpa", () => {
  it("passes through a 4.0-scale GPA unchanged", () => {
    expect(normalizeGpa(3.7)).toEqual({ gpa: 3.7, origScale: "4.0", origValue: 3.7 });
  });

  it("auto-detects and converts a 100-point GPA", () => {
    const result = normalizeGpa(95);
    expect(result?.origScale).toBe("100");
    expect(result?.gpa).toBeGreaterThan(3.7);
    expect(result?.gpa).toBeLessThanOrEqual(4.0);
  });

  it("converts an explicit 10-point scale", () => {
    const result = normalizeGpa(8, "10");
    expect(result).toEqual({ gpa: 3.2, origScale: "10", origValue: 8 });
  });

  it("rejects an out-of-range value for an explicit scale", () => {
    expect(normalizeGpa(11, "10")).toBeNull();
  });

  it("returns null for a GPA above every known scale", () => {
    expect(normalizeGpa(150)).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(normalizeGpa(null)).toBeNull();
    expect(normalizeGpa(undefined)).toBeNull();
  });
});
