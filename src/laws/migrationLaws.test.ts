// A migration is structure, never data.
//
// Dave, 2026-09-27: "There shouldn't be data like student athlete data
// wired into the app... if somebody used this as a new app, there
// shouldn't be pre-existing data in it." Migrations 0019 and 0020 set
// one org's logo by its slug; they are applied in production and stay
// as they are (rewriting applied history breaks it), and they exist only
// because there was no screen to do it. From 0040 on, a migration never
// names an org, never carries an id literal, and never writes rows into
// a table that holds an org's or the directory's data. Per-org values go
// through the app (Organization Settings, create_org); directory rows go
// through a one-off loader like scripts/load_high_schools.ts.
//
// Code is not data: an insert inside a function body (create_org's
// insert into orgs, a trigger's insert into users) runs with the
// caller's values at call time and ships nothing. So inserts are checked
// outside dollar-quoted bodies only. Ids and org names are checked
// everywhere, bodies included, since a body can hard-wire one org too.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const MIGRATIONS = join(ROOT, "migrations");

// Every migration numbered this or later is held to the law.
const FIRST_CHECKED = 40;

const DATA_TABLES = [
  "orgs",
  "org_members",
  "users",
  "athletes",
  "schools",
  "college_coaches",
  "transfer_windows",
  "high_schools",
  "high_school_grading_scales",
  "benchmark_sets",
  "donors",
];

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

function stripBodies(sql: string): string {
  return sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$body$$");
}

// The problems in one migration's text. The self-test below runs it on
// planted strings, and the law runs it on the real files.
function problemsIn(sql: string): string[] {
  const code = stripComments(sql);
  const topLevel = stripBodies(code);
  const out: string[] = [];

  for (const m of code.matchAll(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/gi)) out.push(`an id literal ${m[0]}`);

  for (const m of code.matchAll(/\bslug\s*(?:=|<>|!=|~~\*?|i?like)\s*'[^']*'/gi)) out.push(`an org named by slug: ${m[0]}`);
  for (const m of code.matchAll(/\bslug\s+(?:not\s+)?in\s*\(\s*'[^)]*\)/gi)) out.push(`an org named by slug: ${m[0]}`);
  for (const m of code.matchAll(/'[^']*\b(?:bridge|bffsa|elite\s*-?\s*squad)\b[^']*'/gi)) out.push(`an org named in a string: ${m[0]}`);

  for (const m of topLevel.matchAll(/\binsert\s+into\s+(?:public\.)?(\w+)\b([\s\S]*?);/gi)) {
    const table = m[1].toLowerCase();
    if (!DATA_TABLES.includes(table)) continue;
    // The generic profile backfill: every auth account gets its profile
    // row. It names nobody and carries no values of its own.
    if (table === "users" && /\bselect\b[\s\S]*\bfrom\s+auth\.users\b/i.test(m[2]) && !/\bvalues\b/i.test(m[2])) continue;
    out.push(`rows written into ${table}`);
  }
  for (const m of topLevel.matchAll(/\bcopy\s+(?:public\.)?(\w+)\b/gi)) {
    if (DATA_TABLES.includes(m[1].toLowerCase())) out.push(`rows copied into ${m[1]}`);
  }
  return out;
}

function checkedMigrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => Number(f.slice(0, 4)) >= FIRST_CHECKED)
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), "utf8") }));
}

describe("LAW: a migration from 0040 on is structure, never data", () => {
  it("found the migrations it holds to the law", () => {
    const files = checkedMigrations().map((m) => m.file);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/^0040_/);
  });

  // The checker itself, on planted text, so a regex that stops matching
  // shows up here rather than as a law that silently passes everything.
  it("catches each kind of data it is meant to catch, and lets code through", () => {
    expect(problemsIn("update orgs set branding = '{}' where slug = 'bridge';")).not.toEqual([]);
    expect(problemsIn("delete from athletes where org_id in (select id from orgs where slug in ('elite-squad'));")).not.toEqual([]);
    expect(problemsIn("insert into orgs (name, slug) values ('Acme', 'acme');")).not.toEqual([]);
    expect(problemsIn("insert into public.schools (name, division) select name, division from staging;")).not.toEqual([]);
    expect(problemsIn("insert into high_schools (name) values ('Probe');")).not.toEqual([]);
    expect(problemsIn("copy transfer_windows from '/tmp/windows.csv';")).not.toEqual([]);
    expect(problemsIn("update athletes set advisor_id = '00000000-0000-0000-0000-000000000001';")).not.toEqual([]);
    expect(problemsIn("comment on table orgs is 'Bridge first';")).not.toEqual([]);

    expect(problemsIn("create function f() returns void language plpgsql as $$ begin insert into public.orgs (name, slug) values (n, s); end $$;")).toEqual([]);
    expect(problemsIn("insert into public.users (id, email) select id, coalesce(email, '') from auth.users on conflict (id) do nothing;")).toEqual([]);
    expect(problemsIn("-- where slug = 'bridge'\nalter table orgs add column notes text;")).toEqual([]);
    expect(problemsIn("insert into storage.buckets (id, name) values ('documents', 'documents');")).toEqual([]);
  });

  // Verified this law bites: added a scratch
  // migrations/0041_probe.sql with
  // `update orgs set branding = '{}' where slug = 'bridge';`, watched
  // it fail naming the file, deleted it. The same with
  // `insert into schools (name, division) values ('Probe', 'D1');`.
  it("no checked migration names an org, carries an id, or writes data rows", () => {
    const offenders = checkedMigrations().flatMap(({ file, sql }) => problemsIn(sql).map((p) => `${file}: ${p}`));
    expect(offenders).toEqual([]);
  });
});
