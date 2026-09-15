import { describe, expect, it } from "vitest";
import { parseOrgModules } from "@/lib/org/modules";

describe("parseOrgModules", () => {
  it("parses a fully-specified modules row", () => {
    const m = parseOrgModules({ recruiting: true, doc_ai: true, board_governance: true, donor_fundraising: true });
    expect(m).toEqual({ recruiting: true, doc_ai: true, board_governance: true, donor_fundraising: true });
  });

  it("defaults recruiting/doc_ai to true and the Bridge-only modules to false when absent", () => {
    const m = parseOrgModules({});
    expect(m).toEqual({ recruiting: true, doc_ai: true, board_governance: false, donor_fundraising: false });
  });

  it("degrades to the safe default set on malformed input rather than throwing", () => {
    const m = parseOrgModules(null);
    expect(m).toEqual({ recruiting: true, doc_ai: true, board_governance: false, donor_fundraising: false });
  });

  it("degrades a wrong-typed field to its default instead of the whole object", () => {
    const m = parseOrgModules({ donor_fundraising: "yes" });
    expect(m.donor_fundraising).toBe(false);
    expect(m.recruiting).toBe(true);
  });
});
