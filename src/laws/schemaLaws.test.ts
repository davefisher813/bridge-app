// Every column a query asks for is a column the schema has.
//
// This exists because the same mistake happened twice in one afternoon on
// 2026-09-17, in both directions:
//
//   1. loadTarget.ts selected `coach_email` from recruiting_targets.
//      There is no such column. Postgres would have returned an error at
//      runtime and tsc had nothing to say about a string.
//   2. The donor page added `board_id` to a cast and not to the select.
//      That one tsc caught only because the cast was explicit; had the
//      code read `row.board_id` off an `any`, it would have been
//      `undefined` at runtime and the link would have pointed at
//      /board-governance/undefined/seats/....
//
// Both are the same failure: a column name is a string, and a string is
// invisible to the type system. The schema is also a string, in a .sql
// file, so the only place the two can be compared is here.
//
// What this does NOT do is validate the whole PostgREST select grammar.
// It extracts the plain column names and the embedded-table names, checks
// those, and ignores anything it cannot confidently parse rather than
// guessing. A law that reports a false failure gets an allowlist entry
// within a week and stops meaning anything.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
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

// ── The schema, read out of the migrations in order ──────────────────
//
// Applied in filename order, the same order run_rls_test.sh applies them,
// so a column added in 0002 and dropped in 0011 ends up absent here just
// as it would in the database.
function buildSchema(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8")
      // Strip line comments first. A commented-out column would otherwise
      // be read as a real one, and this file is heavily commented.
      .replace(/^\s*--.*$/gm, "");

    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const table = m[1];
      const cols = new Set<string>();
      for (const line of m[2].split("\n")) {
        const t = line.trim();
        if (!t) continue;
        // Table-level constraints are not columns.
        if (/^(primary|foreign|unique|check|constraint|exclude)\b/i.test(t)) continue;
        const name = t.match(/^(\w+)\s+/);
        if (name) cols.add(name[1]);
      }
      tables.set(table, cols);
    }

    for (const m of sql.matchAll(/alter\s+table\s+(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) {
      const cols = tables.get(m[1]);
      if (cols) cols.add(m[2]);
    }
    for (const m of sql.matchAll(/alter\s+table\s+(\w+)\s+drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi)) {
      tables.get(m[1])?.delete(m[2]);
    }
    // The multi-column `alter table X add column a ..., add column b ...`
    // form, which 0002 uses.
    for (const m of sql.matchAll(/alter\s+table\s+(\w+)\s+([\s\S]*?);/gi)) {
      const cols = tables.get(m[1]);
      if (!cols) continue;
      for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)) cols.add(c[1]);
    }
  }
  return tables;
}

const SCHEMA = buildSchema();

// ── The queries, read out of the app ─────────────────────────────────
interface Query {
  file: string;
  table: string;
  select: string;
}

const APP_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."));

function collectQueries(): { queries: Query[]; skipped: string[] } {
  const queries: Query[] = [];
  const skipped: string[] = [];

  for (const file of APP_FILES) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(ROOT.length + 1);
    // .from("table") ... .select("columns"). The select may be several
    // lines down the chain, so the window runs to the next semicolon,
    // which is where a Supabase chain ends.
    for (const m of src.matchAll(/\.from\(\s*"(\w+)"\s*\)/g)) {
      const tail = src.slice(m.index + m[0].length).split(";")[0];
      const sel = tail.match(/\.select\(\s*(["'`])([\s\S]*?)\1/);
      if (!sel) continue;
      const body = sel[2];
      // A select built by interpolation is not a literal and cannot be
      // checked. Recorded rather than ignored, so the count is honest.
      if (/\$\{/.test(body)) {
        skipped.push(`${rel}: ${m[1]} has an interpolated select`);
        continue;
      }
      queries.push({ file: rel, table: m[1], select: body.replace(/\s+/g, " ").trim() });
    }
  }
  return { queries, skipped };
}

const { queries, skipped } = collectQueries();

// Split a PostgREST select list on top-level commas, keeping an embed's
// parenthesised body with its name.
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

interface Problem {
  file: string;
  message: string;
}

function checkSelect(file: string, table: string, select: string, problems: Problem[]): void {
  const cols = SCHEMA.get(table);
  if (!cols) {
    problems.push({ file, message: `queries table "${table}", which no migration creates` });
    return;
  }

  for (const part of splitTop(select)) {
    if (part === "*") continue;

    const embed = part.match(/^(\w+)\s*(?:!\w+)?\s*\(([\s\S]*)\)$/);
    if (embed) {
      // A foreign-table embed. PostgREST accepts the related table's name
      // here, so it is checked as its own table rather than as a column.
      checkSelect(file, embed[1], embed[2], problems);
      continue;
    }

    if (part === "count" || part.includes(".")) continue;

    // `alias:column` is checked on the RIGHT side. Skipping aliases
    // entirely would leave the one place a wrong column most easily
    // hides, since the alias is what the code then reads and the real
    // name is never seen again.
    const aliased = part.match(/^\w+\s*:\s*(\w+)$/);
    const name = (aliased ? aliased[1] : part).trim();
    if (!/^\w+$/.test(name)) continue;
    if (!cols.has(name)) {
      problems.push({ file, message: `selects "${name}" from ${table}, which has no such column` });
    }
  }
}

describe("LAW: a query only asks for columns the schema has", () => {
  // The suite is worth nothing if it is reading no queries, and a broken
  // regex would show up as exactly that: zero problems and zero work.
  it("found the app's queries and the schema's tables", () => {
    expect(SCHEMA.size).toBeGreaterThan(15);
    expect(queries.length).toBeGreaterThan(40);
    expect(SCHEMA.get("recruiting_targets")?.has("coach_name")).toBe(true);
    expect(SCHEMA.get("recruiting_targets")?.has("coach_email")).toBe(false);
  });

  // Verified this law bites: put `coach_email` back in loadTarget.ts's
  // select, ran `npx vitest run schemaLaws`, watched it fail naming the
  // file and the column, reverted.
  it("every selected column exists", () => {
    const problems: Problem[] = [];
    for (const q of queries) checkSelect(q.file, q.table, q.select, problems);
    expect(problems.map((p) => `${p.file}: ${p.message}`)).toEqual([]);
  });

  // An interpolated select is invisible to the check above. There should
  // be none: a column list is a constant, and building one at runtime is
  // how a table name ends up in a variable too (see dataLaws.test.ts).
  it("no select list is built by interpolation", () => {
    expect(skipped).toEqual([]);
  });
});
