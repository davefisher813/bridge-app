import { describe, expect, it } from "vitest";
import { RATE_LIMITS, rateRefusal } from "@/lib/data/docaiUsage";

// The Doc AI rate limit (backend audit F-05): a hard ceiling per window.
describe("rateRefusal", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const ago = (min: number) => now.getTime() - min * 60_000;

  it("allows calls under every window", () => {
    expect(rateRefusal([], 1, now)).toBeNull();
    expect(rateRefusal(Array.from({ length: 19 }, () => ago(1)), 1, now)).toBeNull();
  });

  it("refuses the call that would pass the 10 minute ceiling", () => {
    const r = rateRefusal(Array.from({ length: 20 }, () => ago(1)), 1, now);
    expect(r).toMatch(/last 10 minutes: the limit is 20/);
  });

  it("refuses a batch that would pass it, and says how many are left", () => {
    expect(rateRefusal(Array.from({ length: 15 }, () => ago(2)), 6, now)).toMatch(/5 more can be read now/);
  });

  it("refuses past the hourly ceiling even when the last 10 minutes are quiet", () => {
    const r = rateRefusal(Array.from({ length: 60 }, () => ago(30)), 1, now);
    expect(r).toMatch(/last hour: the limit is 60/);
  });

  it("forgets calls older than the longest window", () => {
    expect(rateRefusal(Array.from({ length: 200 }, () => ago(61)), 1, now)).toBeNull();
  });

  it("the limits are what the screen promises", () => {
    expect(RATE_LIMITS).toEqual([{ minutes: 10, max: 20 }, { minutes: 60, max: 60 }]);
  });
});
