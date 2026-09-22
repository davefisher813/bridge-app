import { describe, expect, it } from "vitest";
import { parseTransferWindowForm } from "./transferWindow";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

const good = { sport: "Baseball", division: "D1", seasonYear: "2026-27", windowLabel: "Undergraduate", opensOn: "2026-12-09", closesOn: "2026-12-23", sourceUrl: "https://www.ncaa.org/sports/2024/1/16/transfer-portal-windows.aspx" };

describe("a transfer window is typed in with its source", () => {
  it("accepts a real window and normalises the sport", () => {
    const r = parseTransferWindowForm(form(good));
    expect(r.ok).toBe(true);
    expect(r.values?.sport).toBe("baseball");
  });
  it("refuses a window that closes before it opens", () => {
    const r = parseTransferWindowForm(form({ ...good, closesOn: "2026-12-01" }));
    expect(r.ok).toBe(false);
    expect(r.errors.closesOn).toMatch(/closes before/);
  });
  it("refuses a window with no source page", () => {
    const r = parseTransferWindowForm(form({ ...good, sourceUrl: "" }));
    expect(r.ok).toBe(false);
    expect(r.errors.sourceUrl).toMatch(/page/);
  });
  it("refuses a sport the app does not know and a season that is not one", () => {
    expect(parseTransferWindowForm(form({ ...good, sport: "curling" })).errors.sport).toBeTruthy();
    expect(parseTransferWindowForm(form({ ...good, seasonYear: "next year" })).errors.seasonYear).toBeTruthy();
  });
});
