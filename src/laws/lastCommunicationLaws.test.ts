import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("LAW: Last Communication is derived from the Communication Log (Dave, 2026-10-17)", () => {
  it("the target page, the Targets board and the athlete profile all derive it with lastCommunication", () => {
    for (const p of ["src/app/org/[slug]/board/[id]/page.tsx", "src/app/org/[slug]/board/page.tsx", "src/app/org/[slug]/roster/[id]/page.tsx"]) {
      const src = read(p);
      expect(src, p).toContain("lastCommunication(");
      expect(src, p).toContain("Last Communication");
    }
  });
  it("no column stores it", () => {
    const sql = ["migrations"].flatMap(() => {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      return readdirSync("migrations").filter((f) => f.endsWith(".sql")).map((f) => read(`migrations/${f}`));
    });
    expect(sql.join("\n")).not.toMatch(/last_communication/i);
  });
});
