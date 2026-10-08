import { describe, expect, it } from "vitest";
import { canMove, isStaleProcessing, LEGACY_STATUS_TO_LIFECYCLE, LIFECYCLE_STATES, STALE_PROCESSING_MS, TRANSITIONS, type Lifecycle } from "./lifecycle";

describe("the five states and the seven moves", () => {
  it("there are exactly five states, in order", () => {
    expect([...LIFECYCLE_STATES]).toEqual(["uploaded", "processing", "needs_review", "ready", "archived"]);
  });

  it("there are exactly seven allowed moves", () => {
    expect(TRANSITIONS.map((t) => `${t.from}>${t.to}`).sort()).toEqual(
      ["uploaded>processing", "uploaded>needs_review", "processing>needs_review", "needs_review>ready", "needs_review>archived", "ready>archived", "archived>needs_review"].sort(),
    );
  });

  it("every other pair is refused, for the system and for staff", () => {
    const allowed = new Set(TRANSITIONS.map((t) => `${t.from}>${t.to}`));
    for (const from of LIFECYCLE_STATES) {
      for (const to of LIFECYCLE_STATES) {
        if (allowed.has(`${from}>${to}`)) continue;
        expect(canMove(from, to, "system"), `${from} to ${to} as system`).toBe(false);
        expect(canMove(from, to, "staff"), `${from} to ${to} as staff`).toBe(false);
      }
    }
  });

  it("Ready is never reached by the system, only by a person", () => {
    expect(canMove("needs_review", "ready", "system")).toBe(false);
    expect(canMove("needs_review", "ready", "staff")).toBe(true);
  });

  it("nothing reaches Ready except from Needs Review, and nothing skips Processing's exit", () => {
    for (const from of LIFECYCLE_STATES) {
      if (from !== "needs_review") expect(canMove(from, "ready", "staff")).toBe(false);
    }
    expect(canMove("processing", "ready", "staff")).toBe(false);
    expect(canMove("processing", "archived", "staff")).toBe(false);
  });

  it("Archive works from Needs Review and Ready, Unarchive returns to Needs Review only", () => {
    expect(canMove("needs_review", "archived", "staff")).toBe(true);
    expect(canMove("ready", "archived", "staff")).toBe(true);
    expect(canMove("archived", "needs_review", "staff")).toBe(true);
    expect(canMove("archived", "ready", "staff")).toBe(false);
    expect(canMove("archived", "uploaded", "staff")).toBe(false);
  });

  it("staff may end a stale Processing, the system always ends it", () => {
    expect(canMove("processing", "needs_review", "system")).toBe(true);
    expect(canMove("processing", "needs_review", "staff")).toBe(true);
  });
});

describe("stale Processing", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it("is stale after ten minutes, not before, and only in Processing", () => {
    const old = new Date(now.getTime() - STALE_PROCESSING_MS - 1000).toISOString();
    const fresh = new Date(now.getTime() - 60 * 1000).toISOString();
    expect(isStaleProcessing("processing", old, now)).toBe(true);
    expect(isStaleProcessing("processing", fresh, now)).toBe(false);
    expect(isStaleProcessing("needs_review", old, now)).toBe(false);
    expect(isStaleProcessing("processing", null, now)).toBe(false);
  });
});

describe("old statuses map onto the new five with nothing left out", () => {
  const OLD = ["processing", "pending", "applied", "discarded", "failed", "filed"];
  it("every old status has a mapping and it is a real state", () => {
    for (const s of OLD) expect(LIFECYCLE_STATES).toContain(LEGACY_STATUS_TO_LIFECYCLE[s] as Lifecycle);
  });
  it("only discarded is archived; nothing becomes Ready on its own", () => {
    expect(LEGACY_STATUS_TO_LIFECYCLE.discarded).toBe("archived");
    expect(Object.values(LEGACY_STATUS_TO_LIFECYCLE)).not.toContain("ready");
  });
});
