import { describe, expect, it } from "vitest";
import { readableFileName } from "./displayName";

describe("a file name made readable", () => {
  it("drops the browser's download stamp, the sort number and the extension", () => {
    expect(readableFileName("browser-download-20261009T014437.089730450Z-11-fiscal-policy.pdf")).toBe("Fiscal Policy");
  });
  it("turns separators into spaces and keeps acronyms", () => {
    expect(readableFileName("bridge_assignments-ricky-perez.pdf")).toBe("Bridge Assignments Ricky Perez");
    expect(readableFileName("BFFSA-Amended-By-Laws-2025-09-01.docx")).toBe("BFFSA Amended By Laws 2025 09 01");
  });
  it("never returns an empty title", () => {
    expect(readableFileName("....pdf").length).toBeGreaterThan(0);
  });
});
