import { describe, expect, it } from "vitest";
import { parseSchoolForm, parseSportsSponsored } from "@/lib/validation/school";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseSchoolForm", () => {
  it("accepts a minimal valid school", () => {
    const r = parseSchoolForm(fd({ name: "Test University", division: "D1" }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ name: "Test University", division: "D1" });
  });

  it("rejects an empty name", () => {
    const r = parseSchoolForm(fd({ name: "", division: "D1" }));
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBeTruthy();
  });

  it("rejects an unrecognized division", () => {
    const r = parseSchoolForm(fd({ name: "Test University", division: "D4" }));
    expect(r.ok).toBe(false);
    expect(r.errors.division).toBeTruthy();
  });

  it("carries optional fields through when present", () => {
    const r = parseSchoolForm(fd({ name: "Test University", division: "D2", conference: "Test Conference", sportsSponsored: "baseball, softball" }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ conference: "Test Conference", sportsSponsored: "baseball, softball" });
  });
});

describe("parseSportsSponsored", () => {
  it("splits a comma-separated list and trims whitespace", () => {
    expect(parseSportsSponsored("baseball,  softball ,soccer")).toEqual(["baseball", "softball", "soccer"]);
  });

  it("returns an empty array for undefined or blank input", () => {
    expect(parseSportsSponsored(undefined)).toEqual([]);
    expect(parseSportsSponsored("   ")).toEqual([]);
  });
});
