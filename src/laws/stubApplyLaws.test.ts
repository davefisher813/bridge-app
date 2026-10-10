// A reading made up by the stand-in is never applied to an athlete
// (backend audit F-01, critical). Two layers, each held here:
//   - the database refuses it (migration 0053), whatever the app does;
//   - every place in the app that writes status "applied" asks
//     applyGate first, inside the same function.
// A new apply path that skips the gate fails this file before it ships.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// The function around a position: from the nearest "function" before it
// to the next top-level "export" or "function" after it.
function enclosing(src: string, at: number): string {
  const starts = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+\w+/gm)].map((m) => m.index!);
  const start = starts.filter((s) => s <= at).pop() ?? 0;
  const end = starts.find((s) => s > at) ?? src.length;
  return src.slice(start, end);
}

// Verified this law bites: deleted the trigger from 0053, watched it
// fail, reverted.
describe("LAW: the database refuses to apply a stand-in reading", () => {
  it("migration 0053 creates the trigger on documents for insert and update", () => {
    const file = readdirSync(join(ROOT, "migrations")).find((f) => f.startsWith("0053_"));
    expect(file).toBeTruthy();
    const sql = readFileSync(join(ROOT, "migrations", file!), "utf8").replace(/--.*$/gm, "");
    expect(sql).toMatch(/new\.status = 'applied' and new\.read_by = 'stub'/);
    expect(sql).toMatch(/create trigger documents_stub_never_applied\s+before insert or update of status, read_by on documents/);
    expect(readFileSync(join(ROOT, "scripts/run_rls_test.sh"), "utf8")).toContain(`migrations/${file}`);
    expect(readFileSync(join(ROOT, "scripts/rls_test.sql"), "utf8")).toMatch(/ALL 0053 ASSERTIONS PASSED/);
  });
});

// Verified this law bites: removed the applyGate call from the manual
// apply action, watched it fail naming the function, reverted.
describe("LAW: every apply path in the app asks applyGate first", () => {
  it("each write of status 'applied' sits in a function that calls applyGate", () => {
    const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/testing/") && !f.includes("/laws/"));
    const writes: string[] = [];
    const ungated: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/status:\s*(?:[^,\n]*\?\s*)?"applied"/g)) {
        const fn = enclosing(src, m.index!);
        const name = fn.match(/function\s+(\w+)/)?.[1] ?? "?";
        writes.push(`${f.slice(ROOT.length + 1)}:${name}`);
        if (!/\bapplyGate\(/.test(fn)) ungated.push(`${f.slice(ROOT.length + 1)}:${name}`);
      }
    }
    // The checker sees the apply paths that exist today.
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(ungated).toEqual([]);
  });
});

// Verified this law bites: returned `real` straight from modelCallerFor,
// watched it fail, reverted.
describe("LAW: every paid model call passes the rate limit (backend audit F-05)", () => {
  it("modelCallerFor wraps the real caller in rateRefusal, and nothing else builds one", () => {
    const src = readFileSync(join(SRC, "lib/actions/documents.ts"), "utf8");
    const fn = src.slice(src.indexOf("async function modelCallerFor"), src.indexOf("export interface ProcessResult"));
    expect(fn).toMatch(/rateRefusal\(await loadRecentCalls\(supabase, orgId\), 1\)/);
    expect(fn).not.toMatch(/return createAnthropicCaller\(/);
    const builders = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/laws/") && !f.includes("/docai/") && /(?<!function )createAnthropicCaller\(/.test(readFileSync(f, "utf8")));
    expect(builders.map((f) => f.slice(ROOT.length + 1))).toEqual(["src/lib/actions/documents.ts"]);
  });
});
