import { describe, expect, it } from "vitest";
import { parseCommunicationForm } from "@/lib/validation/communication";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseCommunicationForm", () => {
  it("accepts a minimal valid entry", () => {
    const r = parseCommunicationForm(fd({ kind: "call" }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ kind: "call" });
  });

  it("rejects an unrecognized kind", () => {
    const r = parseCommunicationForm(fd({ kind: "carrier pigeon" }));
    expect(r.ok).toBe(false);
    expect(r.errors.kind).toBeTruthy();
  });

  it("carries occurredOn and notes through when present", () => {
    const r = parseCommunicationForm(fd({ kind: "visit", occurredOn: "2026-09-20", notes: "Great campus visit" }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ kind: "visit", occurredOn: "2026-09-20", notes: "Great campus visit" });
  });
});
