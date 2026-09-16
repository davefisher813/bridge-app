import { describe, it, expect } from "vitest";
import { parseGradingScaleForm, bandsToRows } from "./gradingScale";
import { gradingScaleProblem, gradingScaleNotes, resolveScale, TEN_POINT_STARTING_POINT } from "@/lib/fit/ncaa/gradingScale";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const GOOD = {
  schoolName: "Westminster School",
  sourceNote: "Legend printed on page 2 of the official transcript",
  weightBonus: "1",
  min_A: "93",
  max_A: "100",
  min_B: "85",
  max_B: "92",
  min_C: "77",
  max_C: "84",
  min_D: "70",
  max_D: "76",
  min_F: "0",
  max_F: "69",
};

describe("parseGradingScaleForm", () => {
  it("accepts a real table", () => {
    const r = parseGradingScaleForm(form(GOOD));
    expect(r.ok).toBe(true);
    expect(r.values!.bands).toHaveLength(5);
    expect(r.values!.schoolName).toBe("Westminster School");
  });

  it("requires a source, because an unattributed table governs every verdict at that school", () => {
    const r = parseGradingScaleForm(form({ ...GOOD, sourceNote: "" }));
    expect(r.ok).toBe(false);
    expect(r.errors.sourceNote).toBeTruthy();
  });

  it("refuses a weight bonus above the NCAA cap", () => {
    const r = parseGradingScaleForm(form({ ...GOOD, weightBonus: "2" }));
    expect(r.ok).toBe(false);
    expect(r.errors.weightBonus).toBeTruthy();
  });

  it("refuses overlapping bands", () => {
    const r = parseGradingScaleForm(form({ ...GOOD, max_B: "95" }));
    expect(r.ok).toBe(false);
    expect(r.errors.bands).toMatch(/overlap/);
  });

  it("refuses a half-filled band rather than guessing the other end", () => {
    const r = parseGradingScaleForm(form({ ...GOOD, max_C: "" }));
    expect(r.ok).toBe(false);
    expect(r.errors.band_C).toBeTruthy();
  });

  it("allows a school that does not award a D", () => {
    const r = parseGradingScaleForm(form({ ...GOOD, min_D: "", max_D: "", max_F: "76" }));
    expect(r.ok).toBe(true);
    expect(r.values!.bands.map((b) => b.letter)).toEqual(["A", "B", "C", "F"]);
  });

  it("carries the weighted-grade conditions across, which nothing ever set before", () => {
    const fd = form(GOOD);
    fd.set("reportsWeightedGrades", "on");
    const r = parseGradingScaleForm(fd);
    expect(r.values!.reportsWeightedGrades).toBe(true);
    expect(r.values!.weightingIsClassRankOnly).toBe(false);
  });
});

describe("gradingScaleProblem", () => {
  it("catches a table whose letters run the wrong way", () => {
    const problem = gradingScaleProblem([
      { letter: "A", min: 60, max: 69 },
      { letter: "B", min: 70, max: 79 },
      { letter: "C", min: 90, max: 100 },
    ]);
    expect(problem).toMatch(/sits above/);
  });

  it("catches a single catch-all band", () => {
    expect(gradingScaleProblem([{ letter: "A", min: 0, max: 100 }])).toBeTruthy();
  });

  it("does not reject a real table for having a wide F band", () => {
    expect(
      gradingScaleProblem([
        { letter: "A", min: 90, max: 100 },
        { letter: "B", min: 80, max: 89 },
        { letter: "C", min: 70, max: 79 },
        { letter: "F", min: 0, max: 69 },
      ]),
    ).toBeNull();
  });

  it("still catches a catch-all band that is not the lowest one", () => {
    expect(
      gradingScaleProblem([
        { letter: "A", min: 50, max: 100 },
        { letter: "B", min: 40, max: 49 },
        { letter: "F", min: 0, max: 39 },
      ]),
    ).toMatch(/spans more than/);
  });

  it("passes the ten-point starting point it ships", () => {
    expect(gradingScaleProblem(TEN_POINT_STARTING_POINT)).toBeNull();
  });
});

describe("gradingScaleNotes", () => {
  it("names the gap a grade would fall into", () => {
    const notes = gradingScaleNotes([
      { letter: "A", min: 90, max: 100 },
      { letter: "B", min: 80, max: 85 },
    ]);
    expect(notes.join(" ")).toMatch(/between 85 and 90/);
  });

  it("says a weighted grade over 100 still counts as the top band", () => {
    const notes = gradingScaleNotes([
      { letter: "A", min: 90, max: 100 },
      { letter: "B", min: 80, max: 89 },
      { letter: "F", min: 0, max: 79 },
    ]);
    expect(notes.join(" ")).toMatch(/over 100/);
  });
});

describe("resolveScale", () => {
  it("prefers a verified shared table over an org's own entry", () => {
    const picked = resolveScale([
      { origin: "org" as const, tag: "typed" },
      { origin: "verified" as const, tag: "confirmed" },
    ]);
    expect(picked!.tag).toBe("confirmed");
  });

  it("falls back to the org's entry when nothing is verified", () => {
    const picked = resolveScale([{ origin: "org" as const, tag: "typed" }]);
    expect(picked!.tag).toBe("typed");
  });

  it("returns null when there is nothing on file, rather than a default curve", () => {
    expect(resolveScale([])).toBeNull();
  });
});

describe("bandsToRows", () => {
  it("leaves a missing letter blank instead of inventing one", () => {
    const rows = bandsToRows([{ letter: "A", min: 90, max: 100 }]);
    expect(rows.find((r) => r.letter === "A")!.min).toBe("90");
    expect(rows.find((r) => r.letter === "D")!.min).toBe("");
  });

  it("matches a stored A- band onto the A row, since plus and minus do not count", () => {
    const rows = bandsToRows([{ letter: "A-", min: 90, max: 92 }]);
    expect(rows.find((r) => r.letter === "A")!.max).toBe("92");
  });
});
