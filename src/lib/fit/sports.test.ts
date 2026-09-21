import { describe, expect, it } from "vitest";
import { SPORTS, gradeLabel, normalizeSport, sportSpec } from "./contract";
import { metricsFor, positionGroupOf } from "./index";

// The sport names the IQ grade, and every spelling of a sport lands on
// the same key for the form, the metrics list and the athletic score.
describe("the sport names the grade and the metrics", () => {
  it("Baseball IQ for baseball, Soccer IQ for soccer, Game IQ for a sport the engine does not know", () => {
    expect(gradeLabel("iq", "Baseball")).toBe("Baseball IQ");
    expect(gradeLabel("iq", "soccer")).toBe("Soccer IQ");
    expect(gradeLabel("iq", "Water Polo")).toBe("Game IQ");
    expect(gradeLabel("iq", undefined)).toBe("Game IQ");
    expect(gradeLabel("frame", "Soccer")).toBe("Frame");
  });

  it("spellings resolve to one key", () => {
    expect(normalizeSport("Soccer")).toBe("soccer");
    expect(normalizeSport("Boys Soccer")).toBe("soccer");
    expect(normalizeSport("hoops")).toBe("basketball");
    expect(normalizeSport("lax")).toBe("lacrosse");
    expect(sportSpec("Softball")?.label).toBe("Softball");
  });

  it("a soccer athlete gets soccer metrics and soccer position groups, never a fastball", () => {
    const group = positionGroupOf("Soccer", "GK");
    expect(group).toBe("sc_gk");
    const { first, more } = metricsFor("Soccer", group);
    const keys = [...first, ...more].map((m) => m.key);
    expect(first.map((m) => m.key)).toEqual(expect.arrayContaining(["cleanSheets", "savePct"]));
    expect(keys).not.toContain("fbVelo");
    expect(keys).not.toContain("exitVelo");
  });

  it("every listed sport has a position hint", () => {
    for (const s of SPORTS) expect(s.positions.length).toBeGreaterThan(5);
  });
});
