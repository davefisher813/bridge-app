import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// THE LAWS, AS TESTS. See README.md in this folder for the pattern and
// why it exists (ported from jarvis-app/src/laws/).

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL = walk(SRC);
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f) || f.endsWith(".smoke.test.ts");
const SOURCES = ALL.filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(SRC.length + 1);

describe("LAW: no em dashes, anywhere in source", () => {
  // Dave's rule, verbatim, across every repo of his this session read
  // (bffsa-site/CLAUDE.md, tucci-admin/CLAUDE.md): "No em dashes. Ever."
  // Verified this law actually bites: added `const x = "a — b";` to a
  // scratch file, ran `npx vitest run laws.test.ts`, watched it fail,
  // reverted.
  it("no literal em dash in any source file", () => {
    const hits = SOURCES.filter((f) => read(f).includes("—")).map(rel);
    expect(hits).toEqual([]);
  });

  it("no escaped em dash unicode in any source file", () => {
    const hits = SOURCES.filter((f) => /\\u2014/i.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
});
