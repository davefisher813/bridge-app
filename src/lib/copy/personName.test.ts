import { describe, expect, it } from "vitest";
import { displayName } from "./personName";

describe("displayName", () => {
  it("capitalises a wholly lower-case name", () => {
    expect(displayName("hathaway roper")).toBe("Hathaway Roper");
    expect(displayName("mary-jane o'neil")).toBe("Mary-Jane O'Neil");
  });
  it("leaves any name that already has a capital exactly as written", () => {
    expect(displayName("DeShawn McDonald")).toBe("DeShawn McDonald");
    expect(displayName("Dave fisher")).toBe("Dave fisher");
    expect(displayName("ACME LLC")).toBe("ACME LLC");
  });
  it("is safe on empty", () => {
    expect(displayName(null)).toBe("");
    expect(displayName("  ")).toBe("");
  });
});
