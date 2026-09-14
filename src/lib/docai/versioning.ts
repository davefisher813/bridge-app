// Reconciling a new extraction against prior ones for the same athlete
// and category: is this a replacement of stale data, or a genuinely new
// period (a new transcript for a new semester, not a re-upload of the
// same one)? Faithful port of Bridge's Engine.versioning
// (bffsa-site/index.html ~lines 2385-2430), with one deliberate change:
// Bridge kept its own version index in localStorage
// (`bffsa_engine_versions`); here the caller passes in prior versions
// queried from the database (a `document_versions` table, not yet
// created - see docs/CURRENT_STATE.md), because localStorage doesn't
// exist server-side and isn't shared across an org's users anyway.

import type { VersionClassification, VersionEntry } from "./types";

export function classifyAgainstPrior(extracted: { gpa?: number | null; gradYear?: number | null }, priors: VersionEntry[]): VersionClassification {
  if (!priors.length) return { kind: "first" };

  const latest = priors[priors.length - 1]!;
  const gpaChanged = extracted.gpa != null && latest.gpa != null && Math.abs(extracted.gpa - latest.gpa) > 0.01;
  const gradMatches = extracted.gradYear != null && extracted.gradYear === latest.gradYear;
  const recencyDays = (Date.now() - new Date(latest.ts).getTime()) / (1000 * 60 * 60 * 24);

  if (gradMatches && recencyDays < 180) {
    return {
      kind: "likely_replacement",
      latest,
      reason: gpaChanged
        ? `Updated GPA (${latest.gpa} -> ${extracted.gpa}) for the same grad year ${latest.gradYear}`
        : `Same grad year ${latest.gradYear}, uploaded ${Math.round(recencyDays)} day(s) ago`,
    };
  }
  return { kind: "new_period", latest };
}
