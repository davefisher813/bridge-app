import { describe, expect, it } from "vitest";
import { deriveJourneyStage } from "@/lib/journey";

describe("deriveJourneyStage", () => {
  it("returns Profile with no targets", () => {
    const r = deriveJourneyStage([]);
    expect(r.stageIndex).toBe(1);
    expect(r.stage).toBe("Profile");
    expect(r.furthestTarget).toBeNull();
  });

  it("returns Profile when every target is Not Interested", () => {
    const r = deriveJourneyStage([{ status: "Not Interested", schoolName: "A" }]);
    expect(r.stage).toBe("Profile");
  });

  it("returns Profile when the only target is still Target", () => {
    const r = deriveJourneyStage([{ status: "Target", schoolName: "A" }]);
    expect(r.stage).toBe("Profile");
  });

  it("takes the furthest stage across multiple targets", () => {
    const r = deriveJourneyStage([
      { status: "Target", schoolName: "A" },
      { status: "In Contact", schoolName: "B" },
      { status: "Visit", schoolName: "C" },
    ]);
    expect(r.stage).toBe("Visits");
    expect(r.furthestTarget).toEqual({ schoolName: "C", status: "Visit" });
  });

  it("treats Offer the same tier as Visit", () => {
    const r = deriveJourneyStage([{ status: "Offer", schoolName: "A" }]);
    expect(r.stage).toBe("Visits");
  });

  it("returns Committed as soon as any target is Committed, regardless of others", () => {
    const r = deriveJourneyStage([
      { status: "Not Interested", schoolName: "A" },
      { status: "Committed", schoolName: "B" },
      { status: "In Contact", schoolName: "C" },
    ]);
    expect(r.stage).toBe("Committed");
    expect(r.furthestTarget).toEqual({ schoolName: "B", status: "Committed" });
  });

  it("ignores Not Interested targets even when they are the furthest-looking status alphabetically", () => {
    const r = deriveJourneyStage([{ status: "Not Interested", schoolName: "A" }, { status: "In Contact", schoolName: "B" }]);
    expect(r.stage).toBe("In Contact");
  });
});
