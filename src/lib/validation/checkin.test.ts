import { describe, expect, it } from "vitest";
import { parseCheckinForm } from "@/lib/validation/checkin";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseCheckinForm", () => {
  it("accepts a minimal valid check-in", () => {
    const r = parseCheckinForm(fd({ kind: "call" }));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ kind: "call" });
  });

  it("rejects a kind the database does not have", () => {
    const r = parseCheckinForm(fd({ kind: "email" }));
    expect(r.ok).toBe(false);
    expect(r.errors.kind).toBeTruthy();
  });

  it("carries the date and notes through, trimmed", () => {
    const r = parseCheckinForm(fd({ kind: "meeting", occurredOn: "2026-09-20", notes: "  Talked about the fall showcase.  " }));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ kind: "meeting", occurredOn: "2026-09-20", notes: "Talked about the fall showcase." });
  });

  it("reads blank date and notes as absent", () => {
    const r = parseCheckinForm(fd({ kind: "text", occurredOn: "", notes: "   " }));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ kind: "text" });
  });

  it("rejects a date that has not happened yet, which would hide the athlete from every reminder", () => {
    const r = parseCheckinForm(fd({ kind: "call", occurredOn: "2062-09-20" }));
    expect(r.ok).toBe(false);
    expect(r.errors.occurredOn).toBe("That date hasn't happened yet.");
    const today = new Date().toISOString().slice(0, 10);
    expect(parseCheckinForm(fd({ kind: "call", occurredOn: today })).ok).toBe(true);
  });

  it("rejects a date that is not a date", () => {
    const r = parseCheckinForm(fd({ kind: "call", occurredOn: "last Tuesday" }));
    expect(r.ok).toBe(false);
    expect(r.errors.occurredOn).toBeTruthy();
  });

  it("rejects notes over 2,000 characters", () => {
    const r = parseCheckinForm(fd({ kind: "call", notes: "x".repeat(2001) }));
    expect(r.ok).toBe(false);
    expect(r.errors.notes).toMatch(/2,000/);
  });
});
