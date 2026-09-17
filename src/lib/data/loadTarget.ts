// One loader for everything the target screens need.
//
// Same reasoning as loadEligibility, and the same failure it is guarding
// against. Three screens want the same thing now: the target read view,
// one fit dimension in full, and the contact log. The fit call is sixty
// lines of adapters and signals, and a screen that grew its own copy
// would be one visit count or one transfer window away from showing a
// different score for the same target on two pages, with nothing
// failing anywhere.
//
// The score is computed on every load rather than stored, on purpose: a
// stored score goes stale the moment a GPA or a school profile changes,
// and a stale score on a board is worse than no score, because somebody
// acts on it.

import { createClient } from "@/lib/supabase/server";
import {
  athleteRowToFitAthlete,
  communicationsToSignals,
  schoolRowToFitSchool,
  targetOfferToSignal,
  transferWindowRowToFit,
  visitsToVisitCount,
  type AthleteRow,
  type SchoolRow,
  type TransferWindowRow,
} from "@/lib/data/fitAdapters";
import { scoreFit } from "@/lib/fit/score";
import type { Athlete, FitResult, School } from "@/lib/fit/types";

export interface CommunicationRow {
  target_id: string;
  kind: string;
  notes: string | null;
  // occurred_ON, per migration 0004. It was written as occurred_at here
  // and on the target page, which is a column neither table has, so
  // PostgREST would have errored on every load of both screens.
  // src/laws/schemaLaws.test.ts found it on its first run.
  occurred_on: string | null;
}

export interface VisitRow {
  target_id: string;
  visit_type: string;
  impression: string | null;
  // visit_date, per migration 0006. A visit has a date rather than a
  // timestamp because that is what anybody actually records.
  visit_date: string | null;
}

export interface TargetBundle {
  target: {
    id: string;
    status: string;
    coachName: string | null;
    offerType: string | null;
    offerScholarshipPercent: number | null;
    athleteId: string;
    schoolId: string;
  };
  athlete: Athlete;
  school: School;
  fit: FitResult;
  communications: CommunicationRow[];
  visits: VisitRow[];
}

function unwrap<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function loadTarget(orgId: string, targetId: string): Promise<TargetBundle | null> {
  const supabase = await createClient();

  const [{ data: target }, { data: windowRows }, { data: commRows }, { data: visitRows }] = await Promise.all([
    supabase
      .from("recruiting_targets")
      .select(
        "id, status, coach_name, offer_type, offer_scholarship_percent, athlete_id, school_id, athletes(id, org_id, recruit_type, name, sport, position, gpa, gpa_verified, detail, measurables, is_international, toefl_score, ielts_score, f1_visa_status, ncaa_eligibility_status), schools(id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date)",
      )
      .eq("id", targetId)
      .eq("org_id", orgId)
      .single(),
    supabase.from("transfer_windows").select("sport, division, season_year, window_label, opens_on, closes_on"),
    supabase
      .from("target_communications")
      .select("target_id, kind, notes, occurred_on")
      .eq("target_id", targetId)
      .eq("org_id", orgId)
      .order("occurred_on", { ascending: false }),
    supabase
      .from("target_visits")
      .select("target_id, visit_type, impression, visit_date")
      .eq("target_id", targetId)
      .eq("org_id", orgId)
      .order("visit_date", { ascending: false }),
  ]);

  if (!target) return null;

  const row = target as {
    id: string;
    status: string;
    coach_name: string | null;
    offer_type: string | null;
    offer_scholarship_percent: number | null;
    athlete_id: string;
    school_id: string;
    athletes: AthleteRow | AthleteRow[] | null;
    schools: SchoolRow | SchoolRow[] | null;
  };

  const athleteRow = unwrap(row.athletes);
  const schoolRow = unwrap(row.schools);
  if (!athleteRow || !schoolRow) return null;

  const athlete = athleteRowToFitAthlete(athleteRow);
  const school = schoolRowToFitSchool(schoolRow);
  const communications = (commRows ?? []) as CommunicationRow[];
  const visits = (visitRows ?? []) as VisitRow[];

  const fit = scoreFit(athlete, school, {
    // A committed target is not still being evaluated. Scoring one
    // produces a number that reads as a recommendation about a decision
    // that has already been made.
    isPlaced: row.status === "Committed",
    transferWindows: ((windowRows ?? []) as TransferWindowRow[]).map(transferWindowRowToFit),
    signals: {
      ...communicationsToSignals(communications.map((c) => ({ target_id: c.target_id, kind: c.kind }))),
      visitCount: visitsToVisitCount(visits.map((v) => ({ target_id: v.target_id }))),
      offer: targetOfferToSignal(row),
    },
  });

  return {
    target: {
      id: row.id,
      status: row.status,
      coachName: row.coach_name,
      offerType: row.offer_type,
      offerScholarshipPercent: row.offer_scholarship_percent,
      athleteId: row.athlete_id,
      schoolId: row.school_id,
    },
    athlete,
    school,
    fit,
    communications,
    visits,
  };
}
