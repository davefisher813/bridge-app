import { describe, expect, it } from "vitest";
import { classifyMatchStrength, findCandidates, nameMatch, resolveOverrideToAthlete } from "./resolver";
import type { ResolverAthlete } from "./types";

const roster: ResolverAthlete[] = [
  { id: "1", name: "Xavier Davis", school: "Stamford High", gradYear: 2027 },
  { id: "2", name: "Marcus Johnson", school: "Westhill High", gradYear: 2026 },
  { id: "3", name: "Xavier Davies", school: "Stamford High", gradYear: 2027 }, // near-duplicate name
];

describe("nameMatch", () => {
  it("scores an exact match as 1", () => {
    expect(nameMatch("Xavier Davis", "Xavier Davis")).toBe(1);
  });

  it("scores unrelated names low", () => {
    expect(nameMatch("Xavier Davis", "Marcus Johnson")).toBeLessThan(0.3);
  });

  it("scores a reordered name (last, first) reasonably high", () => {
    expect(nameMatch("Xavier Davis", "Davis, Xavier")).toBeGreaterThan(0.5);
  });
});

describe("findCandidates", () => {
  it("ranks the correct athlete first given a matching name, school, and grad year", () => {
    const candidates = findCandidates({ studentName: "Xavier Davis", school: "Stamford High", gradYear: 2027 }, roster);
    expect(candidates[0]?.athlete.id).toBe("1");
  });

  it("an override pin always wins, even against a document that matches someone else better", () => {
    const candidates = findCandidates({ studentName: "Marcus Johnson", school: "Westhill High", gradYear: 2026 }, roster, "Xavier Davis");
    expect(candidates[0]?.athlete.id).toBe("1");
    expect(candidates[0]?.reasons[0]).toMatch(/User override/);
  });

  it("returns nothing above the noise floor when the document matches no one", () => {
    const candidates = findCandidates({ studentName: "Someone Else Entirely", school: "Unrelated School" }, roster);
    expect(candidates).toEqual([]);
  });
});

describe("resolveOverrideToAthlete", () => {
  it("resolves a free-text override to the matching roster athlete", () => {
    expect(resolveOverrideToAthlete("this is for Marcus Johnson", roster)?.id).toBe("2");
  });

  it("returns null when nothing matches", () => {
    expect(resolveOverrideToAthlete("nobody in particular", roster)).toBeNull();
  });
});

describe("classifyMatchStrength", () => {
  it("bands scores into high/mid/low", () => {
    expect(classifyMatchStrength(0.9)).toBe("high");
    expect(classifyMatchStrength(0.6)).toBe("mid");
    expect(classifyMatchStrength(0.1)).toBe("low");
  });
});
