import { describe, expect, it } from "vitest";
import { parseAthleteForm } from "@/lib/validation/athlete";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseAthleteForm", () => {
  it("accepts a minimal valid HS athlete", () => {
    const r = parseAthleteForm(fd({ name: "Jose Ulloa", sport: "Baseball", recruitType: "hs" }));
    expect(r.ok).toBe(true);
    expect(r.detail).toEqual({ kind: "hs" });
    expect(r.errors).toEqual({});
  });

  it("rejects a missing name", () => {
    const r = parseAthleteForm(fd({ name: "", sport: "Baseball", recruitType: "hs" }));
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBeTruthy();
  });

  it("requires currentSchool for a transfer athlete", () => {
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "transfer_juco" }));
    expect(r.ok).toBe(false);
    expect(r.errors.currentSchool).toBeTruthy();
  });

  it("accepts a valid transfer athlete with required transfer fields", () => {
    const r = parseAthleteForm(
      fd({
        name: "A B",
        sport: "Baseball",
        recruitType: "transfer_juco",
        currentSchool: "Some JUCO",
        eligibilityYearsRemaining: "2",
        transferCount: "1",
      })
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toMatchObject({ kind: "transfer", currentSchool: "Some JUCO", eligibilityYearsRemaining: 2, transferCount: 1 });
  });

  it("only carries degreeCompleted through for transfer_grad", () => {
    const r = parseAthleteForm(
      fd({
        name: "A B",
        sport: "Baseball",
        recruitType: "transfer_grad",
        currentSchool: "Some U",
        eligibilityYearsRemaining: "1",
        transferCount: "2",
        degreeCompleted: "on",
      })
    );
    expect(r.ok).toBe(true);
    expect(r.detail).toMatchObject({ kind: "transfer", degreeCompleted: true });

    const r2 = parseAthleteForm(
      fd({
        name: "A B",
        sport: "Baseball",
        recruitType: "transfer_4to4",
        currentSchool: "Some U",
        eligibilityYearsRemaining: "1",
        transferCount: "2",
        degreeCompleted: "on",
      })
    );
    expect(r2.detail && "degreeCompleted" in r2.detail ? (r2.detail as { degreeCompleted?: boolean }).degreeCompleted : undefined).toBeUndefined();
  });

  it("rejects an out-of-range SAT score", () => {
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", satTotal: "5000" }));
    expect(r.ok).toBe(false);
    expect(r.errors.satTotal).toBeTruthy();
  });

  it("defaults status to Active and gpaVerified to false when absent", () => {
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs" }));
    expect(r.values.status).toBe("Active");
    expect(r.values.gpaVerified).toBe(false);
  });

  it("reads a blank advisor as nobody yet", () => {
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", advisorId: "" }));
    expect(r.ok).toBe(true);
    expect(r.values.advisorId).toBeUndefined();
  });

  it("carries a picked advisor through", () => {
    const id = "00000000-0000-0000-0000-0000000000b1";
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", advisorId: id }));
    expect(r.ok).toBe(true);
    expect(r.values.advisorId).toBe(id);
  });

  it("rejects an advisor that is not an id", () => {
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", advisorId: "Mike" }));
    expect(r.ok).toBe(false);
    expect(r.errors.advisorId).toBe("Pick an Admin.");
  });
});

describe("first metrics on the Add form", async () => {
  const { parseFirstMetrics } = await import("./athlete");
  const fdm = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  it("nothing typed is nothing logged, and no error", () => {
    expect(parseFirstMetrics(fdm({ metricsMeasuredOn: "", metricsSource: "" }))).toEqual({ ok: true, metrics: null });
  });
  it("each number becomes an entry sharing one date and source", () => {
    const r = parseFirstMetrics(fdm({ metric_fbVelo: "86", metric_sixty: "6.9", metric_popTime: "", metricsMeasuredOn: "2026-08-15", metricsSource: "pbr", metricsSourceDetail: "PBR Connecticut" }));
    expect(r).toEqual({ ok: true, metrics: { entries: [{ metric: "fbVelo", value: 86 }, { metric: "sixty", value: 6.9 }], measuredOn: "2026-08-15", source: "pbr", sourceDetail: "PBR Connecticut" } });
  });
  it("a number without a date is refused, and so is a bad number", () => {
    const noDate = parseFirstMetrics(fdm({ metric_fbVelo: "86", metricsMeasuredOn: "", metricsSource: "pbr" }));
    expect(noDate.ok).toBe(false);
    expect((noDate as { errors: Record<string, string> }).errors.metricsMeasuredOn).toMatch(/date/);
    const bad = parseFirstMetrics(fdm({ metric_fbVelo: "-4", metricsMeasuredOn: "2026-08-15", metricsSource: "pbr" }));
    expect((bad as { errors: Record<string, string> }).errors.metric_fbVelo).toBeTruthy();
  });

  // Stage 4. Zod drops a key it does not know, and the form rebuilds
  // detail key by key, so a key missed here is erased by every Edit save.
  it("carries the high school and its directory id through", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", highSchool: "  Fixture High School ", highSchoolId: id }));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatchObject({ kind: "hs", highSchool: "Fixture High School", highSchoolId: id });
  });

  it("carries a transfer's current school id through", () => {
    const id = "00000000-0000-4000-8000-000000000002";
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "transfer_4to4", currentSchool: "Some U", eligibilityYearsRemaining: "2", transferCount: "0", currentSchoolId: id }));
    expect(r.ok).toBe(true);
    expect(r.detail).toMatchObject({ kind: "transfer", currentSchoolId: id });
  });

  it("drops a row id that is not a uuid instead of failing the save", () => {
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", highSchool: "Somewhere HS", highSchoolId: "not-an-id" }));
    expect(r.ok).toBe(true);
    expect(r.detail).toEqual({ kind: "hs", highSchool: "Somewhere HS" });
  });

  it("reads a note, trimmed, and treats a blank one as none", () => {
    expect(parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", notes: "  Met the family.  " })).values.notes).toBe("Met the family.");
    expect(parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", notes: "" })).values.notes).toBeUndefined();
    const long = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", notes: "x".repeat(4001) }));
    expect(long.ok).toBe(false);
    expect(long.errors.notes).toBeTruthy();
  });

  it("reads corrected enrollment and graduation dates, and refuses one that is not a date", () => {
    const r = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", enrollmentDate: "2025-08-25", graduatedOn: "2029-05-15" }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ enrollmentDate: "2025-08-25", graduatedOn: "2029-05-15" });
    const bad = parseAthleteForm(fd({ name: "A B", sport: "Baseball", recruitType: "hs", enrollmentDate: "last fall" }));
    expect(bad.ok).toBe(false);
    expect(bad.errors.enrollmentDate).toBeTruthy();
  });
});
