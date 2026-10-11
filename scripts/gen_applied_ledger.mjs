// Writes src/lib/ops/appliedLedger.ts from migrations/APPLIED.md, so the
// app can show the ledger (Organization Settings) without reading a file
// at run time. src/laws/appliedLaws.test.ts fails when the two differ.
//   node scripts/gen_applied_ledger.mjs
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync("migrations/APPLIED.md", "utf8");
const rows = [...md.matchAll(/^\| (\d{4}_[\w]+)\.sql \| (\w+) \| ([^|]+) \|$/gm)].map((m) => ({
  file: m[1],
  status: m[2],
  versions: [...m[3].matchAll(/\b(\d{14})\b/g)].map((v) => v[1]),
}));
const body = rows.map((r) => `  { file: ${JSON.stringify(r.file)}, recorded: ${JSON.stringify(r.status)}, versions: ${JSON.stringify(r.versions)} },`).join("\n");
writeFileSync(
  "src/lib/ops/appliedLedger.ts",
  `// Generated from migrations/APPLIED.md by scripts/gen_applied_ledger.mjs.
// Do not edit by hand: change APPLIED.md and run the script. A law fails
// the build when the two differ.

export type LedgerStatus = "applied" | "pending" | "cut";

export interface LedgerRow {
  file: string;
  recorded: LedgerStatus;
  // The production history versions that prove it (none when applied by
  // hand, or not applied).
  versions: string[];
}

export const APPLIED_LEDGER: LedgerRow[] = [
${body}
];
`,
);
console.log(`wrote ${rows.length} rows`);
