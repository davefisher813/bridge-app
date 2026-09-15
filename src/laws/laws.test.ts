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

describe("LAW: the fit engine and Doc AI stay walled off", () => {
  // CLAUDE.md, verbatim: "no import of anything Bridge-specific
  // (board/governance, donor/fundraising) or of Next.js/Supabase
  // specifics may ever appear under either directory. Both are pure
  // functions over plain types with dependencies injected by the caller.
  // This is what makes the eventual standalone recruiting app a
  // lift-and-shift instead of a rewrite."
  //
  // It was a rule with nothing enforcing it until a stub ModelCaller was
  // written for the Doc AI upload screen with a process.env read in it.
  // That was caught by hand. This is so the next one is not.
  //
  // Verified this law bites: added `import { createClient } from
  // "@/lib/supabase/server";` to src/lib/docai/stubCaller.ts, ran
  // `npx vitest run laws`, watched it fail naming that file, reverted.
  const WALLED = ["lib/fit/", "lib/docai/"];
  const FORBIDDEN = [
    { pattern: /from\s+["']next\//, what: "a Next.js import" },
    { pattern: /from\s+["']@supabase\//, what: "a Supabase import" },
    { pattern: /@\/lib\/supabase/, what: "the app's Supabase client" },
    { pattern: /@\/lib\/actions/, what: "a server action" },
    { pattern: /@\/components/, what: "a React component" },
    { pattern: /\bprocess\.env\b/, what: "an environment read" },
  ];

  it("no Next, Supabase, component or environment dependency in either module", () => {
    const violations: string[] = [];
    for (const f of SOURCES) {
      const r = rel(f);
      if (!WALLED.some((dir) => r.startsWith(dir))) continue;
      const source = read(f);
      for (const { pattern, what } of FORBIDDEN) {
        if (pattern.test(source)) violations.push(`${r}: ${what}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
