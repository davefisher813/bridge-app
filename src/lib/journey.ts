// The athlete-level "recruiting journey" (Profile / In Contact / Visits /
// Committed) shown on the athlete profile screen. Dave's call: derive it
// live from each of the athlete's recruiting_targets.status values,
// never store it as its own field - so it can never drift from the
// targets it's summarizing. See docs/DECISIONS.md.

export const JOURNEY_STAGES = ["Profile", "In Contact", "Visits", "Committed"] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

// recruiting_targets.status values, per migrations/0001_core_schema.sql.
const STAGE_BY_STATUS: Record<string, number> = {
  Target: 1,
  "In Contact": 2,
  Visit: 3,
  Offer: 3,
  Committed: 4,
  "Not Interested": 0, // excluded from the "furthest" calculation entirely
};

export interface JourneyResult {
  stageIndex: number; // 1-4, index into JOURNEY_STAGES (1-based)
  stage: JourneyStage;
  furthestTarget: { schoolName: string; status: string } | null;
}

// Takes the furthest stage across all of an athlete's targets, ignoring
// "Not Interested" ones. An athlete with no targets yet, or only
// "Not Interested" targets, is stage 1 (Profile) - a real state, not a
// missing one.
export function deriveJourneyStage(
  targets: { status: string; schoolName: string }[]
): JourneyResult {
  let best = { stageIndex: 0, schoolName: "", status: "" };
  for (const t of targets) {
    const idx = STAGE_BY_STATUS[t.status];
    if (idx === undefined || idx === 0) continue;
    if (idx > best.stageIndex) {
      best = { stageIndex: idx, schoolName: t.schoolName, status: t.status };
    }
  }
  const stageIndex = best.stageIndex === 0 ? 1 : best.stageIndex;
  return {
    stageIndex,
    stage: JOURNEY_STAGES[stageIndex - 1],
    furthestTarget: best.stageIndex === 0 ? null : { schoolName: best.schoolName, status: best.status },
  };
}
