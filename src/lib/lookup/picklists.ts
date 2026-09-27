// Suggested values for fields that stay free text. Every one is a
// suggestion, never a constraint: anything typed that is not on a list
// is kept as typed. Pure data plus one helper.

import { SPORTS, normalizeSport } from "@/lib/fit/contract";

// The NCAA Eligibility Center's own stages, as a coordinator would say
// them. src/lib/fit/score.ts reads "Not Registered", "In Progress" and
// "Pending" (any case) to decide which warning to show, so those three
// are spelled exactly that way.
export const NCAA_ELIGIBILITY_STATUSES: readonly string[] = ["Not Registered", "Registered", "In Progress", "Pending", "Final Qualifier", "Academic Redshirt", "Nonqualifier", "Cleared"];

// Where an international athlete's F-1 student visa stands.
export const F1_VISA_STATUSES: readonly string[] = ["Not Needed", "Not Started", "I-20 Requested", "I-20 Issued", "Interview Scheduled", "Visa Approved", "Visa Denied"];

// The position groups for a sport, from the list the athlete form's
// hint already shows ("RHP, LHP, C, MIF, 1B, 3B or OF"). A sport the
// engine does not know has no suggestions.
export function positionsOf(sport: string | null | undefined): string[] {
  const key = normalizeSport(sport ?? "");
  const spec = SPORTS.find((s) => s.key === key);
  if (!spec) return [];
  return spec.positions
    .split(/,\s*|\s+or\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
