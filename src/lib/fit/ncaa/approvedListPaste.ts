// Turning a block of pasted text into an approved-course list.
//
// Why this is the piece that decides whether the feature gets used at
// all: a high school's approved list runs to eighty or a hundred rows.
// Typing that into a phone form, one course and one subject dropdown at
// a time, is an afternoon, and an afternoon is the same as never. The
// list is already a table on the Eligibility Center's page. Selecting it
// and pasting it is ten seconds.
//
// What comes out of a paste is messy and that is the point. This parser
// splits rows, works out which column is the title and which is the NCAA
// subject, and reports per row what it could not settle. It never
// guesses a subject: an unrecognised category comes back as null and the
// review screen makes a person choose, for the same reason
// matchCourseTitle() returns "ambiguous" rather than picking. A subject
// decides which per-subject minimum a course counts toward, so a wrong
// one reports a requirement as met when it is not.

import type { SubjectArea } from "./coreGpa";
import { normalizeCourseTitle } from "./approvedCourses";

// The category names the NCAA prints, and the ones schools print instead
// of them. Matched on a normalized form, so spacing and punctuation do
// not matter. Anything not in here is left for a person.
const SUBJECT_WORDS: Array<[RegExp, SubjectArea]> = [
  [/^english( language arts)?$/, "english"],
  [/^(ela|la)$/, "english"],
  [/^math(ematics)?$/, "math"],
  [/^(natural ?\/? ?physical )?science$/, "science"],
  [/^natural science$/, "science"],
  [/^physical science$/, "science"],
  [/^social (science|studies)$/, "social_science"],
  [/^history$/, "social_science"],
  [/^additional (core )?(courses?)?$/, "other_academic"],
  [/^additional$/, "other_academic"],
  [/^(world|foreign) language$/, "other_academic"],
  [/^(comparative )?religion$/, "other_academic"],
  [/^philosophy$/, "other_academic"],
  [/^non ?doctrinal religion$/, "other_academic"],
];

// A subject word as it might appear in a cell, normalized for matching.
//
// A cell containing a digit is never a category. This is not a nicety:
// stripping digits first turned "English 9" into "english", which
// matched the English category exactly, so the course title was consumed
// as the subject and the row imported as a course called "English" with
// no title of its own. Every numbered course in a list did this.
function toSubject(cell: string): SubjectArea | null {
  const raw = cell.trim();
  if (!raw || /\d/.test(raw)) return null;
  const s = raw.toLowerCase().replace(/[^a-z/ ]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  for (const [re, subject] of SUBJECT_WORDS) if (re.test(s)) return subject;
  return null;
}

// A credit figure, if a cell is one. "1", "1.0", "0.50", ".5".
function toCredit(cell: string): number | null {
  const m = cell.trim().match(/^(\d+(\.\d+)?|\.\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  // Above 2 it is not a course credit, it is a row number or a year.
  return Number.isFinite(n) && n > 0 && n <= 2 ? n : null;
}

const WEIGHTED = /\b(ap|advanced placement|ib|honors?|dual enrollment|de|gifted)\b/i;

export interface ParsedRow {
  title: string;
  // Null when the paste did not name a subject this parser recognises.
  // The review screen requires one before the list can be saved.
  subject: SubjectArea | null;
  maxCredit: number | null;
  weighted: boolean;
  // What the parser could not settle about this row, in a sentence.
  problem: string | null;
  // The line as pasted, so a person checking the import can see what it
  // came from rather than only what it became.
  raw: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  // Lines that carried nothing usable: headers, page furniture, blanks.
  // Reported rather than dropped silently, so a paste that went wrong
  // does not look like a short list.
  ignored: string[];
  // Rows whose title normalizes to one already in the list. Kept, and
  // flagged, because two rows that normalize the same make every course
  // matching either one permanently ambiguous.
  duplicates: number;
}

// Header words that mean a line is describing the table, not in it.
const HEADER = /^(course|title|course title|subject|category|area|credit|units?|notes?|status|approved)\b/i;
// Furniture the portal page carries around the table.
const FURNITURE = /^(page \d|printed|generated|ceeb|high school code|total|showing \d|\d+ of \d+|results?)\b/i;

// Splits one line into cells. Tabs win when present, because a paste out
// of a table is tab separated and a title legitimately contains spaces.
// Two or more spaces is the fallback, then a comma, and the comma comes
// last because a title can contain one and a tab never does.
function cells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((c) => c.trim());
  // "Algebra II - Mathematics", "Algebra II: Mathematics". The colon
  // usually has no space before it, so only the space after is required.
  const dash = line.split(/\s*[:|]\s+|\s+-\s+/).map((c) => c.trim());
  if (dash.length > 1) return dash;
  if (line.includes(",")) return line.split(",").map((c) => c.trim());
  return [line.trim()];
}

export function parseApprovedListPaste(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (HEADER.test(line) || FURNITURE.test(line)) {
      ignored.push(line);
      continue;
    }

    const parts = cells(line).filter((c) => c.length > 0);
    if (parts.length === 0) continue;

    // The title is the first cell that is not a subject word and not a
    // bare number. Working it out this way rather than assuming column
    // one survives a list that leads with a credit or a category.
    let title = "";
    let subject: SubjectArea | null = null;
    let maxCredit: number | null = null;

    for (const cell of parts) {
      const asSubject = toSubject(cell);
      const asCredit = toCredit(cell);
      if (asSubject && subject === null) {
        subject = asSubject;
        continue;
      }
      if (asCredit !== null && maxCredit === null) {
        maxCredit = asCredit;
        continue;
      }
      if (!title) title = cell;
    }

    if (!title) {
      ignored.push(line);
      continue;
    }
    // A single letter or a stray number is not a course.
    if (title.replace(/[^a-z]/gi, "").length < 2) {
      ignored.push(line);
      continue;
    }

    const key = normalizeCourseTitle(title);
    const isDupe = seen.has(key);
    if (isDupe) duplicates++;
    seen.add(key);

    rows.push({
      title,
      subject,
      maxCredit,
      weighted: WEIGHTED.test(title),
      problem: isDupe
        ? "Already on the list above. Two rows with the same title make both unmatchable."
        : subject === null
          ? "No NCAA subject area in the paste. Pick one."
          : null,
      raw: line,
    });
  }

  return { rows, ignored, duplicates };
}

// A one-line summary for the review screen, so the state of an import is
// readable before any of the rows are.
export function describeParse(r: ParseResult): string {
  const needSubject = r.rows.filter((x) => x.subject === null).length;
  const bits = [`${r.rows.length} ${r.rows.length === 1 ? "course" : "courses"}`];
  if (needSubject) bits.push(`${needSubject} need a subject`);
  if (r.duplicates) bits.push(`${r.duplicates} duplicate${r.duplicates === 1 ? "" : "s"}`);
  if (r.ignored.length) bits.push(`${r.ignored.length} line${r.ignored.length === 1 ? "" : "s"} skipped`);
  return bits.join(" · ");
}

// Whether the parsed rows can be saved as they stand.
export function parseIsSaveable(r: ParseResult): boolean {
  return r.rows.length > 0 && r.rows.every((x) => x.subject !== null && x.problem === null);
}
