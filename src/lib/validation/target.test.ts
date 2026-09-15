import { describe, expect, it } from "vitest";
import { parseTargetForm } from "@/lib/validation/target";

const ATHLETE_ID = "11111111-1111-1111-1111-111111111111";
const SCHOOL_ID = "22222222-2222-2222-2222-222222222222";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseTargetForm", () => {
  it("accepts a minimal valid target", () => {
    const r = parseTargetForm(fd({ athleteId: ATHLETE_ID, schoolId: SCHOOL_ID }));
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ athleteId: ATHLETE_ID, schoolId: SCHOOL_ID, status: "Target" });
  });

  it("rejects a non-uuid athleteId", () => {
    const r = parseTargetForm(fd({ athleteId: "not-a-uuid", schoolId: SCHOOL_ID }));
    expect(r.ok).toBe(false);
    expect(r.errors.athleteId).toBeTruthy();
  });

  it("rejects an unrecognized status", () => {
    const r = parseTargetForm(fd({ athleteId: ATHLETE_ID, schoolId: SCHOOL_ID, status: "Ghosted" }));
    expect(r.ok).toBe(false);
    expect(r.errors.status).toBeTruthy();
  });

  it("carries optional fields through when present", () => {
    const r = parseTargetForm(
      fd({ athleteId: ATHLETE_ID, schoolId: SCHOOL_ID, status: "Visit", coachName: "T. Reilly", notes: "Great call", visitDate: "2026-10-01" })
    );
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ status: "Visit", coachName: "T. Reilly", notes: "Great call", visitDate: "2026-10-01" });
  });
});
