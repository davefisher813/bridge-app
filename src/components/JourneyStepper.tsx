import { JOURNEY_STAGES, type JourneyResult } from "@/lib/journey";

// Presentational only - all the "which stage is this athlete at" logic
// lives in src/lib/journey.ts (pure, tested, no React) so it can be
// reused anywhere without a component tree.
export function JourneyStepper({ result }: { result: JourneyResult }) {
  return (
    <div>
      {/*
        Catalog item J1: connected dots, and the line fills behind them as
        stages complete. Done is success green, the current stage is accent
        and renders larger, stages ahead are the line color. The segment
        between two nodes belongs to the node on its left, so a segment is
        filled only once the stage before it is actually done.
        See docs/STYLING_CATALOG.md.
      */}
      <div className="flex items-center">
        {JOURNEY_STAGES.map((label, i) => {
          const stepNum = i + 1;
          const done = stepNum < result.stageIndex;
          const current = stepNum === result.stageIndex;
          return (
            <div key={label} className="relative flex flex-1 flex-col items-center gap-2">
              {i > 0 && (
                <div
                  className={`absolute left-[-50%] top-[6px] h-0.5 w-full ${
                    stepNum <= result.stageIndex ? "bg-success" : "bg-line"
                  }`}
                />
              )}
              {/*
                The dots differ in size, so each sits in a fixed 14px box.
                That keeps every dot's center on the same line as the
                connector, which is set to match at top-[6px].
              */}
              <div className="z-10 flex h-[14px] items-center">
                <div
                  className={`rounded-full ${
                    current
                      ? "h-[13px] w-[13px] bg-accent"
                      : done
                        ? "h-[10px] w-[10px] bg-success"
                        : "h-[10px] w-[10px] bg-line"
                  }`}
                />
              </div>
              <div className={`text-center text-[11px] font-bold ${done || current ? "text-ink" : "text-muted"}`}>{label}</div>
            </div>
          );
        })}
      </div>
      {result.furthestTarget ? (
        <p className="mt-2.5 text-[12px] text-muted">
          Furthest stage: {result.furthestTarget.status} ({result.furthestTarget.schoolName})
        </p>
      ) : (
        <p className="mt-2.5 text-[12px] text-muted">No active targets yet.</p>
      )}
    </div>
  );
}
