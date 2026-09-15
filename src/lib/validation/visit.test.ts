import { describe, expect, it } from "vitest";
import { parseVisitForm } from "@/lib/validation/visit";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseVisitForm", () => {
  it("accepts a minimal valid visit", () => {
    const r = parseVisitForm(fd({ visitType: "unofficial" }));
    expect(r.ok).toBe(true);
    expect(r.values?.visitType).toBe("unofficial");
  });

  it("rejects an unrecognized visit type", () => {
    const r = parseVisitForm(fd({ visitType: "casual" }));
    expect(r.ok).toBe(false);
    expect(r.errors.visitType).toBeTruthy();
  });

  it("carries optional fields through when present", () => {
    const r = parseVisitForm(
      fd({ visitType: "official", visitDate: "2026-10-15", impression: "Loved the campus", nextStep: "Follow up with coach" })
    );
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ visitType: "official", visitDate: "2026-10-15", impression: "Loved the campus", nextStep: "Follow up with coach" });
  });
});
