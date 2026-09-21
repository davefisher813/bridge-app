import { describe, it, expect } from "vitest";
import { planFieldRestore, sameStoredValue, readableColumn } from "./undoPlan";

describe("sameStoredValue", () => {
  it("treats a numeric column and its string form as the same value", () => {
    // This is the one that matters. Supabase returns numeric(3,2) as a
    // string, so a strict compare would refuse every single GPA undo and
    // the feature would silently do nothing.
    expect(sameStoredValue("3.10", 3.1)).toBe(true);
    expect(sameStoredValue(3.1, "3.10")).toBe(true);
    expect(sameStoredValue("2.00", 2)).toBe(true);
  });

  it("does not treat different numbers as the same", () => {
    expect(sameStoredValue("3.10", 3.2)).toBe(false);
  });

  it("treats null and undefined as both meaning nothing stored", () => {
    expect(sameStoredValue(null, undefined)).toBe(true);
    expect(sameStoredValue(null, null)).toBe(true);
  });

  it("never treats nothing stored as equal to a real value", () => {
    expect(sameStoredValue(null, 3.1)).toBe(false);
    expect(sameStoredValue(3.1, null)).toBe(false);
    expect(sameStoredValue(null, false)).toBe(false);
    expect(sameStoredValue(null, 0)).toBe(false);
  });

  it("does not let an empty string compare equal to zero", () => {
    // Number("") is 0, so a naive numeric compare would call a blank
    // column the same as a stored 0 and restore over it.
    expect(sameStoredValue("", 0)).toBe(false);
    expect(sameStoredValue("   ", 0)).toBe(false);
  });

  it("compares booleans by value, since Postgres may return either form", () => {
    expect(sameStoredValue(true, true)).toBe(true);
    expect(sameStoredValue(false, false)).toBe(true);
    expect(sameStoredValue(true, false)).toBe(false);
  });

  it("compares dates as the strings they come back as", () => {
    expect(sameStoredValue("2008-03-15", "2008-03-15")).toBe(true);
    expect(sameStoredValue("2008-03-15", "2008-03-16")).toBe(false);
  });
});

describe("planFieldRestore", () => {
  it("puts back a field the document wrote and nobody has touched", () => {
    const plan = planFieldRestore(
      { gpa: "2.90", date_of_birth: "2008-03-15" },
      {
        gpa: { before: 3.4, after: 2.9 },
        date_of_birth: { before: null, after: "2008-03-15" },
      },
    );
    expect(plan.restore).toEqual({ gpa: 3.4, date_of_birth: null });
    expect(plan.kept).toEqual([]);
  });

  it("leaves a field alone when somebody corrected it after the apply", () => {
    // The whole point. Reverting a hand correction to a number from
    // before the document existed is worse than not undoing at all.
    const plan = planFieldRestore({ gpa: "3.75" }, { gpa: { before: 3.4, after: 2.9 } });
    expect(plan.restore).toEqual({});
    expect(plan.kept).toEqual(["gpa"]);
  });

  it("restores some fields while leaving others, in the same undo", () => {
    const plan = planFieldRestore(
      { gpa: "3.75", date_of_birth: "2008-03-15" },
      {
        gpa: { before: 3.4, after: 2.9 },
        date_of_birth: { before: null, after: "2008-03-15" },
      },
    );
    expect(plan.restore).toEqual({ date_of_birth: null });
    expect(plan.kept).toEqual(["gpa"]);
  });

  it("restores an explicit null rather than dropping the key", () => {
    // A date of birth this document filled in has to go back to empty.
    // Dropping the key from the patch would leave it set forever.
    const plan = planFieldRestore({ date_of_birth: "2008-03-15" }, { date_of_birth: { before: null, after: "2008-03-15" } });
    expect(Object.keys(plan.restore)).toContain("date_of_birth");
    expect(plan.restore.date_of_birth).toBeNull();
  });

  it("does nothing when there is nothing recorded", () => {
    expect(planFieldRestore({ gpa: "3.10" }, {})).toEqual({ restore: {}, kept: [] });
  });

  it("treats a row that no longer exists as nothing to restore onto", () => {
    const plan = planFieldRestore(null, { gpa: { before: 3.4, after: 2.9 } });
    expect(plan.restore).toEqual({});
    expect(plan.kept).toEqual(["gpa"]);
  });

  it("puts back a false the document turned true", () => {
    const plan = planFieldRestore({ gpa_verified: true }, { gpa_verified: { before: false, after: true } });
    expect(plan.restore).toEqual({ gpa_verified: false });
  });
});

describe("readableColumn", () => {
  it("names columns the way a person would", () => {
    expect(readableColumn("gpa")).toBe("GPA");
    expect(readableColumn("date_of_birth")).toBe("date of birth");
    expect(readableColumn("some_other_column")).toBe("some other column");
  });
});

describe("how long ago a reading started", () => {
  it("scales from minutes to hours to days", async () => {
    const { ageOf, isStaleProcessing } = await import("./documentState");
    const now = Date.parse("2026-09-21T12:00:00Z");
    expect(ageOf("2026-09-21T11:57:00Z", now)).toBe("3 minutes");
    expect(ageOf("2026-09-21T09:00:00Z", now)).toBe("3 hours");
    expect(ageOf("2026-09-17T12:00:00Z", now)).toBe("4 days");
    expect(isStaleProcessing("2026-09-21T11:55:00Z", now)).toBe(false);
    expect(isStaleProcessing("2026-09-21T11:45:00Z", now)).toBe(true);
  });
});
