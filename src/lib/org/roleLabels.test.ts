import { describe, it, expect } from "vitest";
import { ACCESS_LEVEL, cleanTitle, labelForRole, personLabel } from "./roleLabels";

describe("access level names and what a person is shown as", () => {
  it("names the three levels Admin, Viewer and Athlete", () => {
    expect(labelForRole("owner")).toBe("Admin");
    expect(labelForRole("member")).toBe("Viewer");
    expect(labelForRole("family")).toBe("Athlete");
  });

  it("reads a leftover staff row as Admin, never as the enum value", () => {
    expect(labelForRole("staff")).toBe("Admin");
  });

  it("reads anything unexpected as the level that changes nothing", () => {
    expect(labelForRole("nonsense")).toBe("Viewer");
  });

  it("offers exactly three distinct names", () => {
    expect([...new Set(Object.values(ACCESS_LEVEL))].sort()).toEqual(["Admin", "Athlete", "Viewer"]);
  });

  it("shows a person's Title when set, their access level otherwise", () => {
    expect(personLabel({ role: "owner", title: "Head Coach" })).toBe("Head Coach");
    expect(personLabel({ role: "owner", title: null })).toBe("Admin");
    expect(personLabel({ role: "member" })).toBe("Viewer");
    expect(personLabel({ role: "owner", title: "   " })).toBe("Admin");
    expect(personLabel({ role: "owner", title: "  Board Chair  " })).toBe("Board Chair");
  });

  it("treats a blank or non-string Title as none", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle("  ")).toBeNull();
    expect(cleanTitle(42)).toBeNull();
    expect(cleanTitle(undefined)).toBeNull();
    expect(cleanTitle(" Treasurer ")).toBe("Treasurer");
  });
});
