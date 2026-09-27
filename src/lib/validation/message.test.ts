import { describe, expect, it } from "vitest";
import { parseMessageForm } from "@/lib/validation/message";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseMessageForm", () => {
  it("accepts a message and trims it", () => {
    const r = parseMessageForm(fd({ body: "  See you Saturday.  " }));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ body: "See you Saturday." });
  });

  it("refuses an empty or blank message", () => {
    expect(parseMessageForm(fd({})).errors.body).toBe("Write something first.");
    expect(parseMessageForm(fd({ body: "   " })).errors.body).toBe("Write something first.");
  });

  it("allows exactly 4,000 characters and refuses one more", () => {
    expect(parseMessageForm(fd({ body: "x".repeat(4000) })).ok).toBe(true);
    const r = parseMessageForm(fd({ body: "x".repeat(4001) }));
    expect(r.ok).toBe(false);
    expect(r.errors.body).toBe("Keep it under 4,000 characters.");
  });
});
