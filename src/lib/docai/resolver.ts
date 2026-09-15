// Identity resolution: matching an extracted document to an athlete
// already on the roster. Faithful port of Bridge's Engine.resolver
// (bffsa-site/index.html ~lines 2432-2549), with the org boundary
// implicit in whatever roster array the caller passes in (this module
// never queries a database itself - see docs/ARCHITECTURE.md on the fit
// engine's equivalent "pure functions over plain types" design, which
// this follows for the same reason: portable to a standalone product
// later).

import type { ResolverAthlete, ResolverCandidate } from "./types";

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[][] = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 0; j <= b.length; j++) m[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i]![j] = Math.min(m[i - 1]![j]! + 1, m[i]![j - 1]! + 1, m[i - 1]![j - 1]! + cost);
    }
  }
  return m[a.length]![b.length]!;
}

// Name comparison is structural, not bag-of-words. The first version
// here scored token overlap (Jaccard) against a surname-similarity
// fallback, and running it against Dave's real roster and real
// transcripts showed two failures that mattered:
//
//   1. Every official transcript prints "Lastname, Firstname Middlename".
//      The middle name is a third token the roster does not have, so
//      Jaccard capped at 2/3 = 0.667 and the combined candidate score
//      landed at 0.581 - under NAME_MATCH_AUTO. No real transcript could
//      ever auto-apply, for a document that names the athlete exactly.
//   2. The surname fallback was worth 0.85 on its own, so the bare token
//      "Branche" scored 0.85 against both Branche brothers on the
//      roster and auto-applied one boy's transcript to whichever sorted
//      first. A surname is not an identification.
//
// So: parse the name into given and family parts (handling the comma
// form, multi-word surnames like "De Los Santos", parenthesised
// nicknames, and generational suffixes), score those two parts
// separately, and refuse to treat a surname on its own as a match.
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

interface ParsedName {
  given: string;
  family: string;
}

function parseName(raw: string | undefined): ParsedName | null {
  const cleaned = (raw || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "Jayden (JJ) Batista"
    .replace(/[^a-z\s,]/g, " ");
  const strip = (parts: string[]) => parts.filter((t) => t && !NAME_SUFFIXES.has(t));
  const comma = cleaned.indexOf(",");

  if (comma >= 0) {
    const family = strip(cleaned.slice(0, comma).split(/\s+/));
    const given = strip(cleaned.slice(comma + 1).split(/\s+/));
    if (!family.length) return null;
    return { given: given[0] || "", family: family.join(" ") };
  }

  const parts = strip(cleaned.split(/\s+/));
  if (!parts.length) return null;
  if (parts.length === 1) return { given: "", family: parts[0]! };
  return { given: parts[0]!, family: parts[parts.length - 1]! };
}

function ratio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length));
}

// "Santos" and "De Los Santos" are the same family name written two
// ways, which is what the comma form vs the plain form produces for the
// same person.
function familySim(a: string, b: string): number {
  if (a === b) return 1;
  const aw = a.split(" ");
  const bw = b.split(" ");
  if (aw[aw.length - 1] === bw[bw.length - 1]) return 1;
  return ratio(a, b);
}

// An initial is weak evidence, not a match: "D. Branche" must not score
// the same as "Darwins Branche" when there is an Erwins Branche on the
// same roster.
function givenSim(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.55 : 0;
  return ratio(a, b);
}

// A surname with no given name attached. Capped well below
// NAME_MATCH_AUTO so it always goes to a human.
const SURNAME_ONLY_CEILING = 0.5;

export function nameMatch(a: string | undefined, b: string | undefined): number {
  const pa = parseName(a);
  const pb = parseName(b);
  if (!pa || !pb) return 0;

  const family = familySim(pa.family, pb.family);
  if (!pa.given || !pb.given) return family * SURNAME_ONLY_CEILING;
  return 0.6 * family + 0.4 * givenSim(pa.given, pb.given);
}

export interface ExtractedIdentity {
  studentName?: string | null;
  school?: string | null;
  gradYear?: number | null;
}

export function findCandidates(extracted: ExtractedIdentity, roster: ResolverAthlete[], override?: string): ResolverCandidate[] {
  const name = extracted.studentName || "";
  const school = extracted.school || "";
  const grad = extracted.gradYear;

  let ranked: ResolverCandidate[] = roster
    .map((athlete) => {
      const nameScore = nameMatch(athlete.name, name);
      const schoolScore = athlete.school && school ? nameMatch(athlete.school, school) : 0;
      const gradMatch = athlete.gradYear && grad && Number(athlete.gradYear) === Number(grad) ? 1 : 0;
      const score = nameScore * 0.7 + schoolScore * 0.2 + gradMatch * 0.1;
      const reasons: string[] = [];
      if (nameScore > 0.6) reasons.push("Name match");
      if (school && schoolScore > 0.6) reasons.push("School match");
      if (gradMatch) reasons.push("Grad year match");
      return { athlete, score, reasons };
    })
    .filter((x) => x.score > 0.2)
    .sort((a, b) => b.score - a.score);

  if (override && override.length > 2) {
    const ov = override.toLowerCase();
    let pinned: ResolverAthlete | null = null;
    for (const athlete of roster) {
      const n = (athlete.name || "").toLowerCase();
      if (!n || n.length < 3) continue;
      const nameTokens = n.split(/\s+/).filter((t) => t.length > 2);
      const allTokensInOverride = nameTokens.length >= 2 && nameTokens.every((t) => ov.includes(t));
      if (ov.includes(n) || allTokensInOverride) {
        if (!pinned || (athlete.name || "").length > (pinned.name || "").length) pinned = athlete;
      }
    }
    if (pinned) {
      ranked = ranked.filter((c) => c.athlete !== pinned);
      ranked.unshift({ athlete: pinned, score: 1, reasons: [`User override: pinned to ${pinned.name}`] });
    }
  }

  return ranked.slice(0, 5);
}

export function resolveOverrideToAthlete(override: string | undefined, roster: ResolverAthlete[]): ResolverAthlete | null {
  if (!override) return null;
  const ov = override.toLowerCase();
  let best: ResolverAthlete | null = null;
  let bestScore = 0;
  for (const athlete of roster) {
    const n = (athlete.name || "").toLowerCase();
    if (!n) continue;
    const nameTokens = n.split(/\s+/).filter((t) => t.length > 1);
    if (ov.includes(n) && n.length >= 3) {
      if (n.length > bestScore) {
        best = athlete;
        bestScore = n.length;
      }
      continue;
    }
    const nonShort = nameTokens.filter((t) => t.length > 2);
    const matched = nonShort.filter((t) => ov.includes(t));
    if (matched.length >= 2 && matched.length === nonShort.length) {
      const score = matched.join("").length;
      if (score > bestScore) {
        best = athlete;
        bestScore = score;
      }
    }
  }
  return best;
}

export function classifyMatchStrength(score: number): "high" | "mid" | "low" {
  if (score >= 0.85) return "high";
  if (score >= 0.5) return "mid";
  return "low";
}
