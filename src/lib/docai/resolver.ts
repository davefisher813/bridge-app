// Identity resolution: matching an extracted document to an athlete
// already on the roster. Faithful port of Bridge's Engine.resolver
// (bffsa-site/index.html ~lines 2432-2549), with the org boundary
// implicit in whatever roster array the caller passes in (this module
// never queries a database itself - see docs/ARCHITECTURE.md on the fit
// engine's equivalent "pure functions over plain types" design, which
// this follows for the same reason: portable to a standalone product
// later).

import type { ResolverAthlete, ResolverCandidate } from "./types";

function tokens(s: string | undefined): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter++;
  });
  const uni = new Set([...A, ...B]).size;
  return inter / uni;
}

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

export function nameMatch(a: string | undefined, b: string | undefined): number {
  const na = (a || "").toLowerCase().trim();
  const nb = (b || "").toLowerCase().trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(na);
  const tb = tokens(nb);
  const j = jaccard(ta, tb);
  const lastA = ta[ta.length - 1] || "";
  const lastB = tb[tb.length - 1] || "";
  const lastDist = levenshtein(lastA, lastB) / Math.max(lastA.length, lastB.length, 1);
  const lastSim = 1 - lastDist;
  return Math.max(j, lastSim * 0.85);
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
