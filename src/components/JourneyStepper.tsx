import { JOURNEY_STAGES, type JourneyResult } from "@/lib/journey";

// Presentational only - all the "which stage is this athlete at" logic
// lives in src/lib/journey.ts (pure, tested, no React) so it can be
// reused anywhere without a component tree.
export function JourneyStepper({ result }: { result: JourneyResult }) {
  return (
    <div>
      <div className="flex items-center">
        {JOURNEY_STAGES.map((label, i) => {
          const stepNum = i + 1;
          const done = stepNum < result.stageIndex;
          const current = stepNum === result.stageIndex;
          return (
            <div key={label} className="relative flex flex-1 flex-col items-center gap-1.5">
              {i > 0 && (
                <div
                  className={`absolute left-[-50%] top-[11px] h-0.5 w-full ${
                    stepNum <= result.stageIndex ? "bg-accent" : "bg-line"
                  }`}
                />
              )}
              <div
                className={`z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-extrabold ${
                  done
                    ? "bg-accent text-white"
                    : current
                      ? "border-2 border-accent bg-paper text-accent"
                      : "border-2 border-line bg-paper text-muted"
                }`}
              >
                {done ? "✓" : stepNum}
              </div>
              <div className={`text-center text-[9.5px] font-bold ${done || current ? "text-ink" : "text-muted"}`}>{label}</div>
            </div>
          );
        })}
      </div>
      {result.furthestTarget ? (
        <p className="mt-2.5 text-[11px] text-muted">
          Furthest stage: {result.furthestTarget.status} ({result.furthestTarget.schoolName})
        </p>
      ) : (
        <p className="mt-2.5 text-[11px] text-muted">No active targets yet.</p>
      )}
    </div>
  );
}
