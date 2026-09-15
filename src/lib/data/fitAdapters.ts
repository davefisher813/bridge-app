// Adapts raw Supabase rows (snake_case DB columns) into the fit engine's
// plain types (src/lib/fit/types.ts). Lives outside src/lib/fit/ on
// purpose: fit/ stays walled off from anything DB-specific (see
// CLAUDE.md's "no import of Next.js/Supabase specifics" rule), so this
// is the one seam that knows about column names.

import { z } from "zod";
import type { Athlete, RecruitType, RecruitingSignals, School, TransferWindow } from "@/lib/fit/types";
import { parseSchoolAcademics, parseSchoolAthletics, parseSchoolConflicts, parseSchoolFinancials, safeParseAthleteDetail } from "@/lib/fit/schema";

export interface AthleteRow {
  id: string;
  org_id: string;
  recruit_type: RecruitType;
  name: string;
  sport: string;
  position: string | null;
  gpa: number | null;
  gpa_verified: boolean;
  detail: unknown;
  measurables: unknown;
  is_international: boolean;
  toefl_score: number | null;
  ielts_score: number | null;
  f1_visa_status: string | null;
  ncaa_eligibility_status: string | null;
}

const measurablesSchema = z.record(z.string(), z.number()).catch({});

export function athleteRowToFitAthlete(row: AthleteRow): Athlete {
  // A malformed detail blob (hand-edited row, a future migration bug)
  // degrades to "no detail on file" rather than throwing and taking the
  // whole board down - the dimensions that need it just report unknown
  // confidence instead of vetoing on data that was never actually there.
  const detail = safeParseAthleteDetail(row.detail);

  return {
    id: row.id,
    orgId: row.org_id,
    recruitType: row.recruit_type,
    name: row.name,
    sport: row.sport,
    position: row.position ?? undefined,
    gpa: row.gpa ?? undefined,
    gpaVerified: row.gpa_verified,
    isInternational: row.is_international,
    toeflScore: row.toefl_score ?? undefined,
    ieltsScore: row.ielts_score ?? undefined,
    f1VisaStatus: row.f1_visa_status ?? undefined,
    ncaaEligibilityStatus: row.ncaa_eligibility_status ?? undefined,
    measurables: measurablesSchema.parse(row.measurables ?? {}),
    detail: detail.success ? detail.data : undefined,
  };
}

export interface SchoolRow {
  id: string;
  name: string;
  division: string;
  conference: string | null;
  sports_sponsored: string[];
  academics: unknown;
  financials: unknown;
  athletics: unknown;
  conflicts: unknown;
  profile_date: string | null;
}

export function schoolRowToFitSchool(row: SchoolRow): School {
  return {
    id: row.id,
    name: row.name,
    division: row.division,
    conference: row.conference ?? undefined,
    sportsSponsored: row.sports_sponsored ?? [],
    academics: parseSchoolAcademics(row.academics ?? {}),
    financials: parseSchoolFinancials(row.financials ?? {}),
    athletics: parseSchoolAthletics(row.athletics ?? {}),
    conflicts: parseSchoolConflicts(row.conflicts ?? []),
    profileDate: row.profile_date ?? undefined,
  };
}

export interface TransferWindowRow {
  sport: string;
  division: string;
  season_year: string;
  window_label: string;
  opens_on: string;
  closes_on: string;
}

export function transferWindowRowToFit(row: TransferWindowRow): TransferWindow {
  return {
    sport: row.sport,
    division: row.division,
    seasonYear: row.season_year,
    windowLabel: row.window_label,
    opensOn: row.opens_on,
    closesOn: row.closes_on,
  };
}

// migrations/0004_target_communications.sql. Originally this also split
// out a 'visit' kind toward RecruitingSignals.visitCount, but migration
// 0006 added target_visits - a purpose-built log with a visit type,
// impression, and next step, versus a bare kind='visit' log entry with
// none of that. visitCount is now sourced from target_visits
// (visitsToVisitCount, below) instead, so every target_communications
// row - 'visit' kind included, for anyone who logged one before the
// richer Visits tab existed - counts toward commCount. See docs/DECISIONS.md.
export interface TargetCommunicationRow {
  target_id: string;
  kind: string;
}

export function communicationsToSignals(rows: TargetCommunicationRow[]): RecruitingSignals {
  return { commCount: rows.length };
}

// migrations/0006_contacts_and_target_visits.sql. The sole source of
// RecruitingSignals.visitCount - see the comment above.
export interface TargetVisitRow {
  target_id: string;
}

export function visitsToVisitCount(rows: TargetVisitRow[]): number {
  return rows.length;
}

// migrations/0005_recruiting_target_offer_fields.sql. Deliberately not
// derived from recruiting_targets.status = 'Offer' - that's a pipeline
// stage, not an offer record, and score.ts treats a scholarship/written
// offer very differently from a verbal one (see its comment block).
// Null offer_type means no offer exists yet, not an unknown one.
export interface TargetOfferRow {
  offer_type: string | null;
  offer_scholarship_percent: number | null;
}

const OFFER_TYPES = ["scholarship", "written", "verbal", "preferred_walk_on", "admission_only", "walk_on"] as const;
type OfferType = (typeof OFFER_TYPES)[number];

function isOfferType(value: string): value is OfferType {
  return (OFFER_TYPES as readonly string[]).includes(value);
}

export function targetOfferToSignal(row: TargetOfferRow): RecruitingSignals["offer"] {
  if (!row.offer_type || !isOfferType(row.offer_type)) return undefined;
  return {
    offerType: row.offer_type,
    scholarshipPercent: row.offer_scholarship_percent ?? undefined,
  };
}
