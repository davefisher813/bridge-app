import { describe, it, expect } from "vitest";
import { parseApprovedListPaste, describeParse, parseIsSaveable } from "./approvedListPaste";

const titles = (t: string) => parseApprovedListPaste(t).rows.map((r) => r.title);
const subjects = (t: string) => parseApprovedListPaste(t).rows.map((r) => r.subject);

describe("parseApprovedListPaste", () => {
  it("reads a tab separated table, the shape a portal paste actually has", () => {
    const r = parseApprovedListPaste(
      ["Course Title\tSubject\tCredit", "English 9\tEnglish\t1.0", "Algebra I\tMathematics\t1.0", "AP Biology\tNatural/Physical Science\t1.0"].join("\n"),
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ title: "English 9", subject: "english", maxCredit: 1 });
    expect(r.rows[2]).toMatchObject({ title: "AP Biology", subject: "science", weighted: true });
    expect(r.ignored).toContain("Course Title\tSubject\tCredit");
  });

  it("reads columns separated by runs of spaces", () => {
    expect(subjects("English 9      English\nUS History     Social Studies")).toEqual(["english", "social_science"]);
  });

  it("reads a dash or colon between title and subject", () => {
    expect(subjects("Algebra II - Mathematics\nChemistry: Science")).toEqual(["math", "science"]);
  });

  it("reads comma separated rows", () => {
    expect(subjects("Spanish II,World Language")).toEqual(["other_academic"]);
  });

  it("keeps a title that contains a comma when the row is tab separated", () => {
    expect(titles("Rhetoric, Advanced\tEnglish")).toEqual(["Rhetoric, Advanced"]);
  });

  // The rule the whole module runs on: never invent a subject.
  it("leaves an unrecognised category null and says so", () => {
    const r = parseApprovedListPaste("Underwater Basket Weaving\tElectives");
    expect(r.rows[0].subject).toBeNull();
    expect(r.rows[0].problem).toMatch(/pick one/i);
    expect(parseIsSaveable(r)).toBe(false);
  });

  it("leaves a title with no category at all null rather than assuming", () => {
    const r = parseApprovedListPaste("Algebra II");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].subject).toBeNull();
  });

  it("finds the title even when the row leads with a credit or a category", () => {
    expect(titles("1.0\tEnglish\tEnglish 11")).toEqual(["English 11"]);
    expect(titles("Mathematics\tGeometry\t1.0")).toEqual(["Geometry"]);
  });

  it("maps every NCAA category name onto a subject area", () => {
    const pairs: Array<[string, string]> = [
      ["English", "english"],
      ["Mathematics", "math"],
      ["Natural/Physical Science", "science"],
      ["Social Science", "social_science"],
      ["Social Studies", "social_science"],
      ["Additional Core Courses", "other_academic"],
      ["World Language", "other_academic"],
      ["Comparative Religion", "other_academic"],
      ["Philosophy", "other_academic"],
    ];
    for (const [word, expected] of pairs) {
      expect(subjects(`Some Course\t${word}`)[0], word).toBe(expected);
    }
  });

  it("marks honors and AP titles weighted", () => {
    const r = parseApprovedListPaste("AP Calculus\tMathematics\nHonors Chemistry\tScience\nGeometry\tMathematics");
    expect(r.rows.map((x) => x.weighted)).toEqual([true, true, false]);
  });

  it("takes a credit only when it is plausibly one", () => {
    const r = parseApprovedListPaste("English 9\tEnglish\t0.5\nEnglish 10\tEnglish\t2024");
    expect(r.rows[0].maxCredit).toBe(0.5);
    expect(r.rows[1].maxCredit).toBeNull();
  });

  it("skips headers and page furniture instead of importing them as courses", () => {
    const r = parseApprovedListPaste(
      ["CEEB Code 070415", "Page 1 of 3", "Course\tCategory", "English 9\tEnglish", "", "Total 1"].join("\n"),
    );
    expect(r.rows.map((x) => x.title)).toEqual(["English 9"]);
    expect(r.ignored.length).toBeGreaterThanOrEqual(3);
  });

  // Two rows that normalize the same make both permanently unmatchable,
  // so they are kept and flagged rather than silently merged or dropped.
  it("flags a duplicate rather than swallowing it", () => {
    const r = parseApprovedListPaste("Algebra II\tMathematics\nalg 2\tMathematics");
    expect(r.rows).toHaveLength(2);
    expect(r.duplicates).toBe(1);
    expect(r.rows[1].problem).toMatch(/already on the list/i);
    expect(parseIsSaveable(r)).toBe(false);
  });

  it("ignores a row that is not a course title", () => {
    const r = parseApprovedListPaste("X\tEnglish\n7\tMathematics\nBiology\tScience");
    expect(r.rows.map((x) => x.title)).toEqual(["Biology"]);
  });

  it("returns nothing for an empty paste, and is not saveable", () => {
    const r = parseApprovedListPaste("   \n\n");
    expect(r.rows).toEqual([]);
    expect(parseIsSaveable(r)).toBe(false);
  });

  it("is saveable once every row has a subject and no problem", () => {
    const r = parseApprovedListPaste("English 9\tEnglish\nAlgebra I\tMathematics");
    expect(parseIsSaveable(r)).toBe(true);
  });
});

describe("describeParse", () => {
  it("says what happened in one line", () => {
    const r = parseApprovedListPaste(["Course\tCategory", "English 9\tEnglish", "Pottery\tElectives", "eng 9\tEnglish"].join("\n"));
    const s = describeParse(r);
    expect(s).toMatch(/3 courses/);
    expect(s).toMatch(/need a subject/);
    expect(s).toMatch(/duplicate/);
    expect(s).toMatch(/skipped/);
  });
});
