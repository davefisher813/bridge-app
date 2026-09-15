import { describe, expect, it } from "vitest";
import { parseContactForm } from "@/lib/validation/contact";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseContactForm", () => {
  it("accepts a minimal valid contact", () => {
    const r = parseContactForm(fd({ name: "Coach Reilly", role: "hs_coach" }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ name: "Coach Reilly", role: "hs_coach" });
  });

  it("rejects an empty name", () => {
    const r = parseContactForm(fd({ name: "", role: "hs_coach" }));
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBeTruthy();
  });

  it("rejects an unrecognized role", () => {
    const r = parseContactForm(fd({ name: "Someone", role: "assistant_coach" }));
    expect(r.ok).toBe(false);
    expect(r.errors.role).toBeTruthy();
  });

  it("rejects a malformed email", () => {
    const r = parseContactForm(fd({ name: "Someone", role: "advisor", email: "not-an-email" }));
    expect(r.ok).toBe(false);
    expect(r.errors.email).toBeTruthy();
  });

  it("carries optional fields through when present", () => {
    const r = parseContactForm(
      fd({ name: "Coach Reilly", role: "college_coach", email: "reilly@example.edu", phone: "555-0100", notes: "Recruiting coordinator" })
    );
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ email: "reilly@example.edu", phone: "555-0100", notes: "Recruiting coordinator" });
  });
});
