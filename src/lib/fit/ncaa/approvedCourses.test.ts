import { describe, it, expect } from "vitest";
import {
  normalizeCourseTitle,
  matchCourseTitle,
  applyApprovedLists,
  approvedListProblem,
  type ApprovedCourseList,
} from "./approvedCourses";
import type { CoreCourse } from "./coreGpa";

const list = (courses: ApprovedCourseList["courses"], isComplete = true): ApprovedCourseList => ({
  schoolName: "Cardinal Ridge High School",
  courses,
  isComplete,
  source: "ncaa_portal",
});

const course = (title: string, over: Partial<CoreCourse> = {}): CoreCourse => ({
  title,
  subject: "math",
  credit: 1,
  grade: "A",
  ...over,
});

describe("normalizeCourseTitle", () => {
  it("collapses case, punctuation and spacing", () => {
    expect(normalizeCourseTitle("  Algebra-II  ")).toBe(normalizeCourseTitle("algebra 2"));
  });

  it("reads roman numerals as the levels they are", () => {
    expect(normalizeCourseTitle("English III")).toBe("english 3");
  });

  it("expands the abbreviations a transcript actually uses", () => {
    expect(normalizeCourseTitle("Adv Alg II")).toBe("advanced algebra 2");
    expect(normalizeCourseTitle("US Hist")).toBe("us history");
  });

  it("treats an ampersand as the word", () => {
    expect(normalizeCourseTitle("Science & Society")).toBe(normalizeCourseTitle("Science and Society"));
  });
});

describe("matchCourseTitle", () => {
  const cardinal = list([
    { title: "Algebra II", subject: "math" },
    { title: "AP Biology", subject: "science" },
    { title: "English 11", subject: "english" },
  ]);

  it("matches an exact title", () => {
    const m = matchCourseTitle("Algebra II", cardinal);
    expect(m.status).toBe("approved");
    expect(m.how).toBe("exact");
  });

  it("matches through abbreviation and numeral differences", () => {
    expect(matchCourseTitle("Alg 2", cardinal).status).toBe("approved");
  });

  it("matches through a level word the transcript dropped", () => {
    const m = matchCourseTitle("Biology", cardinal);
    expect(m.status).toBe("approved");
    expect(m.how).toBe("normalized");
  });

  it("calls a course absent from a complete list not approved", () => {
    expect(matchCourseTitle("Ceramics", cardinal).status).toBe("not_approved");
  });

  // The distinction the whole module exists for.
  it("will not call anything not approved from a partial list", () => {
    const partial = list([{ title: "Algebra II", subject: "math" }], false);
    expect(matchCourseTitle("Ceramics", partial).status).toBe("unknown");
    expect(matchCourseTitle("Algebra II", partial).status).toBe("approved");
  });

  it("refuses to choose when two entries match equally", () => {
    const twins = list([
      { title: "AP Biology", subject: "science" },
      { title: "Biology Honors", subject: "other_academic" },
    ]);
    const m = matchCourseTitle("Biology", twins);
    expect(m.status).toBe("ambiguous");
    expect(m.candidates).toHaveLength(2);
  });

  it("prefers an exact match over a stripped one", () => {
    const both = list([
      { title: "Biology", subject: "science" },
      { title: "AP Biology", subject: "other_academic" },
    ]);
    const m = matchCourseTitle("Biology", both);
    expect(m.status).toBe("approved");
    expect(m.how).toBe("exact");
    expect(m.entry?.subject).toBe("science");
  });

  it("does not match two different courses that merely share a word", () => {
    const health = list([{ title: "Health Science", subject: "science" }]);
    expect(matchCourseTitle("Health", health).status).toBe("not_approved");
  });

  it("reports unknown when no list is on file", () => {
    expect(matchCourseTitle("Algebra II", null).status).toBe("unknown");
    expect(matchCourseTitle("Algebra II", list([])).status).toBe("unknown");
  });
});

describe("applyApprovedLists", () => {
  const lists = new Map([
    [
      "cardinal ridge high school",
      list([
        { title: "Algebra II", subject: "math" },
        { title: "AP Biology", subject: "science" },
        { title: "Computer Science", subject: "other_academic" },
        { title: "Health Science", subject: "science", maxCredit: 0.5 },
        { title: "English 11", subject: "english" },
        { title: "US History", subject: "social_science" },
        { title: "Spanish II", subject: "other_academic" },
        { title: "Chemistry", subject: "science" },
      ]),
    ],
  ]);
  const at = () => "Cardinal Ridge High School";

  it("sets the flag three ways", () => {
    const r = applyApprovedLists(
      [course("Algebra II"), course("Ceramics", { subject: "other_academic" })],
      lists,
      at,
    );
    expect(r.courses[0].ncaaApproved).toBe(true);
    expect(r.courses[1].ncaaApproved).toBe(false);
    expect(r.approvedCount).toBe(1);
    expect(r.notApprovedCount).toBe(1);
  });

  it("leaves a course at a school with no list on file unchecked", () => {
    const r = applyApprovedLists([course("Algebra II")], lists, () => "Westhaven Prep");
    expect(r.courses[0].ncaaApproved).toBeUndefined();
    expect(r.uncheckedCount).toBe(1);
  });

  // The correction that moves a verdict rather than a number: the
  // per-subject minimums are checked against subject, so a course filed
  // under the wrong one reports a minimum as met when it is not.
  it("takes the subject from the list, not the transcript", () => {
    const r = applyApprovedLists([course("Computer Science", { subject: "science" })], lists, at);
    expect(r.courses[0].subject).toBe("other_academic");
    expect(r.matches[0].match.subjectCorrectedFrom).toBe("science");
    expect(r.notes[0]).toContain("not science");
  });

  it("caps credit down but never up", () => {
    const capped = applyApprovedLists([course("Health Science", { credit: 1, subject: "science" })], lists, at);
    expect(capped.courses[0].credit).toBe(0.5);

    const under = applyApprovedLists([course("Health Science", { credit: 0.25, subject: "science" })], lists, at);
    expect(under.courses[0].credit).toBe(0.25);
  });

  it("clears a stale flag rather than leaving a wrong one in place", () => {
    // A course marked approved by hand, at a school whose list is not on
    // file. The honest answer is unchecked, not the old claim.
    const r = applyApprovedLists([course("Algebra II", { ncaaApproved: true })], lists, () => "Westhaven Prep");
    expect(r.courses[0].ncaaApproved).toBeUndefined();
  });

  it("does not mutate the courses it was given", () => {
    const original = course("Computer Science", { subject: "science" });
    applyApprovedLists([original], lists, at);
    expect(original.subject).toBe("science");
    expect(original.ncaaApproved).toBeUndefined();
  });
});

describe("approvedListProblem", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ title: `Course ${i}`, subject: "math" }));

  it("accepts a real list", () => {
    expect(approvedListProblem({ courses: eight, isComplete: true })).toBeNull();
  });

  it("rejects an empty list", () => {
    expect(approvedListProblem({ courses: [], isComplete: false })).toContain("no courses");
  });

  it("rejects a row with no subject, because the subject decides the minimum", () => {
    expect(approvedListProblem({ courses: [{ title: "Algebra II" }], isComplete: false })).toContain("subject area");
  });

  it("rejects two rows that normalize the same", () => {
    const dupes = [{ title: "Algebra II", subject: "math" }, { title: "alg 2", subject: "math" }];
    expect(approvedListProblem({ courses: dupes, isComplete: false })).toContain("twice");
  });

  it("rejects an implausible credit cap", () => {
    expect(approvedListProblem({ courses: [{ title: "Algebra II", subject: "math", maxCredit: 9 }], isComplete: false })).toContain("not a course");
  });

  // Marking a short list complete is what makes real courses vanish.
  it("refuses to call a handful of courses a whole catalog", () => {
    const three = eight.slice(0, 3);
    expect(approvedListProblem({ courses: three, isComplete: true })).toContain("whole approved list");
    expect(approvedListProblem({ courses: three, isComplete: false })).toBeNull();
  });
});

// Added 2026-09-17 with the transcript screen. A counted course has to be
// traceable back to the transcript row it came from, and the only other
// key is the title, which both halves of a year-long course share.
describe("a counted course carries its term", () => {
  it("keeps the two halves of a year-long course apart", async () => {
    const { coursesFromTranscript } = await import("./fromTranscript");
    const converted = coursesFromTranscript(
      [
        { title: "English 11", subject: "english", credit: 0.5, grade: "A", weighted: false, term: "24-25 S1" },
        { title: "English 11", subject: "english", credit: 0.5, grade: "C", weighted: false, term: "24-25 S2" },
      ],
      { gradingScale: null, schoolName: "Cardinal Ridge" },
    );
    const terms = converted.courses.map((c) => c.term);
    expect(terms).toEqual(["24-25 S1", "24-25 S2"]);
    // Keyed on title alone these collapse to one entry and the screen
    // shows the same grade twice.
    expect(new Set(converted.courses.map((c) => c.title + "|" + c.term)).size).toBe(2);
  });
});
