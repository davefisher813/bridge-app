import { describe, it, expect } from "vitest";
import { parseRoleLabels, labelForRole, DEFAULT_ROLE_LABEL } from "./roleLabels";

describe("what an org calls its roles", () => {
  it("uses the org's own words", () => {
    const labels = parseRoleLabels({ owner: "Executive Director", staff: "Coordinator" });
    expect(labelForRole(labels, "owner")).toBe("Executive Director");
    expect(labelForRole(labels, "staff")).toBe("Coordinator");
  });

  it("falls back to plain English for a role the org did not name", () => {
    const labels = parseRoleLabels({ owner: "Executive Director" });
    expect(labelForRole(labels, "member")).toBe("Member");
  });

  it("falls back entirely when the org has said nothing", () => {
    for (const role of ["owner", "staff", "member"] as const) {
      expect(labelForRole(parseRoleLabels({}), role)).toBe(DEFAULT_ROLE_LABEL[role]);
    }
  });

  it("treats a blank as nothing said, not as a label", () => {
    // An empty string is not a title, and rendering one would leave a
    // gap on screen where a role should be.
    const labels = parseRoleLabels({ owner: "", staff: "   " });
    expect(labelForRole(labels, "owner")).toBe("Owner");
    expect(labelForRole(labels, "staff")).toBe("Staff");
  });

  it("survives garbage without throwing, like every other jsonb column", () => {
    expect(labelForRole(parseRoleLabels(null), "owner")).toBe("Owner");
    expect(labelForRole(parseRoleLabels("nonsense"), "owner")).toBe("Owner");
    expect(labelForRole(parseRoleLabels({ owner: 42 }), "owner")).toBe("Owner");
    expect(labelForRole(parseRoleLabels({ unexpected: "x" }), "owner")).toBe("Owner");
  });

  it("trims what the org typed", () => {
    expect(labelForRole(parseRoleLabels({ staff: "  Coach  " }), "staff")).toBe("Coach");
  });

  it("two orgs describe the same permission differently", () => {
    // The point of the whole thing: same enum, different word.
    const bridge = parseRoleLabels({ owner: "Executive Director", staff: "Coordinator" });
    const elite = parseRoleLabels({ owner: "Owner", staff: "Coach" });
    expect(labelForRole(bridge, "staff")).toBe("Coordinator");
    expect(labelForRole(elite, "staff")).toBe("Coach");
  });
});
