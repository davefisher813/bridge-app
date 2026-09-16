// Matching a transcript's courses against the high school's NCAA-
// approved course list.
//
// Why this exists: calculateCoreGpa() already treats `ncaaApproved` as
// three states, and reports "N course(s) have not been checked" as a
// warning that the GPA is an estimate. Nothing ever set the flag, so
// every core GPA in the product carried that warning. This is the piece
// that sets it.
//
// The Eligibility Center publishes one list per high school, keyed by
// CEEB code, at web3.ncaa.org/hsportal. A course on that list counts. A
// course not on it does not, and that is the whole mechanism by which a
// 4.00 transcript becomes a 2.9 core GPA.
//
// The danger here is not missing a match. It is making a wrong one. A
// transcript prints "Adv Alg II" and a list says "Algebra II Advanced";
// those are probably the same course. It also prints "Health" and the
// list says "Health Science"; those are not. A loose matcher silently
// promotes an elective into the core average and reports the result
// with confidence, which is worse than the honest "unchecked" it
// replaced. So the rule throughout: match only when the answer is
// unambiguous, and say "unknown" the rest of the time.

import type { CoreCourse, SubjectArea } from "./coreGpa";

// One row of a school's approved list.
export interface ApprovedCourse {
  // The title exactly as the Eligibility Center prints it.
  title: string;
  // The subject area the NCAA files it under. This is authoritative and
  // frequently disagrees with what the transcript implies: a school's
  // "Computer Science" may be other_academic rather than science, and
  // that difference moves the per-subject minimums.
  subject: SubjectArea;
  // The most credit the NCAA allows for it, when the list states one. A
  // school may award 1.0 for a course the NCAA caps at 0.5.
  maxCredit?: number;
  // The list marks courses it accepts as honors/AP weighted.
  weighted?: boolean;
}

// A school's list as we hold it.
export interface ApprovedCourseList {
  schoolName: string;
  // The Eligibility Center's key for the school. Names collide and get
  // retyped; the code does not.
  ceebCode?: string;
  courses: ApprovedCourse[];
  // THE important field. A list transcribed in full from the portal can
  // answer "is this course approved" both ways: absent means no. A list
  // someone entered partially, or that covers only the courses they had
  // in front of them, can only ever confirm. Treating a partial list as
  // complete is how a real course gets silently dropped from a core GPA
  // and the athlete is told they are short on credits.
  isComplete: boolean;
  source: ApprovedListSource;
  sourceNote?: string;
}

export type ApprovedListSource = "ncaa_portal" | "org";

// What happened to one course.
export type MatchStatus =
  // On the list. Counts.
  | "approved"
  // The list is complete and this is not on it. Does not count.
  | "not_approved"
  // Two or more list entries are equally good matches. Refusing to pick
  // is the point: picking wrong changes the GPA and nothing says so.
  | "ambiguous"
  // No list on file for the school, or a partial list that does not
  // mention it. Stays unchecked, exactly as before.
  | "unknown";

export interface CourseMatch {
  status: MatchStatus;
  // The list entry, when one was matched.
  entry?: ApprovedCourse;
  // How it matched, for the screen. "exact" is a straight title match,
  // "normalized" survived abbreviation expansion and level stripping.
  how?: "exact" | "normalized";
  // The competing titles, when ambiguous, so a human can settle it.
  candidates?: string[];
  // Set when the list files the course under a different subject than
  // the transcript did. The list wins, and this says so out loud.
  subjectCorrectedFrom?: SubjectArea;
  // Set when the list caps the credit below what the transcript awarded.
  creditCappedFrom?: number;
}

// Abbreviations that appear on essentially every US transcript. Kept
// deliberately short: every entry here is a chance to match two
// different courses to each other, so it holds only forms that are
// unambiguous expansions, never guesses. "Bio" is biology everywhere;
// "Comp" could be composition or computer, so it is not here.
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\balg\b/g, "algebra"],
  [/\bgeom\b/g, "geometry"],
  [/\btrig\b/g, "trigonometry"],
  [/\bcalc\b/g, "calculus"],
  [/\bstat(s|istics)?\b/g, "statistics"],
  [/\bbio\b/g, "biology"],
  [/\bchem\b/g, "chemistry"],
  [/\bphys\b/g, "physics"],
  [/\benv\b/g, "environmental"],
  [/\beng\b/g, "english"],
  [/\blit\b/g, "literature"],
  [/\bcomp(osition)?\b/g, "composition"],
  [/\bhist\b/g, "history"],
  [/\bgovt?\b/g, "government"],
  [/\becon\b/g, "economics"],
  [/\bgeog\b/g, "geography"],
  [/\bspan\b/g, "spanish"],
  [/\bfr\b/g, "french"],
  [/\bsci\b/g, "science"],
  [/\badv\b/g, "advanced"],
  [/\bhon\b/g, "honors"],
  [/\bintro\b/g, "introduction"],
];

// Roman numerals a transcript uses for the level. Turned into digits so
// "Algebra II" and "Algebra 2" are one course, which they are.
const NUMERALS: Array<[RegExp, string]> = [
  [/\biv\b/g, "4"],
  [/\biii\b/g, "3"],
  [/\bii\b/g, "2"],
  [/\bi\b/g, "1"],
];

// Words that describe how a course was taught rather than what it was.
// Stripped only for the second matching pass, never the first, so an
// exact title always wins over a stripped one.
const LEVEL_WORDS = /\b(ap|advanced placement|ib|honors|hon|advanced|adv|accelerated|cp|college prep|preparatory|dual enrollment|de|gifted|regular|general|academic)\b/g;

// Lowercase, strip punctuation, expand the abbreviations above, collapse
// whitespace. Applied to both sides of every comparison, so the list and
// the transcript are judged by the same rule.
export function normalizeCourseTitle(raw: string): string {
  let s = String(raw ?? "").toLowerCase();
  // & reads as "and" on one side and as punctuation on the other.
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  for (const [re, to] of NUMERALS) s = s.replace(re, to);
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

// The same title with the level words taken out. "AP Biology" and
// "Biology Advanced" both reduce to "biology", which is what makes the
// second pass useful and also what makes it dangerous, so its result
// counts only when exactly one entry survives.
function strippedTitle(raw: string): string {
  return normalizeCourseTitle(raw).replace(LEVEL_WORDS, "").replace(/\s+/g, " ").trim();
}

// Matches one transcript title against one school's list.
export function matchCourseTitle(title: string, list: ApprovedCourseList | null | undefined): CourseMatch {
  if (!list || list.courses.length === 0) return { status: "unknown" };

  const wanted = normalizeCourseTitle(title);
  if (!wanted) return { status: "unknown" };

  const exact = list.courses.filter((c) => normalizeCourseTitle(c.title) === wanted);
  if (exact.length === 1) return { status: "approved", entry: exact[0], how: "exact" };
  // Two list entries with the same normalized title is the school's
  // problem, not the athlete's, but picking one of them arbitrarily
  // would pick its subject and its credit cap too.
  if (exact.length > 1) return { status: "ambiguous", candidates: exact.map((c) => c.title) };

  const bare = strippedTitle(title);
  if (bare) {
    const loose = list.courses.filter((c) => strippedTitle(c.title) === bare);
    if (loose.length === 1) return { status: "approved", entry: loose[0], how: "normalized" };
    if (loose.length > 1) return { status: "ambiguous", candidates: loose.map((c) => c.title) };
  }

  // Nothing matched. Only a list transcribed in full is entitled to turn
  // that into a no.
  return { status: list.isComplete ? "not_approved" : "unknown" };
}

export interface ResolvedCourse {
  course: CoreCourse;
  match: CourseMatch;
}

export interface ApplyResult {
  courses: CoreCourse[];
  matches: ResolvedCourse[];
  // One line each, for the screen. Every correction the list made to
  // what the transcript said, because a subject reassignment or a credit
  // cap changes the verdict and must not happen silently.
  notes: string[];
  approvedCount: number;
  notApprovedCount: number;
  uncheckedCount: number;
  ambiguousCount: number;
}

// Applies the lists to a set of courses, keyed by school name, and
// returns courses with `ncaaApproved`, `subject` and `credit` corrected
// where the list disagrees with the transcript.
//
// Keyed by school and not by athlete because a transfer's transcript
// carries courses from more than one school, and each school has its own
// list. That was already true of the grading scales.
export function applyApprovedLists(
  courses: CoreCourse[],
  listsBySchoolKey: Map<string, ApprovedCourseList>,
  schoolOf: (course: CoreCourse) => string,
): ApplyResult {
  const matches: ResolvedCourse[] = [];
  const notes: string[] = [];
  const out: CoreCourse[] = [];

  for (const course of courses) {
    const key = normalizeSchoolKey(schoolOf(course));
    const list = listsBySchoolKey.get(key);
    const match = matchCourseTitle(course.title, list);

    const next: CoreCourse = { ...course };

    if (match.status === "approved" && match.entry) {
      next.ncaaApproved = true;

      // The list's subject is the NCAA's own filing, and the
      // per-subject minimums are checked against it. A transcript that
      // calls a course science when the list calls it other_academic
      // will otherwise report a science minimum as met when it is not.
      if (match.entry.subject && match.entry.subject !== course.subject) {
        match.subjectCorrectedFrom = course.subject;
        next.subject = match.entry.subject;
        notes.push(`${course.title} counts as ${LABEL[match.entry.subject]}, not ${LABEL[course.subject]}, on the approved list.`);
      }

      // A cap, not a correction upward: the list saying 1.0 never turns
      // a half credit the student actually earned into a full one.
      if (match.entry.maxCredit != null && course.credit > match.entry.maxCredit) {
        match.creditCappedFrom = course.credit;
        next.credit = match.entry.maxCredit;
        notes.push(`${course.title} is capped at ${match.entry.maxCredit} credit on the approved list, not ${course.credit}.`);
      }
    } else if (match.status === "not_approved") {
      next.ncaaApproved = false;
    } else {
      // Ambiguous and unknown both stay unchecked. They are different
      // reasons for the same honest answer, and the screen tells them
      // apart even though the engine does not.
      delete next.ncaaApproved;
      if (match.status === "ambiguous") {
        notes.push(`${course.title} could be ${match.candidates?.join(" or ")} on the approved list. Nobody has said which.`);
      }
    }

    out.push(next);
    matches.push({ course: next, match });
  }

  return {
    courses: out,
    matches,
    notes,
    approvedCount: matches.filter((m) => m.match.status === "approved").length,
    notApprovedCount: matches.filter((m) => m.match.status === "not_approved").length,
    uncheckedCount: matches.filter((m) => m.match.status === "unknown").length,
    ambiguousCount: matches.filter((m) => m.match.status === "ambiguous").length,
  };
}

const LABEL: Record<SubjectArea, string> = {
  english: "English",
  math: "math",
  science: "science",
  social_science: "social science",
  other_academic: "other academic",
};

// Same normalization the grading-scale tables use, and for the same
// reason: a list filed under one casing must not be invisible to courses
// recorded under another.
export function normalizeSchoolKey(name: string): string {
  return String(name ?? "").trim().toLowerCase();
}

// A list a person typed is worth only as much as what it claims about
// itself. Rejects one that cannot be right, the same way
// gradingScaleProblem() does, and returns a sentence for whoever
// supplied it.
export function approvedListProblem(list: {
  courses?: unknown[];
  isComplete?: unknown;
}): string | null {
  const courses = Array.isArray(list.courses) ? list.courses : [];
  if (courses.length === 0) return "it has no courses on it.";

  const seen = new Set<string>();
  for (const raw of courses) {
    const c = raw as { title?: unknown; subject?: unknown; maxCredit?: unknown };
    const title = typeof c.title === "string" ? c.title.trim() : "";
    if (!title) return "one of its rows has no course title.";
    if (typeof c.subject !== "string" || !(c.subject in LABEL)) {
      return `"${title}" has no NCAA subject area, and the subject decides which minimum it counts toward.`;
    }
    if (c.maxCredit != null) {
      const n = Number(c.maxCredit);
      if (!Number.isFinite(n) || n <= 0 || n > 2) return `"${title}" has a credit cap of ${String(c.maxCredit)}, which is not a course.`;
    }
    const key = normalizeCourseTitle(title);
    // Two rows that normalize the same make every course matching
    // either one ambiguous forever, which is worse than one of them
    // being absent.
    if (seen.has(key)) return `"${title}" appears twice, so nothing can ever match it.`;
    seen.add(key);
  }

  // A complete list is a strong claim: it lets absence mean "not
  // approved" for every course at that school. A handful of rows is
  // never the whole of a high school's catalog.
  if (list.isComplete === true && courses.length < 8) {
    return `${courses.length} courses is not a school's whole approved list. Leave it marked partial until it is.`;
  }
  return null;
}
