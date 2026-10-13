import { describe, expect, it } from "vitest";
import { APPROVER_AREAS, AREA_CATEGORIES, approverAreaOf, canMarkReady, isApproverArea, NOBODY_NAMED, readyGate } from "./approvers";
import { READER_TYPES } from "./fileTypes";

describe("approver areas", () => {
  it("maps each signed-off type to its one area", () => {
    expect(approverAreaOf("transcript")).toBe("academic");
    expect(approverAreaOf("recommendation")).toBe("academic");
    expect(approverAreaOf("test_scores")).toBe("eligibility");
    expect(approverAreaOf("financial_aid")).toBe("financial");
    expect(approverAreaOf("offer_letter")).toBe("financial");
  });

  it("gives every other type no area", () => {
    for (const t of ["metrics", "athlete_profile", "board_document", "other", "film", null, undefined, "", "made_up"]) expect(approverAreaOf(t)).toBeNull();
  });

  it("no type is in two areas, and every area's type is a reader type", () => {
    const all = APPROVER_AREAS.flatMap((a) => AREA_CATEGORIES[a]);
    expect(new Set(all).size).toBe(all.length);
    for (const t of all) expect(READER_TYPES.some((r) => r.id === t)).toBe(true);
  });

  it("knows its own areas", () => {
    expect(isApproverArea("academic")).toBe(true);
    expect(isApproverArea("drop table")).toBe(false);
  });
});

describe("readyGate", () => {
  const pat = { id: "u-pat", name: "Pat Approver" };

  it("nobody named: any Admin marks Ready", () => {
    const g = readyGate("transcript", NOBODY_NAMED, "u-anyone");
    expect(g).toEqual({ kind: "open", area: "academic" });
    expect(canMarkReady(g)).toBe(true);
  });

  it("a type with no area is open even when every area is named", () => {
    const g = readyGate("metrics", { academic: pat, eligibility: pat, financial: pat }, "u-anyone");
    expect(g.kind).toBe("open");
    expect(canMarkReady(g)).toBe(true);
  });

  it("the named approver may; anyone else waits on them", () => {
    const named = { ...NOBODY_NAMED, financial: pat };
    expect(readyGate("offer_letter", named, "u-pat").kind).toBe("mine");
    const other = readyGate("offer_letter", named, "u-other");
    expect(other.kind).toBe("waiting");
    expect(canMarkReady(other)).toBe(false);
    // Another area stays open.
    expect(readyGate("transcript", named, "u-other").kind).toBe("open");
  });
});
