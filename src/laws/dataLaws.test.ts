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
  it("the eligibility loader tells a confirmed shared scale from an unconfirmed one", () => {
    const page = readFileSync(join(SRC, "lib", "data", "loadEligibility.ts"), "utf8");
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

// ── File bytes never ride a server action ────────────────────────────
//
// Next caps a server action's request body at 1MB. The app allows a 10MB
// document. For its first two weeks the uploader base64-encoded the file
// and passed it straight into processDocument(), which meant every real
// scanned transcript would have failed on the way in, and no test could
// see it because the fake client never goes over HTTP. Files now go to
// the documents bucket from the browser and the action gets a path
// (migration 0017, src/lib/docai/types.ts StoredRecord).
//
// This makes sure it stays that way: nothing exported from
// src/lib/actions takes an IngestedRecord, or anything else carrying a
// base64 field, as a parameter. Reading the bytes back inside the action
// is fine and expected; accepting them from the caller is the bug.
describe("LAW: a server action takes a storage path, never file bytes", () => {
  const ACTION_FILES = APP_FILES.filter((f) => f.includes("/lib/actions/"));

  function exportedSignatures(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)) {
      // From the opening paren to the body's opening brace: the whole
      // parameter list, including an inline object type.
      const start = m.index! + m[0].length;
      let depth = 1;
      let i = start;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        if (src[i] === ")") depth--;
        i++;
      }
      out.push(`${m[1]}(${src.slice(start, i)}`);
    }
    return out;
  }

  it("found the actions", () => {
    expect(ACTION_FILES.length).toBeGreaterThan(8);
    const sigs = ACTION_FILES.flatMap((f) => exportedSignatures(readFileSync(f, "utf8")));
    expect(sigs.some((s) => s.startsWith("processDocument("))).toBe(true);
  });

  // Verified this law bites: changed processDocument's input back to
  // `records: IngestedRecord[]`, ran `npx vitest run dataLaws`, watched
  // it fail naming the action, reverted.
  it("no exported action parameter carries file bytes", () => {
    const offenders: string[] = [];
    for (const f of ACTION_FILES) {
      for (const sig of exportedSignatures(readFileSync(f, "utf8"))) {
        if (/\bIngestedRecord\b/.test(sig) || /\bbase64\b/.test(sig)) {
          offenders.push(`${f.slice(ROOT.length + 1)}: ${sig.split("(")[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// The fake Supabase client stands in for PostgREST in every action and
// page test, so a filter it understands has to mean what the real one
// means. These check the two that were added last: a case-insensitive
// pattern, and a set of alternatives.
describe("LAW: the fake client's filters match PostgREST's meaning", () => {
  const dataset = () => ({
    schools: [
      { id: "s1", name: "State University", state: "CT", conference: null },
      { id: "s2", name: "upstate college", state: "NY", conference: "Liberty" },
      { id: "s3", name: "Coastal Tech", state: null, conference: "Liberty" },
    ],
  });

  it("ilike ignores case and treats percent as any run of characters", async () => {
    const { createFakeClient } = await import("@/testing/fakeSupabase");
    const client = createFakeClient(dataset() as never, { userId: null });
    const { data } = await client.from("schools").select("id").ilike("name", "%state%");
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  it("ilike anchors the pattern, so a bare word is not a substring match", async () => {
    const { createFakeClient } = await import("@/testing/fakeSupabase");
    const client = createFakeClient(dataset() as never, { userId: null });
    const { data } = await client.from("schools").select("id").ilike("name", "state");
    expect(data).toEqual([]);
  });

  it("or matches a row that satisfies any branch, including is.null", async () => {
    const { createFakeClient } = await import("@/testing/fakeSupabase");
    const client = createFakeClient(dataset() as never, { userId: null });
    const { data } = await client.from("schools").select("id").or("state.eq.CT,conference.is.null");
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(["s1"]);
    const second = await client.from("schools").select("id").or("state.eq.NY,name.ilike.%tech%");
    expect((second.data as { id: string }[]).map((r) => r.id)).toEqual(["s2", "s3"]);
  });

  it("or still narrows alongside the other filters, never widens them", async () => {
    const { createFakeClient } = await import("@/testing/fakeSupabase");
    const client = createFakeClient(dataset() as never, { userId: null });
    const { data } = await client.from("schools").select("id").eq("conference", "Liberty").or("state.eq.CT,state.eq.NY");
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(["s2"]);
  });
});

// A value exported from a "use client" module is a client reference when
// a server component imports it, not the value. On 2026-09-22 the
// athlete page imported a plain array of relationship labels from the
// invite form and called .find() on it: every test passed, the preview
// rendered, and the real screen threw "RELATIONSHIPS.find is not a
// function" for anyone who opened an athlete. The render harness cannot
// see this, because vitest resolves the module the ordinary way and
// there is no client boundary in it. Only a static check can.
describe("LAW: a server file never imports a plain value from a client module", () => {
  const CLIENT = new Set(
    walk(SRC)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /^\s*(?:"use client"|'use client')/.test(readFileSync(f, "utf8"))),
  );

  // A component is fine: React ships it across the boundary. Anything
  // else (an array, a map, a function, a constant) is not. A component
  // is CamelCase, so a SHOUTING_CONSTANT is caught even though it also
  // starts with a capital, which is exactly the shape that broke the
  // athlete page. A constant named like a component would slip through;
  // nothing better than a naming rule exists without type information.
  const looksLikeComponent = (name: string) => /^[A-Z]/.test(name) && /[a-z]/.test(name);

  it("found the client modules", () => {
    expect(CLIENT.size).toBeGreaterThan(3);
  });

  it("no server file imports a non-component export from one", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC).filter((x) => /\.tsx?$/.test(x))) {
      if (CLIENT.has(f)) continue;
      if (/\.test\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
        const spec = m[2]!;
        if (!spec.startsWith("@/")) continue;
        const rel = spec.slice(2);
        const target = [join(SRC, `${rel}.tsx`), join(SRC, `${rel}.ts`), join(SRC, rel, "index.tsx"), join(SRC, rel, "index.ts")].find((p) => CLIENT.has(p));
        if (!target) continue;
        // `import type` is erased at build time, so it never reaches the
        // boundary. Anything else in the braces has to be a component.
        if (/^import\s+type\s/.test(m[0])) continue;
        for (const namedRaw of m[1]!.split(",")) {
          const named = namedRaw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
          if (!named) continue;
          if (namedRaw.trim().startsWith("type ")) continue;
          if (looksLikeComponent(named)) continue;
          offenders.push(`${f.slice(ROOT.length + 1)} imports ${named} from the client module ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
