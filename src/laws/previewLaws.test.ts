// Previews never serve the production database (backend audit F-02).
// Verified this law bites: removed the guard from src/proxy.ts, watched
// "the proxy refuses" fail; set "main": false in vercel.json, watched
// "only main deploys" fail. Reverted both.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { previewBlocked } from "@/lib/deploy/previewGuard";

describe("LAW: a preview deployment never reaches the production database", () => {
  it("only main deploys on Vercel", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as { git?: { deploymentEnabled?: Record<string, boolean> } };
    expect(cfg.git?.deploymentEnabled).toEqual({ "*": false, main: true });
  });

  it("a preview is refused unless a separate database was set on purpose", () => {
    expect(previewBlocked({ VERCEL_ENV: "preview" })).toBe(true);
    expect(previewBlocked({ VERCEL_ENV: "preview", PREVIEW_DATABASE_OK: "1" })).toBe(false);
    expect(previewBlocked({ VERCEL_ENV: "production" })).toBe(false);
    expect(previewBlocked({})).toBe(false);
  });

  it("the proxy refuses before any session or database call", () => {
    const src = readFileSync("src/proxy.ts", "utf8");
    const guard = src.indexOf("previewBlocked(process.env)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf("updateSession(request)", guard));
  });
});
