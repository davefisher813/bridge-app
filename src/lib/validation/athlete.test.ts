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
});
