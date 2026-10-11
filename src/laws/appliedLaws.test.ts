// Every migration has a row in migrations/APPLIED.md saying whether it is
// on production (backend audit F-03: hand-applied migrations, no log,
// drift already happened once).
// Verified this law bites: deleted the 0053 row from APPLIED.md, watched
// it fail naming the file, reverted.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("LAW: every migration is in the applied log", () => {
  const ledger = readFileSync("migrations/APPLIED.md", "utf8");
  const rows = new Map([...ledger.matchAll(/^\| (\d{4}_[\w]+\.sql) \| (\w+) \| ([^|]+) \|$/gm)].map((m) => [m[1]!, { status: m[2]!, evidence: m[3]!.trim() }]));

  it("each file in migrations/ has exactly one row with a known status", () => {
    const files = readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f));
    const missing = files.filter((f) => !rows.has(f));
    expect(missing).toEqual([]);
    const bad = [...rows].filter(([, r]) => !["applied", "pending", "cut"].includes(r.status)).map(([f]) => f);
    expect(bad).toEqual([]);
    // No row for a file that does not exist.
    expect([...rows.keys()].filter((f) => !files.includes(f))).toEqual([]);
  });

  it("every applied row names its evidence", () => {
    const thin = [...rows].filter(([, r]) => r.status === "applied" && !/\d{14}|by hand/.test(r.evidence)).map(([f]) => f);
    expect(thin).toEqual([]);
  });
});

// The app's copy of the ledger (Organization Settings reads it) is the
// ledger. Verified it bites: changed one row's status in APPLIED.md
// without rerunning the script, watched it fail, reverted.
describe("LAW: the app's ledger is migrations/APPLIED.md", () => {
  it("src/lib/ops/appliedLedger.ts matches it row for row (node scripts/gen_applied_ledger.mjs)", async () => {
    const { APPLIED_LEDGER } = await import("@/lib/ops/appliedLedger");
    const ledger = readFileSync("migrations/APPLIED.md", "utf8");
    const rows = [...ledger.matchAll(/^\| (\d{4}_[\w]+)\.sql \| (\w+) \| ([^|]+) \|$/gm)].map((m) => ({ file: m[1]!, recorded: m[2]!, versions: [...m[3]!.matchAll(/\b(\d{14})\b/g)].map((v) => v[1]!) }));
    expect(APPLIED_LEDGER).toEqual(rows);
  });
});
