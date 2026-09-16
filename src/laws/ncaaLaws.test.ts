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
import { buildEligibilityView } from "../lib/data/ncaaAdapters";

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
  const files = ["coreGpa.ts", "initialEligibility.ts", "ageClock.ts", "fromTranscript.ts"];

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

  // Subtracting the years of two dates the implementation built by
  // adding five to one of them proves nothing: it passes for any month
  // or day error, including a leap-year rollover. Assert the dates.
  it("never pauses: five years from the start, regardless of time away", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", today: "2026-09-15" });
    expect(r.clockStart).toBe("2027-08-01");
    expect(r.clockEnd).toBe("2032-08-01");

    // Enrollment has to fall BEFORE the age trigger for the clock to
    // start on it: born 2010, so the trigger is 2029 and the 2028
    // enrollment wins. 2033 is not a leap year, so a naive Date.UTC
    // would roll Feb 29 to Mar 1.
    const leap = evaluateAgeClock({ dateOfBirth: "2010-01-01", division: "D1", firstFullTimeEnrollment: "2028-02-29", today: "2026-09-15" });
    expect(leap.clockStart).toBe("2028-02-29");
    expect(leap.clockEnd).toBe("2033-02-28");
  });

  it("the early-qualifier standards are the published ones", () => {
    expect(DIVISION_STANDARDS.D1.earlyQualifierGpa).toBe(3.0);
    expect(DIVISION_STANDARDS.D1.earlyQualifierCredits).toBe(14);
    expect(DIVISION_STANDARDS.D2.earlyQualifierGpa).toBe(2.5);
    expect(DIVISION_STANDARDS.D2.earlyQualifierCredits).toBe(14);
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

describe("LAW: an assumed grading scale is never presented as the school's own", () => {
  // Dave's call, 2026-09: show a number rather than a blank when a
  // school's conversion table is missing. That is only safe while the
  // assumption travels with the number, so these are the conditions of
  // that decision, not decoration on it.

  it("a fallback conversion produces a warning and an attribution, every time", () => {
    const view = buildEligibilityView({
      courses: [
        { id: "1", title: "English 11", subject: "english", credit: 1, grade: "91", term: null, school_name: "Nowhere HS", weighted: false, ncaa_approved: true, duplicate_of: null },
      ],
      scales: [],
      division: "D1",
      athlete: { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null },
      today: "2026-09-16",
    });

    // The number appears rather than the course being dropped.
    expect(view.skipped).toHaveLength(0);
    expect(view.eligibility.coreGpa?.totalCredits).toBe(1);

    // And it never appears unattributed.
    expect(view.scalesUsed.some((s) => s.origin === "assumed")).toBe(true);
    expect(view.schoolsMissingScale.length).toBeGreaterThan(0);
    expect(view.adapterWarnings.join(" ")).toMatch(/ten-point/);
    expect(view.adapterWarnings.join(" ")).toMatch(/estimate/);
  });

  it("an assumed scale never earns the weighted bonus", () => {
    // Both conditions on the +1.00 are claims about what the school told
    // the Eligibility Center. Nobody has made either claim here, so an
    // AP course converted on a guess must score exactly like any other.
    const withAp = buildEligibilityView({
      courses: [
        { id: "1", title: "AP English 11", subject: "english", credit: 1, grade: "91", term: null, school_name: "Nowhere HS", weighted: true, ncaa_approved: true, duplicate_of: null },
      ],
      scales: [],
      division: "D1",
      athlete: { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null },
      today: "2026-09-16",
    });
    // 91 on the ten-point default is an A, four points, no bonus.
    expect(withAp.eligibility.coreGpa?.gpa).toBe(4);
  });

  it("a real table on file always beats the assumption", () => {
    const view = buildEligibilityView({
      courses: [
        { id: "1", title: "English 11", subject: "english", credit: 1, grade: "91", term: null, school_name: "Nowhere HS", weighted: false, ncaa_approved: true, duplicate_of: null },
      ],
      // This school calls 91 a B. The default would call it an A.
      scales: [
        {
          school_name: "Nowhere HS",
          bands: [
            { letter: "A", min: 93, max: 100 },
            { letter: "B", min: 85, max: 92 },
            { letter: "C", min: 77, max: 84 },
            { letter: "F", min: 0, max: 76 },
          ],
          reports_weighted_grades: false,
          weighting_is_class_rank_only: false,
          weight_bonus: 0,
          origin: "org",
        },
      ],
      division: "D1",
      athlete: { dateOfBirth: null, firstFullTimeEnrollment: null, intendedEnrollment: null },
      today: "2026-09-16",
    });
    expect(view.eligibility.coreGpa?.gpa).toBe(3);
    expect(view.scalesUsed.every((s) => s.origin !== "assumed")).toBe(true);
    expect(view.schoolsMissingScale).toHaveLength(0);
  });

  it("the eligibility page renders the attribution the adapter produces", () => {
    // The warning existing in the adapter is worth nothing if the screen
    // drops it, which is exactly what happened to adapterWarnings once
    // before.
    const source = readFileSync(join(SRC, "app", "org", "[slug]", "roster", "[id]", "eligibility", "page.tsx"), "utf8");
    expect(source).toMatch(/view\.scalesUsed/);
    expect(source).toMatch(/view\.adapterWarnings/);
  });
});

describe("LAW: a grading scale entered by an org stays inside that org", () => {
  it("the entry action writes the org-scoped table, never the shared one", () => {
    const source = readFileSync(join(SRC, "lib", "actions", "gradingScales.ts"), "utf8");
    // Comments stripped: the file explains at length why it does NOT
    // touch the shared table, and naming it there is the explanation,
    // not a violation.
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).toMatch(/org_grading_scales/);
    // The shared table is service-role only. A write to it from here
    // would silently change other organizations' eligibility verdicts.
    expect(code).not.toMatch(/high_school_grading_scales/);
    expect(code).not.toMatch(/createAdminClient/);
  });

  it("every entered table passes the same sanity check as one read off a scan", () => {
    const shared = readFileSync(join(SRC, "lib", "validation", "gradingScale.ts"), "utf8");
    const docs = readFileSync(join(SRC, "lib", "actions", "documents.ts"), "utf8");
    expect(shared).toMatch(/gradingScaleProblem/);
    expect(docs).toMatch(/gradingScaleProblem/);
    // One implementation, imported by both. Two copies is how they drift.
    expect(docs).toMatch(/from "@\/lib\/fit\/ncaa\/gradingScale"/);
  });
});
