import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/supabase/middleware";

// iOS fetches the Home Screen icon without the session. Behind the
// sign-in redirect it got the login page and drew a letter instead of
// the logo (Dave, 2026-09-26).
describe("LAW: the app icon and manifest load without signing in", () => {
  it("icon, apple-icon and the manifest are public", () => {
    expect(isPublicPath("/icon")).toBe(true);
    expect(isPublicPath("/apple-icon")).toBe(true);
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
  });

  it("nothing else opens up", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/org/bridge")).toBe(false);
    expect(isPublicPath("/iconic")).toBe(false);
    expect(isPublicPath("/icon/extra")).toBe(false);
  });
});
