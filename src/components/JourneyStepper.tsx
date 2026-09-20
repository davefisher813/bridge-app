import { JOURNEY_STAGES, type JourneyResult } from "@/lib/journey";
import { Label } from "@/components/kit";

// Presentational only - all the "which stage is this athlete at" logic
// lives in src/lib/journey.ts (pure, tested, no React) so it can be
// reused anywhere without a component tree.
//
// Connected dots, and the line fills behind them as stages complete.
// Done is success green, the current stage is accent and renders larger,
// stages ahead are the line colour. The segment between two nodes
// belongs to the node on its right, drawn from its centre back to the
// previous centre.
export function JourneyStepper({ result }: { result: JourneyResult }) {
  return (
    // Out to the panel's edges: four labels in the panel's inner width
    // left 64px each at 320 wide, and COMMITTED is 70. The caption below
    // pads itself back in.
    <div className="-mx-4 flex flex-col gap-3">
      <div className="flex items-start">
        {JOURNEY_STAGES.map((label, i) => {
          const stepNum = i + 1;
          const done = stepNum < result.stageIndex;
          const current = stepNum === result.stageIndex;
          return (
            <div key={label} className="relative flex flex-1 flex-col items-center gap-2">
              {i > 0 && <div className={`absolute right-1/2 top-2 h-px w-full ${stepNum <= result.stageIndex ? "bg-success" : "bg-line"}`} />}
              <div className="relative flex h-4 items-center">
                <div className={`rounded-full ${current ? "h-4 w-4 bg-accent" : done ? "h-3 w-3 bg-success" : "h-3 w-3 bg-line"}`} />
              </div>
              <div className={`text-center text-label font-bold ${done || current ? "text-ink" : "text-muted"}`}>{label}</div>
            </div>
          );
        })}
      </div>
      <div className="px-4">
        {result.furthestTarget ? (
          <Label>
            Furthest stage: {result.furthestTarget.status} ({result.furthestTarget.schoolName})
          </Label>
        ) : (
          <Label>No active targets yet.</Label>
        )}
      </div>
    </div>
  );
}
