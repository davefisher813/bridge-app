import { describe, expect, it } from "vitest";
import { parseInviteForm, parseMemberTitle, parseRole } from "./member";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

describe("parseInviteForm", () => {
  it("accepts an email and a role, and lowercases the email", () => {
    const r = parseInviteForm(form({ email: " Sam@Example.test ", role: "owner", fullName: " Sam Okafor " }));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ email: "sam@example.test", role: "owner", fullName: "Sam Okafor" });
  });

  it("refuses a bad email and an unknown role, naming each", () => {
    const r = parseInviteForm(form({ email: "not-an-email", role: "boss" }));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(["email", "role"]);
  });

  it("refuses the retired staff role", () => {
    const r = parseInviteForm(form({ email: "a@b.co", role: "staff" }));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors)).toEqual(["role"]);
  });

  it("treats a blank name as no name", () => {
    const r = parseInviteForm(form({ email: "a@b.co", role: "member", fullName: "   " }));
    expect(r.values?.fullName).toBeUndefined();
  });
});

describe("parseRole", () => {
  it("only knows the three assignable roles", () => {
    expect(parseRole("owner")).toBe("owner");
    expect(parseRole("member")).toBe("member");
    expect(parseRole("family")).toBe("family");
    expect(parseRole("staff")).toBeNull();
    expect(parseRole("Owner")).toBeNull();
    expect(parseRole("admin")).toBeNull();
    expect(parseRole(undefined)).toBeNull();
  });
});

describe("parseMemberTitle", () => {
  it("trims a Title, clears on blank, and refuses one over 80 characters", () => {
    expect(parseMemberTitle("  Head Coach ")).toEqual({ ok: true, title: "Head Coach" });
    expect(parseMemberTitle("   ")).toEqual({ ok: true, title: null });
    expect(parseMemberTitle(null)).toEqual({ ok: true, title: null });
    expect(parseMemberTitle("x".repeat(80))).toEqual({ ok: true, title: "x".repeat(80) });
    expect(parseMemberTitle("x".repeat(81)).ok).toBe(false);
  });
});
