// Laws about the data layer as a whole, rather than about one table.
//
// These exist because of a specific failure on 2026-09-17. Migration
// 0009 added org-scoped grading scales, an entry screen wrote them, an
// index screen listed them, and the eligibility page never read them.
// A coordinator could enter a scale, see it saved, see it listed, and
// watch the core GPA not move. Nothing failed. Every test passed. The
// feature was simply not connected at the one end that mattered.
//
// No unit test catches that, because each half is correct on its own.
// It is only visible across the whole app at once, which is what these
// check.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const MIGRATIONS = join(ROOT, "migrations");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const APP_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."));

interface Usage {
  reads: Set<string>;
  writes: Set<string>;
}

// Every `.from("table")` in app code, classified by what the chain does
// with it. The statement is taken up to the next semicolon, which is
// where a Supabase chain ends.
function collectUsage(): { usage: Map<string, Usage>; dynamic: string[] } {
  const usage = new Map<string, Usage>();
  const dynamic: string[] = [];
  const get = (t: string) => {
    let u = usage.get(t);
    if (!u) usage.set(t, (u = { reads: new Set(), writes: new Set() }));
    return u;
  };

  for (const file of APP_FILES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\.from\(\s*(?:"(\w+)"|([A-Za-z_$][\w$]*))\s*\)/g)) {
      const rel = file.slice(ROOT.length + 1);
      if (!m[1]) {
        dynamic.push(`${rel}: .from(${m[2]})`);
        continue;
      }
      const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 500).split(";")[0];
      const u = get(m[1]);
      if (/\.(insert|upsert|update|delete)\(/.test(tail)) u.writes.add(rel);
      if (/\.select\(/.test(tail)) u.reads.add(rel);
    }
    // A nested select reads a child table without naming it in from().
    // "org_approved_course_lists(... org_approved_courses(title, ...))".
    for (const m of src.matchAll(/(\w+)\s*\([\w\s,]*\)/g)) {
      if (/^(if|for|while|switch|catch|function|return|await|map|filter|select|from|eq|in|order|single)$/.test(m[1])) continue;
      if (usage.has(m[1])) get(m[1]).reads.add(file.slice(ROOT.length + 1));
    }
  }
  return { usage, dynamic };
}

const { usage, dynamic } = collectUsage();

// Tables the app deliberately never touches through the ordinary client.
// Each one needs a reason, so that adding to this list is a decision
// rather than a way to silence the check.
const NOT_APP_TABLES: Record<string, string> = {
  users: "auth.users is Supabase's, reached through the auth client rather than a query",
  benchmark_sets: "seeded reference data with no screen yet; see docs/ROADMAP.md",
  ncaa_approved_course_lists: "read via a nested select and a literal branch; covered below",
  ncaa_approved_courses: "child of the list above, read through it",
};

describe("LAW: a table the app writes is a table the app reads", () => {
  // The grading-scale bug in one sentence: writing without reading is a
  // feature that saves and does nothing, and it looks like success from
  // every angle except the screen the number is on.
  it("no table is written and never read back", () => {
    const orphans: string[] = [];
    for (const [table, u] of usage) {
      if (u.writes.size === 0) continue;
      if (u.reads.size > 0) continue;
      if (NOT_APP_TABLES[table]) continue;
      orphans.push(`${table} is written by ${[...u.writes][0]} and read nowhere`);
    }
    expect(orphans).toEqual([]);
  });

  // A table name in a variable is invisible to the check above, which
  // is how a dead write would hide from it. One file is allowed, with a
  // reason, because its variable ranges over a literal tuple in the same
  // file and every name in it is still greppable.
  const DYNAMIC_ALLOWED: Record<string, string> = {
    "src/lib/actions/fundraising.ts":
      "loops a literal `as const` tuple of table names to check cross-org ownership; the names are string literals in the file",
  };
  it("no query picks its table from a variable", () => {
    const unexplained = dynamic.filter((d) => !DYNAMIC_ALLOWED[d.split(":")[0]]);
    expect(unexplained).toEqual([]);
  });
});

describe("LAW: both halves of a shared-and-org table pair are read together", () => {
  // The pattern this project uses twice: shared reference data behind
  // the service role, plus an org-scoped table an org can write itself,
  // with the shared row winning. A screen that reads only the shared
  // half silently ignores everything the org entered, which is exactly
  // what the eligibility page did with grading scales for a release.
  const PAIRS: Array<[string, string]> = [
    ["high_school_grading_scales", "org_grading_scales"],
    ["ncaa_approved_course_lists", "org_approved_course_lists"],
  ];

  // Scoped to files that hand the rows to the engine. A file that only
  // checks whether a shared row already exists before writing one, as
  // the Doc AI path does, is not computing anything and does not need
  // the org's copy.
  it("every file that computes with a shared table also reads the org one", () => {
    const halfBlind: string[] = [];
    for (const [shared, own] of PAIRS) {
      for (const file of APP_FILES) {
        const src = readFileSync(file, "utf8");
        const code = src
          .split("\n")
          .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
          .join("\n");
        if (!code.includes(`"${shared}"`)) continue;
        if (!/buildEligibilityView/.test(code)) continue;
        if (!code.includes(`"${own}"`)) halfBlind.push(`${file.slice(ROOT.length + 1)} reads ${shared} without ${own}`);
      }
    }
    expect(halfBlind).toEqual([]);
  });

  // The other half of the same idea: a shared row is not automatically a
  // confirmed one. Doc AI writes a table it read off a scan into the
  // shared table with verified_at null, so a screen that labels every
  // shared row "verified" lets OCR of a phone photo outrank a table a
  // coordinator typed off the school's printed legend.
  it("the eligibility screen tells a confirmed shared scale from an unconfirmed one", () => {
    const page = readFileSync(join(SRC, "app", "org", "[slug]", "roster", "[id]", "eligibility", "page.tsx"), "utf8");
    const code = page.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).toMatch(/verified_at/);
  });
});

// The RLS coverage check used to live here and did not belong: the
// fundraising and governance policies are created in a DO loop with
// format(), so no amount of regex over the SQL text can see them. It
// moved to scripts/rls_test.sql, where it asks the real database which
// tables carry org_id and which of those have policies. That version
// cannot be fooled by how the SQL was written.
