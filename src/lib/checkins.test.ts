import { describe, expect, it } from "vitest";
import { CHECKIN_DUE_DAYS, checkinDue, daysSinceCheckin, latestByAthlete, sortByNeed } from "@/lib/checkins";

const TODAY = new Date("2026-09-26T15:00:00Z");

describe("daysSinceCheckin", () => {
  it("is null when there has never been a check-in", () => {
    expect(daysSinceCheckin(null, TODAY)).toBeNull();
    expect(daysSinceCheckin(undefined, TODAY)).toBeNull();
    expect(daysSinceCheckin("", TODAY)).toBeNull();
  });

  it("counts whole days, floored", () => {
    expect(daysSinceCheckin("2026-09-26", TODAY)).toBe(0);
    expect(daysSinceCheckin("2026-09-20", TODAY)).toBe(6);
    expect(daysSinceCheckin("2026-09-12", TODAY)).toBe(14);
  });

  it("reads a date in the future as today", () => {
    expect(daysSinceCheckin("2026-10-01", TODAY)).toBe(0);
  });
});

describe("checkinDue", () => {
  it("is due when there has never been a check-in", () => {
    expect(checkinDue(null, TODAY)).toBe(true);
  });

  it("is not due at 13 days", () => {
    expect(checkinDue("2026-09-13", TODAY)).toBe(false);
  });

  it(`is due at ${CHECKIN_DUE_DAYS} days`, () => {
    expect(CHECKIN_DUE_DAYS).toBe(14);
    expect(checkinDue("2026-09-12", TODAY)).toBe(true);
  });
});

describe("latestByAthlete", () => {
  it("keeps the most recent date per athlete, whatever the order", () => {
    const m = latestByAthlete([
      { athlete_id: "a", occurred_on: "2026-09-01" },
      { athlete_id: "b", occurred_on: "2026-08-01" },
      { athlete_id: "a", occurred_on: "2026-09-20" },
      { athlete_id: "a", occurred_on: "2026-09-10" },
      { athlete_id: "c", occurred_on: null },
    ]);
    expect(m.get("a")).toBe("2026-09-20");
    expect(m.get("b")).toBe("2026-08-01");
    expect(m.has("c")).toBe(false);
  });
});

describe("sortByNeed", () => {
  it("puts never before 30 days before 3 days", () => {
    const sorted = sortByNeed([
      { name: "Three", days: 3 },
      { name: "Never", days: null },
      { name: "Thirty", days: 30 },
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["Never", "Thirty", "Three"]);
  });

  it("breaks a tie by name and leaves the input alone", () => {
    const input = [
      { name: "Bea", days: 5 },
      { name: "Al", days: 5 },
    ];
    expect(sortByNeed(input).map((r) => r.name)).toEqual(["Al", "Bea"]);
    expect(input[0]!.name).toBe("Bea");
  });
});
