import { describe, expect, it } from "vitest";
import { classifyAgainstPrior } from "./versioning";
import type { VersionEntry } from "./types";

describe("classifyAgainstPrior", () => {
  it("classifies as first when there's no prior version", () => {
    expect(classifyAgainstPrior({ gpa: 3.5, gradYear: 2027 }, [])).toEqual({ kind: "first" });
  });

  it("classifies a same-grad-year, recent re-upload as a likely replacement", () => {
    const priors: VersionEntry[] = [{ requestId: "r1", category: "transcript", gpa: 3.4, gradYear: 2027, ts: new Date().toISOString() }];
    const result = classifyAgainstPrior({ gpa: 3.6, gradYear: 2027 }, priors);
    expect(result.kind).toBe("likely_replacement");
    if (result.kind === "likely_replacement") {
      expect(result.reason).toMatch(/Updated GPA/);
    }
  });

  it("classifies an old, stale prior version as a new period even with the same grad year", () => {
    const oldTs = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const priors: VersionEntry[] = [{ requestId: "r1", category: "transcript", gpa: 3.4, gradYear: 2027, ts: oldTs }];
    const result = classifyAgainstPrior({ gpa: 3.6, gradYear: 2027 }, priors);
    expect(result.kind).toBe("new_period");
  });

  it("classifies a different grad year as a new period", () => {
    const priors: VersionEntry[] = [{ requestId: "r1", category: "transcript", gpa: 3.4, gradYear: 2026, ts: new Date().toISOString() }];
    const result = classifyAgainstPrior({ gpa: 3.6, gradYear: 2027 }, priors);
    expect(result.kind).toBe("new_period");
  });
});
