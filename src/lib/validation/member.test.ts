import { describe, expect, it } from "vitest";
import { parseInviteForm, parseRole } from "./member";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

describe("parseInviteForm", () => {
  it("accepts an email and a role, and lowercases the email", () => {
    const r = parseInviteForm(form({ email: " Sam@Example.test ", role: "staff", fullName: " Sam Okafor " }));
    expect(r.ok).toBe(true);
    expect(r.values).toEqual({ email: "sam@example.test", role: "staff", fullName: "Sam Okafor" });
  });

  it("refuses a bad email and an unknown role, naming each", () => {
    const r = parseInviteForm(form({ email: "not-an-email", role: "boss" }));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(["email", "role"]);
  });

  it("treats a blank name as no name", () => {
    const r = parseInviteForm(form({ email: "a@b.co", role: "member", fullName: "   " }));
    expect(r.values?.fullName).toBeUndefined();
  });
});

describe("parseRole", () => {
  it("only knows the three roles", () => {
    expect(parseRole("owner")).toBe("owner");
    expect(parseRole("Owner")).toBeNull();
    expect(parseRole("admin")).toBeNull();
    expect(parseRole(undefined)).toBeNull();
  });
});
