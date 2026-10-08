// Doc AI rebuild, Piece 2: who a document is probably about, and what
// kind of thing it probably is. Suggestions only.
//
// The rules (Dave's locked design, 2026-10-06):
//   - Nothing here links a document to an athlete. It proposes; a person
//     confirms. A name alone is never an identification, and a surname
//     alone is not even a proposal (two brothers share one).
//   - The type is provisional: a lightweight "what kind of thing is
//     this", read off the file name, the type somebody picked at upload,
//     the format, and for files that carry plain words (Word, Excel, CSV,
//     TXT) the words themselves. No model reads anything here and nothing
//     is extracted. Piece 3's formal taxonomy re-checks these labels.
//   - Every suggestion carries its reasons, so a person can see why.
//
// Walled module: no Next, no Supabase, no Node built-ins. The caller
// hands in the file name, a text sample it already pulled out of the
// bytes, and the org's roster.

import type { DocCategoryId } from "./types";

// ── Provisional types ───────────────────────────────────────────────
// Frozen ids from the 30-type taxonomy (design 2026-10-06), so Piece 3
// re-validates a label rather than renaming it. Only the ones a file
// name or a header row can plausibly point at are suggested here.
export const PROVISIONAL_TYPES = [
  "transcript",
  "academic_progress_report",
  "test_score_report",
  "course_plan",
  "school_list",
  "recruiting_plan",
  "athletic_offer_letter",
  "eligibility_registration_record",
  "eligibility_guidance",
  "athletic_metrics_report",
  "assignment_instructions",
  "assignment_tracker",
  "financial_aid_award",
  "athlete_profile_resume",
  "recommendation_letter",
  "schedule",
  "other",
] as const;
export type ProvisionalType = (typeof PROVISIONAL_TYPES)[number];

export const PROVISIONAL_TYPE_LABEL: Record<ProvisionalType, string> = {
  transcript: "Transcript",
  academic_progress_report: "Progress Report",
  test_score_report: "Test Scores",
  course_plan: "Course Plan",
  school_list: "College List",
  recruiting_plan: "Recruiting Plan",
  athletic_offer_letter: "Offer Letter",
  eligibility_registration_record: "NCAA Registration",
  eligibility_guidance: "NCAA Guide",
  athletic_metrics_report: "Metrics Report",
  assignment_instructions: "Assignment Instructions",
  assignment_tracker: "Assignment Tracker",
  financial_aid_award: "Financial Aid",
  athlete_profile_resume: "Athlete Profile",
  recommendation_letter: "Recommendation",
  schedule: "Schedule",
  other: "Other",
};

// The six old upload types, as the taxonomy names them.
const FROM_OLD_TYPE: Record<DocCategoryId, ProvisionalType> = {
  transcript: "transcript",
  test_scores: "test_score_report",
  offer_letter: "athletic_offer_letter",
  recommendation: "recommendation_letter",
  financial_aid: "financial_aid_award",
  metrics: "athletic_metrics_report",
  film: "other",
};

// Words and phrases that point at a type. A phrase is matched against the
// words in order ("progress report"), a single word against any word.
// Order inside a list does not matter; specific phrases score above
// single words (PHRASE_WEIGHT).
const CUES: Record<Exclude<ProvisionalType, "other">, string[]> = {
  transcript: ["transcript", "official transcript", "unofficial transcript", "academic record", "cumulative gpa"],
  academic_progress_report: ["progress report", "report card", "quarter grades", "interim report", "midterm grades"],
  test_score_report: ["sat", "act", "psat", "score report", "test scores", "composite score", "superscore"],
  course_plan: ["course plan", "four year plan", "schedule of classes", "course selection", "course list"],
  school_list: ["college list", "school list", "target list", "target schools", "colleges", "schools list"],
  recruiting_plan: ["recruiting plan", "recruiting timeline", "recruiting strategy", "outreach plan"],
  athletic_offer_letter: ["offer letter", "scholarship offer", "letter of intent", "nli", "athletic scholarship"],
  eligibility_registration_record: ["ncaa id", "eligibility center id", "registration confirmation", "eligibility id"],
  eligibility_guidance: ["ncaa", "eligibility center", "registration guide", "eligibility", "core courses", "guide for the college bound"],
  athletic_metrics_report: ["perfect game", "pbr", "prep baseball", "trackman", "rapsodo", "metrics", "showcase", "exit velo", "sixty time"],
  assignment_instructions: ["assignment", "instructions", "homework", "directions", "due date"],
  assignment_tracker: ["tracker", "checklist", "progress tracker", "assignment tracker"],
  financial_aid_award: ["award letter", "financial aid", "aid package", "aid offer", "cost of attendance", "net cost"],
  athlete_profile_resume: ["resume", "athlete profile", "player profile", "bio", "recruiting profile"],
  recommendation_letter: ["recommendation", "letter of recommendation", "reference letter", "rec letter"],
  schedule: ["schedule", "calendar", "itinerary", "game schedule"],
};

const NAME_WEIGHT = 0.55; // a cue in the file name
const TEXT_WEIGHT = 0.3; // a cue in the words of the file
const PHRASE_BONUS = 0.1; // a several-word cue is more specific
const PICKED_WEIGHT = 0.7; // the type somebody picked at upload
const SHEET_BONUS = 0.1; // a spreadsheet leans toward a tracker or a list

export interface TypeSuggestion {
  type: ProvisionalType;
  confidence: number; // 0 to 1
  reasons: string[];
}

// Lower case, letters and digits only, camelCase and snake_case split.
export function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)|(\d)([A-Za-z])/g, (_m, a, b, c, d) => (a ? `${a} ${b}` : `${c} ${d}`))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function hasCue(words: string[], cue: string): boolean {
  const parts = cue.split(" ");
  if (parts.length === 1) return words.includes(parts[0]!);
  outer: for (let i = 0; i + parts.length <= words.length; i++) {
    for (let j = 0; j < parts.length; j++) if (words[i + j] !== parts[j]) continue outer;
    return true;
  }
  return false;
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export function suggestType(input: { fileName: string; format: string; pickedType?: DocCategoryId | null; textSample?: string | null }): TypeSuggestion {
  const nameWords = wordsOf(stripExtension(input.fileName));
  const textWords = input.textSample ? wordsOf(input.textSample) : [];
  const scores = new Map<ProvisionalType, { score: number; reasons: string[] }>();
  const add = (type: ProvisionalType, points: number, reason: string) => {
    const s = scores.get(type) ?? { score: 0, reasons: [] };
    s.score += points;
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
    scores.set(type, s);
  };

  for (const [type, cues] of Object.entries(CUES) as [Exclude<ProvisionalType, "other">, string[]][]) {
    // One cue per source counts: five synonyms in one file name are not
    // five times the evidence. The most specific cue found wins.
    const inName = cues.filter((c) => hasCue(nameWords, c)).sort((a, b) => b.length - a.length)[0];
    if (inName) add(type, NAME_WEIGHT + (inName.includes(" ") ? PHRASE_BONUS : 0), `File name says "${inName}"`);
    // In running text a short word is too often just a word ("sat",
    // "act", "bio"), so inside a file only a phrase or a word of seven
    // letters or more counts. A file name is short and deliberate; there
    // every cue counts.
    const inText = cues.filter((c) => (c.includes(" ") || c.length >= 7) && hasCue(textWords, c)).sort((a, b) => b.length - a.length)[0];
    if (inText) add(type, TEXT_WEIGHT + (inText.includes(" ") ? PHRASE_BONUS : 0), `The file mentions "${inText}"`);
  }

  if (input.pickedType) {
    const t = FROM_OLD_TYPE[input.pickedType];
    if (t !== "other") add(t, PICKED_WEIGHT, "Picked at upload");
  }

  if (input.format === "excel" || input.format === "csv") {
    for (const t of ["assignment_tracker", "school_list"] as const) {
      if (scores.has(t)) add(t, SHEET_BONUS, "A spreadsheet");
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score || PROVISIONAL_TYPES.indexOf(a[0]) - PROVISIONAL_TYPES.indexOf(b[0]));
  const top = ranked[0];
  if (!top) return { type: "other", confidence: 0, reasons: ["Nothing in the name or the words points at a type"] };
  const reasons = [...top[1].reasons];
  const runnerUp = ranked[1];
  // A close second is said out loud rather than hidden.
  if (runnerUp && top[1].score - runnerUp[1].score < 0.15) reasons.push(`Could also be ${PROVISIONAL_TYPE_LABEL[runnerUp[0]]}`);
  return { type: top[0], confidence: round(Math.min(0.95, top[1].score)), reasons };
}

// ── Who it is about ─────────────────────────────────────────────────

export interface RosterEntry {
  id: string;
  name: string;
  // Shown beside a candidate so a person can tell two names apart
  // ("Jordan Rivera · Central High · Class of 2027"). Never scored: a
  // school or a year alone identifies nobody.
  school?: string | null;
  gradYear?: number | null;
  // Sign-in emails of the athlete's linked family logins. An exact email
  // in the file is the strongest signal there is, short of a person.
  emails?: string[];
}

export interface IdentityCandidate {
  athleteId: string;
  name: string;
  school?: string | null;
  gradYear?: number | null;
  score: number; // 0 to 1
  reasons: string[];
}

// unmatched: nobody on the roster is named.
// proposed:  one clear candidate, waiting for a person to confirm.
// ambiguous: two or more candidates too close to call.
export type IdentityStatus = "unmatched" | "proposed" | "ambiguous";

export interface IdentitySuggestion {
  status: IdentityStatus;
  candidates: IdentityCandidate[];
}

const FULL_NAME_IN_FILE_NAME = 0.8;
const FULL_NAME_IN_TEXT = 0.7;
const EMAIL_IN_TEXT = 0.95;
const ID_IN_TEXT = 0.95;
const BOTH_PLACES_BONUS = 0.1;
const PROPOSE_AT = 0.5; // below this a candidate is not shown
const TOO_CLOSE = 0.15; // two candidates within this are ambiguous
const MAX_CANDIDATES = 3;

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

// A name part matches a word exactly, or, for a part of five letters or
// more, within one typo ("Ulloa" and "Uloa"). Short parts must be exact:
// "Ian" is one letter from "Jan".
function partIn(part: string, words: Set<string>): boolean {
  if (words.has(part)) return true;
  if (part.length < 5) return false;
  for (const w of words) if (w.length >= 4 && Math.abs(w.length - part.length) <= 1 && levenshtein(part, w) <= 1) return true;
  return false;
}

// Given and family name, from the roster's own spelling. Middle names and
// suffixes are ignored; a parenthesised nickname is dropped.
function nameParts(name: string): { given: string; family: string[] } | null {
  const words = wordsOf(name.replace(/\([^)]*\)/g, " ")).filter((w) => !["jr", "sr", "ii", "iii", "iv"].includes(w));
  if (words.length < 2) return null;
  return { given: words[0]!, family: words.slice(1) };
}

// Both the given name and every word of the family name appear. The family
// name alone never counts.
function fullNameIn(name: string, words: Set<string>): boolean {
  const parts = nameParts(name);
  if (!parts) return false;
  // A multi-word family name ("De Los Santos") needs its last word at least.
  const familyHit = parts.family.length === 1 ? partIn(parts.family[0]!, words) : partIn(parts.family[parts.family.length - 1]!, words);
  return familyHit && partIn(parts.given, words);
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function suggestIdentity(input: { fileName: string; textSample?: string | null; roster: RosterEntry[] }): IdentitySuggestion {
  const nameWords = new Set(wordsOf(stripExtension(input.fileName)));
  const textWords = new Set(input.textSample ? wordsOf(input.textSample) : []);
  const emailsInText = new Set((input.textSample?.match(EMAIL) ?? []).map((e) => e.toLowerCase()));
  const lowerText = (input.textSample ?? "").toLowerCase();

  const candidates: IdentityCandidate[] = [];
  for (const athlete of input.roster) {
    let score = 0;
    const reasons: string[] = [];
    const inName = fullNameIn(athlete.name, nameWords);
    const inText = textWords.size > 0 && fullNameIn(athlete.name, textWords);
    const byEmail = (athlete.emails ?? []).some((e) => emailsInText.has(e.toLowerCase()));
    if (inName) {
      score = Math.max(score, FULL_NAME_IN_FILE_NAME);
      reasons.push("Name in the file name");
    }
    if (inText) {
      score = Math.max(score, FULL_NAME_IN_TEXT);
      reasons.push("Name in the file");
    }
    if (inName && inText) score += BOTH_PLACES_BONUS;
    if (byEmail) {
      score = Math.max(score, EMAIL_IN_TEXT);
      reasons.push("A family email in the file");
    }
    // The app's own id for the athlete, printed on something the app
    // produced (an export, a tracker). Exact or nothing.
    if (athlete.id.length >= 8 && lowerText.includes(athlete.id.toLowerCase())) {
      score = Math.max(score, ID_IN_TEXT);
      reasons.push("Their Bridge ID in the file");
    }
    if (score >= PROPOSE_AT) {
      candidates.push({ athleteId: athlete.id, name: athlete.name, school: athlete.school ?? null, gradYear: athlete.gradYear ?? null, score: round(Math.min(0.95, score)), reasons });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const shown = candidates.slice(0, MAX_CANDIDATES);
  if (!shown.length) return { status: "unmatched", candidates: [] };
  const [first, second] = shown;
  const status: IdentityStatus = second && first!.score - second.score < TOO_CLOSE ? "ambiguous" : "proposed";
  return { status, candidates: shown };
}

// What a confidence reads as on a screen.
export function confidenceLabel(score: number): "High" | "Medium" | "Low" {
  if (score >= 0.85) return "High";
  if (score >= 0.6) return "Medium";
  return "Low";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
