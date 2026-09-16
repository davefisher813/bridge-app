// Laws for the NCAA rules. These are the ones where being wrong costs
// an athlete a season, so they are asserted rather than trusted.
//
// Each was read out of an NCAA-published document on 2026-09-15 and is
// cited in docs/BUSINESS_RULES.md. When the NCAA changes a rule these
// tests are supposed to fail: that is the point. Change the constant,
// change the law, and record the new source.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gradePoints, calculateCoreGpa, MAX_WEIGHT_BONUS, type CoreCourse } from "../lib/fit/ncaa/coreGpa";
import { DIVISION_STANDARDS, evaluateInitialEligibility } from "../lib/fit/ncaa/initialEligibility";
import { evaluateAgeClock } from "../lib/fit/ncaa/ageClock";

const SRC = join(process.cwd(), "src");

describe("LAW: the NCAA grade scale has no plus or minus", () => {
  // "NCAA legislation does not permit the use of pluses and minuses."
  // Every American high school does use them, so the pressure to
  // reintroduce a 3.7 or a 3.3 here is constant and this law exists to
  // catch it.
  it("A- is worth exactly as much as A, and B+ exactly as much as B", () => {
    expect(gradePoints("A-")).toBe(gradePoints("A"));
    expect(gradePoints("B+")).toBe(gradePoints("B"));
    expect(gradePoints("C-")).toBe(gradePoints("C"));
  });

  it("produces only the four values 4, 3, 2, 1 and zero, never a fractional step", () => {
    const seen = new Set<number>();
    for (const base of ["A", "B", "C", "D", "F"]) {
      for (const suffix of ["", "+", "-"]) {
        const p = gradePoints(`${base}${suffix}`);
        expect(p).not.toBeNull();
        seen.add(p!);
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("LAW: the weighted bonus is capped at one quality point", () => {
  it("never exceeds 1.00 however much a school claims", () => {
    expect(MAX_WEIGHT_BONUS).toBe(1);
    for (const claimed of [1.5, 2, 10]) {
      const course: CoreCourse = { title: "AP Something", subject: "science", credit: 1, grade: "A", weighted: true, schoolWeightBonus: claimed };
      const r = calculateCoreGpa([course], 16, { schoolReportsWeightedGrades: true });
      expect(r.gpa).toBeLessThanOrEqual(4 + MAX_WEIGHT_BONUS);
    }
  });

  it("is withheld entirely unless the school is on record with the Eligibility Center", () => {
    const course: CoreCourse = { title: "AP Something", subject: "science", credit: 1, grade: "A", weighted: true, schoolWeightBonus: 1 };
    expect(calculateCoreGpa([course], 16, {}).gpa).toBe(4);
  });
});

describe("LAW: Division III never receives an NCAA academic verdict", () => {
  // D3 sets its own standards on campus. Showing a D3 athlete a core
  // GPA or a qualifier status invents a rule the NCAA does not have,
  // the same way a D3 scholarship claim would.
  it("returns no core GPA and no qualifier status for any D3 spelling", () => {
    const courses: CoreCourse[] = Array.from({ length: 16 }, (_, i) => ({ title: `Core ${i}`, subject: "english", credit: 1, grade: "A", ncaaApproved: true }));
    for (const div of ["D3", "d3", "NCAA D3", "Division III", "DIVISION 3", " D3 "]) {
      const r = evaluateInitialEligibility({ division: div, courses });
      expect(r.coreGpa).toBeNull();
      expect(r.status).toBe("not_applicable");
    }
  });

  it("does not run the age clock for D3", () => {
    expect(evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D3", today: "2026-09-15" }).applies).toBe(false);
  });
});

describe("LAW: a core GPA is never guessed from a transcript GPA", () => {
  // The two numbers are routinely a full point apart. Substituting one
  // for the other is the single most damaging thing this module could
  // do, because it reads as authoritative.
  it("reports insufficient data rather than a number when no courses are on file", () => {
    const r = evaluateInitialEligibility({ division: "D1", courses: [] });
    expect(r.coreGpa).toBeNull();
    expect(r.status).toBe("insufficient_data");
  });

  it("excludes courses that are not on the NCAA-approved list", () => {
    const r = calculateCoreGpa(
      [
        { title: "English 9", subject: "english", credit: 1, grade: "D", ncaaApproved: true },
        { title: "Weight Training", subject: "other_academic", credit: 1, grade: "A", ncaaApproved: false },
      ],
      16
    );
    expect(r.gpa).toBe(1);
  });
});

describe("LAW: no number is invented where the NCAA publishes none", () => {
  // The NCAA does not publish a Division II partial-qualifier GPA
  // floor. An invented one would be indistinguishable from a real rule
  // to anyone reading the screen.
  it("leaves the D2 second tier null and refuses to declare a D2 nonqualifier", () => {
    expect(DIVISION_STANDARDS.D2.secondTierGpa).toBeNull();
    const courses: CoreCourse[] = Array.from({ length: 16 }, (_, i) => ({ title: `Core ${i}`, subject: "english", credit: 1, grade: "D", ncaaApproved: true }));
    const r = evaluateInitialEligibility({ division: "D2", courses });
    expect(r.status).not.toBe("nonqualifier");
    expect(r.warnings.join(" ")).toMatch(/does not publish/i);
  });
});

describe("LAW: current division standards match the 2026-27 sources", () => {
  it("D1 qualifier 2.3, academic redshirt 2.0, D2 qualifier 2.2, 16 core credits", () => {
    expect(DIVISION_STANDARDS.D1.qualifierGpa).toBe(2.3);
    expect(DIVISION_STANDARDS.D1.secondTierGpa).toBe(2.0);
    expect(DIVISION_STANDARDS.D1.coreCredits).toBe(16);
    expect(DIVISION_STANDARDS.D2.qualifierGpa).toBe(2.2);
    expect(DIVISION_STANDARDS.D2.coreCredits).toBe(16);
  });

  it("the 10/7 rule is Division I only", () => {
    expect(DIVISION_STANDARDS.D1.tenSevenRule).toBe(true);
    expect(DIVISION_STANDARDS.D2.tenSevenRule).toBe(false);
  });
});

describe("LAW: standardized test scores are never an eligibility factor", () => {
  // Divisions I and II removed test scores from initial eligibility in
  // January 2023, effective August 2023, and the sliding scale went
  // with them. The app may still use SAT/ACT as an admissions signal,
  // which is a different question, so this law checks only that the
  // NCAA modules stay clear of them.
  const ncaaDir = join(SRC, "lib", "fit", "ncaa");
  const files = ["coreGpa.ts", "initialEligibility.ts", "ageClock.ts"];

  it("no NCAA eligibility module reads a test score", () => {
    for (const file of files) {
      const source = readFileSync(join(ncaaDir, file), "utf8");
      const code = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code).not.toMatch(/\bsatTotal\b|\bactComposite\b|\bsatRange\b|\bactRange\b/);
    }
  });
});

describe("LAW: the age clock can start before an athlete enrolls anywhere", () => {
  // This is the rule most likely to catch a Bridge athlete, and the
  // easiest to model wrongly by assuming a clock only starts at
  // enrollment.
  it("starts on the 19th-birthday trigger with no enrollment on file", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", today: "2026-09-15" });
    expect(r.startedBy).toBe("age");
    expect(r.clockStart).not.toBeNull();
  });

  it("starts at whichever comes first when both triggers exist", () => {
    const early = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", firstFullTimeEnrollment: "2026-08-20", today: "2026-09-15" });
    expect(early.startedBy).toBe("enrollment");
    const late = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", firstFullTimeEnrollment: "2030-08-20", today: "2026-09-15" });
    expect(late.startedBy).toBe("age");
  });

  it("never pauses: five years from the start, regardless of time away", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", today: "2026-09-15" });
    expect(new Date(r.clockEnd!).getUTCFullYear() - new Date(r.clockStart!).getUTCFullYear()).toBe(5);
  });
});

describe("LAW: the eligibility screen never dresses a status in red", () => {
  // Locked catalog: red is the primary action colour and "red is not a
  // status". A verdict banner reaching for accent/danger would read as
  // an NCAA severity signal the contract does not have.
  it("the verdict component uses Score-axis tints only", () => {
    const source = readFileSync(join(SRC, "components", "EligibilityVerdict.tsx"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/TINT\[\s*["']accent["']\s*\]|TINT\[\s*["']danger["']\s*\]/);
    expect(code).not.toMatch(/bg-solid-accent|bg-tint-accent|bg-solid-danger|bg-tint-danger|border-l-ios-red|border-l-ios-pink/);
  });

  it("maps every status onto high, mid or low and nothing else", () => {
    const source = readFileSync(join(SRC, "components", "EligibilityVerdict.tsx"), "utf8");
    const block = source.match(/STATUS_ROLE[^=]*=\s*\{([\s\S]*?)\n\};/);
    expect(block).not.toBeNull();
    const roles = [...block![1]!.matchAll(/:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(roles.length).toBeGreaterThan(0);
    for (const r of roles) expect(["high", "mid", "low"]).toContain(r);
  });
});

describe("LAW: a transcript GPA is never presented as an NCAA number", () => {
  // The two figures are routinely a point apart. The athlete page shows
  // the school's own GPA, so it has to say so; an unlabelled "GPA" beside
  // an NCAA-looking screen is the exact confusion this work exists to end.
  it("the athlete page labels its GPA as the school's", () => {
    const source = readFileSync(join(SRC, "app", "org", "[slug]", "roster", "[id]", "page.tsx"), "utf8");
    expect(source).toMatch(/school GPA/);
    expect(source).not.toMatch(/\$\{[^}]*\}\s*GPA`/);
  });

  it("the eligibility page never shows a core GPA without the transcript beside it", () => {
    const source = readFileSync(join(SRC, "app", "org", "[slug]", "roster", "[id]", "eligibility", "page.tsx"), "utf8");
    // GpaPair is the only component that renders the core figure, and it
    // takes both numbers, so the pairing cannot be broken by omission.
    expect(source).toMatch(/<GpaPair\b/);
    const pair = source.match(/<GpaPair[\s\S]*?\/>/);
    expect(pair).not.toBeNull();
    expect(pair![0]).toMatch(/coreGpa=/);
    expect(pair![0]).toMatch(/transcriptGpa=/);
  });
});
