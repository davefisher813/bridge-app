// "Today" is the organization's day, never UTC's.
//
// new Date().toISOString().slice(0, 10) is the UTC date, which from about
// 8pm in New York is already tomorrow. A check-in logged that evening
// defaulted to the next day (QA, 2026-10-01), and so did every other
// form and page that read the date that way. Everything asks
// src/lib/datetime/today.ts instead.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { orgToday, todayIso } from "@/lib/datetime/today";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("LAW: today is the org's calendar day", () => {
  it("at 9pm in New York the date is still today, though UTC has moved on", () => {
    const nineThirtyPmEdt = new Date("2026-10-02T01:30:00.000Z"); // Oct 1, 9:30pm in New York
    expect(nineThirtyPmEdt.toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(todayIso(nineThirtyPmEdt)).toBe("2026-10-01");
  });

  it("winter time, and just after midnight, agree with the wall clock", () => {
    expect(todayIso(new Date("2026-12-31T04:59:00.000Z"))).toBe("2026-12-30"); // 11:59pm EST
    expect(todayIso(new Date("2026-12-31T05:01:00.000Z"))).toBe("2026-12-31"); // 12:01am EST
  });

  it("another time zone can be asked for", () => {
    expect(todayIso(new Date("2026-10-02T01:30:00.000Z"), "UTC")).toBe("2026-10-02");
  });

  it("orgToday is todayIso for now, in the form a date input takes", () => {
    expect(orgToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("no screen, form or action reads today from the UTC clock", () => {
    const offenders = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/testing/") && !f.endsWith("datetime/today.ts"))
      .filter((f) => /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(SRC, "src"));
    expect(offenders).toEqual([]);
  });
});
