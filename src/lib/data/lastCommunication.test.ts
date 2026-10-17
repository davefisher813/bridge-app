import { describe, expect, it } from "vitest";
import { lastCommunication } from "./lastCommunication";

describe("lastCommunication", () => {
  it("is the newest entry's date, whatever order the log comes in", () => {
    expect(lastCommunication([{ occurred_on: "2026-08-02" }, { occurred_on: "2026-09-14" }, { occurred_on: "2026-07-30" }])).toBe("2026-09-14");
  });
  it("is null when nothing is logged or no entry has a date", () => {
    expect(lastCommunication([])).toBeNull();
    expect(lastCommunication([{ occurred_on: null }, {}])).toBeNull();
  });
});
