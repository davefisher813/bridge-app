// Shared types for the fit engine. See docs/ARCHITECTURE.md for why this
// replaces Bridge's calcCollegeFit/calcAcademicFitTag/calcAthleticFitTag/
// calcFinancialFitTag patch stack with one model.

export type RecruitType = "hs" | "transfer_4to4" | "transfer_juco" | "transfer_grad";

export type FitTag = "Conflict" | "Reach" | "Fit" | "Safety" | "Unknown";

export interface DimensionResult {
  score: number; // 0-100. Unknown dimensions still return a score (50, neutral) so the
  // weighted average never silently drops a missing dimension to zero.
  confidence: "high" | "medium" | "low" | "unknown";
  veto: boolean; // true = this dimension found a hard conflict; overrides the blend.
  reasons: string[];
  warnings: string[];
}

export interface Athlete {
  id: string;
  orgId: string;
  recruitType: RecruitType;
  name: string;
  sport: string;
  position?: string;
  gpa?: number;
  gpaVerified?: boolean;
  isInternational?: boolean;
  toeflScore?: number;
  ieltsScore?: number;
  f1VisaStatus?: string;
  ncaaEligibilityStatus?: string;
  measurables?: Record<string, number>;
  detail?: AthleteDetail;
}

// Shape of athletes.detail, validated by src/lib/fit/schema.ts, not by Postgres.
export type AthleteDetail =
  | { kind: "hs"; gradYear?: number; apCount?: number; ibCount?: number; honorsCount?: number; dualCount?: number; satTotal?: number; actComposite?: number; desiredMajor?: string }
  | {
      kind: "transfer";
      currentSchool: string;
      currentDivision?: string;
      collegeGpa?: number;
      creditHoursCompleted?: number;
      eligibilityYearsRemaining: number;
      portalEntryDate?: string; // ISO date
      transferCount: number; // how many times this athlete has already transferred
      degreeCompleted?: boolean; // relevant for transfer_grad only
      desiredMajor?: string;
    };

export interface School {
  id: string;
  name: string;
  division: string;
  conference?: string;
  sportsSponsored: string[];
  academics?: {
    gpaMin?: number;
    gpaAvg?: number;
    satRange?: string;
    actRange?: string;
    majorAvailability?: Record<string, { offered: boolean; accreditationNotes?: string }>;
  };
  financials?: {
    athleticScholarship?: "full" | "partial" | "none";
    avgAthleticAid?: number;
    avgMeritAid?: number;
    avgNeedAid?: number;
    outstateTotal?: number;
    instateTotal?: number;
    rosterSpotsOpen?: number; // D1 post-House-settlement signal; see docs/BUSINESS_RULES.md
  };
  athletics?: {
    playingTimeOutlook?: "realistic" | "competitive" | "difficult";
    positionDepth?: string;
  };
  conflicts?: Array<{ type: string; severity: "conflict" | "warning"; message: string }>;
  profileDate?: string;
}

// Mirrors migrations/0001_core_schema.sql's transfer_windows table.
// Portal windows are sport-specific, short, and change most years by NCAA
// vote, so they are always passed in as data the caller fetched, never
// hardcoded here. See docs/BUSINESS_RULES.md.
export interface TransferWindow {
  sport: string;
  division: string;
  seasonYear: string;
  windowLabel: string;
  opensOn: string; // ISO date
  closesOn: string; // ISO date
}

export interface RecruitingSignals {
  offer?: { offerType: "scholarship" | "written" | "verbal" | "preferred_walk_on" | "admission_only" | "walk_on"; scholarshipPercent?: number };
  visitCount?: number;
  commCount?: number;
  similarPlacementCount?: number; // FIT-14 historical benchmarking, ported as a signal input
}

export interface FitResult {
  tag: FitTag;
  score: number;
  academic: DimensionResult;
  athletic: DimensionResult;
  financial: DimensionResult;
  eligibility?: DimensionResult; // present only for transfer recruit types
  reasons: string[];
  warnings: string[];
}
