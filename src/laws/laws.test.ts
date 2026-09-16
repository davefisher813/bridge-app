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

describe("LAW: the server never trusts the client's account of an uploaded file", () => {
  // ingest.ts runs in the BROWSER. Its size cap, format sniffing and
  // HEIC refusal are a convenience for the person uploading, not a
  // boundary: a direct call to the server action skipped all three.
  // Found by an adversarial audit on 2026-09-16.

  it("processDocument validates every record before it inserts anything", () => {
    const source = readFileSync(join(SRC, "lib", "actions", "documents.ts"), "utf8");
    expect(source).toMatch(/checkIngestedRecord/);

    // Order matters as much as presence. Validating after the row is
    // created leaves a stuck document behind for every refusal, and
    // validating after the pipeline runs defeats the point entirely.
    const validateAt = source.indexOf("validateRecords(input.records)");
    const insertAt = source.indexOf('.from("documents")');
    expect(validateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(insertAt);
  });

  it("the acceptance check reads the bytes, not the reported size", () => {
    const source = readFileSync(join(SRC, "lib", "docai", "acceptance.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    // originalSize is the client's claim. It may be carried for display,
    // but it must never be what a limit is compared against.
    expect(code).not.toMatch(/originalSize\s*[<>]/);
    expect(code).toMatch(/byteLength > MAX_INGEST_BYTES/);
  });

  it("the shared limit is not duplicated", () => {
    // Two copies of a size cap is how they end up different, and the
    // server's being the larger of the two is the failure mode.
    const ingest = readFileSync(join(SRC, "lib", "docai", "ingest.ts"), "utf8");
    expect(ingest).not.toMatch(/MAX_INGEST_BYTES\s*=\s*\d/);
    expect(ingest).toMatch(/from "\.\/limits"/);
  });
});

describe("LAW: discarding an applied document undoes what it wrote", () => {
  // Until 2026-09-16 discardDocument set a status and left the course
  // rows, the GPA, the verified flag and the date of birth in place,
  // with no path in the app to remove them. A transcript applied to the
  // wrong athlete stayed on that athlete's record permanently while the
  // screen said it had been discarded.

  it("discardDocument actually removes what the apply added", () => {
    const source = readFileSync(join(SRC, "lib", "actions", "documents.ts"), "utf8");
    // Bounded to the function's own body. Slicing to the end of the file
    // passed even with the call removed, because undoApply's own
    // definition sits below it.
    const start = source.indexOf("export async function discardDocument");
    const end = source.indexOf("async function undoApply", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const discard = source.slice(start, end);
    expect(discard).toMatch(/await undoApply\(/);

    const undo = source.slice(source.indexOf("async function undoApply"));
    // The course rows are the part that cannot be reconstructed later,
    // so they are found by query and deleted rather than trusted to a
    // record that may predate the feature.
    expect(undo).toMatch(/from\("athlete_courses"\)[\s\S]{0,200}\.delete\(\)/);
  });

  it("an apply records what it changed, or the undo has nothing to work from", () => {
    const source = readFileSync(join(SRC, "lib", "actions", "documents.ts"), "utf8");
    // Both apply paths: the automatic one inside processDocument and the
    // human one in applyDocument. Missing it on either leaves half the
    // documents in the system un-undoable.
    const matches = source.match(/applied_changes: outcome\.changes/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("a field changed by hand since the apply is never reverted", () => {
    const plan = readFileSync(join(SRC, "lib", "data", "undoPlan.ts"), "utf8");
    const code = plan
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    // The guard is the comparison against what this document wrote. An
    // undo that restores unconditionally would throw away somebody's
    // correction, which is worse than not undoing at all.
    expect(code).toMatch(/sameStoredValue\(now, change\.after\)/);
    expect(code).toMatch(/kept\.push\(column\)/);
  });

  it("the undo never deletes a grading scale somebody has confirmed", () => {
    const source = readFileSync(join(SRC, "lib", "actions", "documents.ts"), "utf8");
    const undo = source.slice(source.indexOf("async function undoApply"));
    // The shared table is read by every org. Removing a row another org
    // may now rely on, because this document happened to create it and
    // this org changed its mind, is not this document's call once
    // somebody has vouched for it.
    expect(undo).toMatch(/!row\.verified_at/);
  });
});

describe("LAW: an org's own words for its roles are actually used", () => {
  // org_role is generic on purpose (owner | staff | member) and what a
  // person is CALLED is org config. That has been in CLAUDE.md and in
  // the schema since day one, and orgs.role_labels was never read
  // anywhere until 2026-09-16: the query did not even select the column,
  // so every screen showed the enum value or nothing. Standing up a
  // second real organization is what surfaced it.

  it("getOrgBySlug selects and parses the column", () => {
    const source = readFileSync(join(SRC, "lib", "org", "membership.ts"), "utf8");
    // The SELECT itself, not just a mention of the column elsewhere in
    // the file: dropping it from the query while leaving `data.role_labels`
    // in the return is exactly how this silently became undefined.
    const select = source.match(/from\("orgs"\)\s*\.select\("([^"]*)"\)/);
    expect(select).not.toBeNull();
    expect(select![1]).toMatch(/role_labels/);
    expect(source).toMatch(/parseRoleLabels\(/);
  });

  it("at least one screen renders the org's label rather than the enum value", () => {
    const files = walk(SRC).filter((f) => f.endsWith(".tsx"));
    const users = files.filter((f) => read(f).includes("labelForRole("));
    expect(users.length).toBeGreaterThan(0);
  });

  it("no screen prints a raw role value as if it were a title", () => {
    // {user.role} on screen says "staff", which is a database word and
    // not what anybody at either organization calls themselves.
    const files = walk(SRC).filter((f) => f.endsWith(".tsx"));
    const offenders = files.filter((f) => /\{\s*user\.role\s*\}/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});
