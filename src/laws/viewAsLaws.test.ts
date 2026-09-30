// Stage 5, Phase 5: View As (migration 0047), the database half.
//
// Dave approved the plan 2026-09-27 (docs/PLAN_STAGE5.md, "Phase 5: View
// As"). An Admin sees exactly what an Athlete login, a Viewer or another
// Admin sees, read only, for at most 30 minutes, on their own token. The
// mechanism is in the database: a row in view_as_sessions makes
// private._effective_uid() the target, every access helper and read
// policy answers for the effective identity, and every write policy and
// write function refuses while private._viewing(). Nothing mints a token
// for another person and nothing reads on anyone's behalf with the
// service role.
//
// What this file holds, in text and on the fake, because a static law
// cannot ask Postgres and scripts/rls_test.sql cannot read the app:
//
//   (a) The migration is in the runner, and the RLS suite carries the two
//       proofs (the equivalence loop and the write-refusal loop) and is
//       generated from pg_class, not from a list.
//   (b) Every write policy in the schema is gated: those that exist at
//       0047 by its catalog loop, every one written after it by its own
//       text. No policy, helper or function that answers for the caller
//       reads auth.uid() but the ones that define the identity, and every
//       function that writes as a definer refuses while viewing.
//   (c) The checkers are themselves proved on planted text, so a regex
//       that stops matching shows up as a failed self-test and not as a
//       law that silently passes everything.
//   (d) The fake (src/testing/fakeSupabase.ts, fakeRpc.ts) mirrors the
//       database: a client that is viewing refuses every write with 42501
//       and records none, follows the target for the read functions, and
//       start_view_as and end_view_as refuse what the SQL refuses and
//       write the same literal lines.
//
// The SQL itself is proved by scripts/rls_test.sql, which run_rls_test.sh
// applies after 0046 and 0047. Planted and reverted there (2026-09-28),
// each failing where named: one write policy left ungated (the catalog
// check, and the write loop by behaviour); the gate present in the text
// but defeated ("or true") on an insert, a delete and a storage policy
// (the write loop alone); a helper left on auth.uid() (the catalog check;
// and spelled "auth . uid ()" to slip past it, the equivalence loop);
// the org scope dropped from two helpers (the multi-org block); a start
// with the owner check dropped (the refusals; the trigger's own check
// is a second lock and both dropped fails); a target outside the org
// (the function's check and the trigger's, each alone holds, both
// dropped fails); the expires_at clause dropped (the expiry block); the
// read policy widened (the reads by Viewer and Athlete); create_org
// unguarded (the catalog and the create_org call).
//
// Every law below was planted, watched to fail, and reverted; the plant
// is written above it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import * as ts from "typescript";
import { createElement } from "react";
import {
  ADMIN_TWO_ID,
  buildFixture,
  FAMILY_ID,
  IDS,
  MEMBER_ID,
  ORG_WITH_MODULES,
  ORG_WITHOUT_MODULES,
  OUTSIDER_ID,
  OWNER_ID,
  withSecondAdmin,
} from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { VIEW_AS_MINUTES, liveViewAsSession } from "@/testing/fakeRpc";
import { p } from "@/testing/pages";

// The app's half (Phase 5, the APP group) runs the real guard, the real
// actions, the real layout and the two new screens on the fake. The
// mocks are the ones actionRun.test.ts and pageRender.test.ts use, with
// two additions: `viewing` (the person the signed-in user is viewing as,
// handed to the USER client only, as the database's own gate is) and
// `referer` (the page a refused write came from). The service-role client
// never gets `viewing`: it bypasses row level security in the database,
// so the only thing between it and a write is the action's own guard, and
// a law that hid that would prove nothing.
const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

let currentUser: string | null = OWNER_ID;
let viewing: string | null = null;
let referer: string | null = null;
let sessionsError: { code: string; message: string } | null = null;
let writes: RecordedWrite[] = [];
let viaServer: RecordedWrite[] = [];
let appData: Dataset = buildFixture();

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => new Headers(referer ? { referer } : {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(REDIRECT + url);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

// A query that answers with an error, for a read the law needs to fail.
function failingQuery(error: { code: string; message: string }) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error });
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const real = createFakeClient(appData, { userId: currentUser, recorded: writes, viewing });
    if (!sessionsError) return real;
    const err = sessionsError;
    return new Proxy(real, {
      get(target, key) {
        if (key === "from") return (table: string) => (table === "view_as_sessions" ? failingQuery(err) : target.from(table));
        return (target as never)[key];
      },
    });
  },
}));

// The service role: no `viewing`, on purpose, and its writes land in the
// same list under their own flag so a law can say which client wrote.
const serverRecorder = {
  push: (...w: RecordedWrite[]) => {
    viaServer.push(...w);
    return writes.push(...w);
  },
} as unknown as RecordedWrite[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(appData, { userId: currentUser, recorded: serverRecorder }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  viewing = null;
  referer = null;
  sessionsError = null;
  writes = [];
  viaServer = [];
  appData = buildFixture();
});

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const MIGRATIONS = join(ROOT, "migrations");
const SCRIPTS = join(ROOT, "scripts");
const read = (f: string) => readFileSync(f, "utf8");
const stripSqlComments = (sql: string) => sql.replace(/^\s*--.*$/gm, "").replace(/\s--[^\n']*$/gm, "");

interface Migration {
  file: string;
  n: number;
  sql: string;
}

function migrationsOnDisk(): Migration[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, n: Number(file.slice(0, 4)), sql: stripSqlComments(read(join(MIGRATIONS, file))) }));
}

const VIEW_AS_FILE = "0047_view_as.sql";
const FIRST = 47;

// ── (b) The checkers, over any list of migrations ────────────────────

interface Policy {
  key: string;
  table: string;
  name: string;
  cmd: string;
  text: string;
  // The file that last wrote it.
  file: string;
  n: number;
}

// The policies as they stand after every migration in order: `create
// policy` adds one, `alter policy` changes its text, `drop policy`
// removes it. A policy made inside a DO loop with format() is invisible
// to this, which is why the RLS suite asks the catalog too; what this
// sees is every policy a migration writes out in the open, which is
// every one written after 0047.
function finalPolicies(ms: Migration[]): Map<string, Policy> {
  const out = new Map<string, Policy>();
  for (const m of ms) {
    // Statements, in order, so a create followed by an alter in one file
    // lands right.
    const stmts = [...m.sql.matchAll(/\b(create|alter|drop)\s+policy\s+(?:if\s+exists\s+)?("?[\w]+"?)\s+on\s+([\w."]+)([\s\S]*?);/gi)];
    for (const s of stmts) {
      const [, verb, rawName, rawTable, rest] = s;
      const name = rawName.replace(/"/g, "");
      const table = rawTable.replace(/"/g, "").replace(/^public\./, "");
      const key = `${table}.${name}`;
      if (verb.toLowerCase() === "drop") {
        out.delete(key);
        continue;
      }
      if (verb.toLowerCase() === "create") {
        const cmd = rest.match(/\bfor\s+(select|insert|update|delete|all)\b/i)?.[1].toLowerCase() ?? "all";
        out.set(key, { key, table, name, cmd, text: rest, file: m.file, n: m.n });
      } else {
        const was = out.get(key);
        // An alter names no command; it keeps the one the policy had.
        out.set(key, { key, table, name, cmd: was?.cmd ?? "all", text: rest, file: m.file, n: m.n });
      }
    }
  }
  return out;
}

const isWrite = (cmd: string) => cmd === "insert" || cmd === "update" || cmd === "delete" || cmd === "all";

// Write policies that no migration gates: written at or after 0047 (the
// catalog loop in 0047 covers everything before it) and not naming
// "(select private._viewing())" in their own text. The select matters: a
// bare _viewing() in a policy is called once per row.
function ungatedWritePolicies(ms: Migration[]): string[] {
  const out: string[] = [];
  for (const p of finalPolicies(ms).values()) {
    if (!isWrite(p.cmd)) continue;
    if (p.n < FIRST) continue;
    if (!/\(\s*select\s+private\._viewing\(\)\s*\)/i.test(p.text)) out.push(`${p.file}: ${p.key} (${p.cmd})`);
  }
  return out;
}

// Read policies that answer for auth.uid() and not the effective
// identity, after every migration in order. Only the one that must not
// follow the switch is allowed.
const READS_REAL_UID = new Set(["view_as_sessions.view_as_sessions_read"]);
function readPoliciesOnRealUid(ms: Migration[]): string[] {
  const out: string[] = [];
  for (const p of finalPolicies(ms).values()) {
    if (p.cmd !== "select" && p.cmd !== "all") continue;
    if (READS_REAL_UID.has(p.key)) continue;
    if (/\bauth\.uid\(\)/.test(p.text)) out.push(`${p.file}: ${p.key}`);
  }
  return out;
}

interface Fn {
  schema: string;
  name: string;
  args: string;
  file: string;
  header: string;
  body: string;
}

// The functions as they stand: a later `create or replace` of the same
// name and argument types replaces the earlier one.
function finalFunctions(ms: Migration[]): Map<string, Fn> {
  const out = new Map<string, Fn>();
  for (const m of ms) {
    // A dropped function is gone (0015 moved the two membership helpers
    // out of public by dropping them there).
    for (const d of m.sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:(\w+)\.)?(\w+)\s*\(/gi)) {
      const schema = d[1] ?? "public";
      for (const key of [...out.keys()]) if (key.startsWith(`${schema}.${d[2]}(`)) out.delete(key);
    }
    for (const f of m.sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?(\w+)\s*\(([^)]*)\)([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\5\$/gi)) {
      const [, schema = "public", name, args, header, , body] = f;
      const types = args
        .split(",")
        .map((a) => a.trim().split(/\s+/).slice(1).join(" ").replace(/\s+default[\s\S]*$/i, "") || a.trim())
        .join(",");
      out.set(`${schema}.${name}(${types})`, { schema, name, args, file: m.file, header, body });
    }
  }
  return out;
}

const ACCESS_HELPERS = [
  "_any_org_ids",
  "_family_athlete_ids",
  "_family_org_ids",
  "_family_staff_ids",
  "_family_staff_rows",
  "_member_org_ids",
  "_observer_org_ids",
  "_observer_staff_rows",
  "_staff_org_ids",
];

// The functions in private that may read auth.uid(): the identity
// itself, the one owner lookup that must use the real caller, and the
// writers that sign a line as the real caller (reached only through a
// function that has already refused while viewing, or a write a viewing
// Admin cannot make).
const PRIVATE_MAY_READ_REAL_UID = new Set([
  "_view_target",
  "_view_org",
  "_effective_uid",
  "_owner_org_ids",
  "log_assignment_submitted",
  "activity_is_honest",
  "assignment_is_honest",
]);

// Private helpers still reading auth.uid() directly, the nine access
// helpers not on the effective identity, and public functions that
// answer for the caller without refusing while viewing or following the
// effective identity.
function identityProblems(ms: Migration[]): string[] {
  const out: string[] = [];
  const fns = finalFunctions(ms);
  for (const f of fns.values()) {
    const reads = /\bauth\.uid\(\)/.test(f.body);
    if (f.schema === "private" && reads && !PRIVATE_MAY_READ_REAL_UID.has(f.name)) out.push(`${f.file}: private.${f.name} reads auth.uid() directly`);
    if (f.schema === "public" && reads && !/_viewing\(\)|_effective_uid\(\)/.test(f.body) && f.name !== "start_view_as" && f.name !== "end_view_as") {
      out.push(`${f.file}: public.${f.name} reads the caller and neither refuses while viewing nor follows the effective identity`);
    }
  }
  for (const name of ACCESS_HELPERS) {
    const f = [...fns.values()].find((x) => x.schema === "private" && x.name === name);
    if (!f) out.push(`private.${name} is not defined by any migration`);
    else if (!/private\._effective_uid\(\)/.test(f.body)) out.push(`${f.file}: private.${name} does not read private._effective_uid()`);
  }
  return out;
}

// SECURITY DEFINER functions that write rows and do not refuse while
// viewing. A definer function bypasses every policy, so its own check is
// all that stands in front of it. Trigger functions run on a write that
// is already refused; start_view_as, end_view_as and the private writers
// they and submit_assignment call are the writers View As allows.
const DEFINER_MAY_WRITE_WHILE_VIEWING = new Set(["start_view_as", "end_view_as", "_close_view_as", "log_assignment_submitted", "handle_auth_user_change", "view_as_is_coherent"]);
function definerWritersWithoutTheGate(ms: Migration[]): string[] {
  const out: string[] = [];
  for (const f of finalFunctions(ms).values()) {
    if (!/security\s+definer/i.test(f.header)) continue;
    if (/returns\s+trigger/i.test(f.header)) continue;
    if (DEFINER_MAY_WRITE_WHILE_VIEWING.has(f.name)) continue;
    if (!/\b(insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from)\b/i.test(f.body)) continue;
    if (!/_viewing\(\)/.test(f.body)) out.push(`${f.file}: ${f.schema}.${f.name} writes as a definer and does not refuse while viewing`);
  }
  return out;
}

// ── (a) The migration and the runner ─────────────────────────────────

describe("LAW: migration 0047 is applied by the runner and proved by the RLS suite", () => {
  const runner = read(join(SCRIPTS, "run_rls_test.sh"));
  const suite = read(join(SCRIPTS, "rls_test.sql"));

  // Verified this law bites: deleted the 0047 line from
  // scripts/run_rls_test.sh, watched this fail, restored it.
  it("run_rls_test.sh applies 0047 after 0046, and every migration on disk is in the runner", () => {
    const at46 = runner.indexOf("migrations/0046_assignments.sql");
    const at47 = runner.indexOf("migrations/0047_view_as.sql");
    expect(at47).toBeGreaterThan(at46);
    expect(at46).toBeGreaterThan(-1);
    const listed = [...runner.matchAll(/migrations\/(\d{4}_[\w]+\.sql)/g)].map((m) => m[1]);
    const onDisk = migrationsOnDisk().map((m) => m.file);
    expect(listed).toEqual(onDisk);
  });

  // Verified this law bites: renamed the exemption list's table in the
  // suite, and separately hard-coded a table list in place of the
  // pg_class query, watched each fail here, reverted.
  it("the RLS suite carries both proofs, generated from pg_class, with one named exemption", () => {
    const block = suite.slice(suite.indexOf("-- View As (migration 0047)"));
    expect(block.length).toBeGreaterThan(1000);
    // The two loops ask the catalog for their tables.
    expect(block).toMatch(/create function public\.zz_view_hash[\s\S]*?from pg_class c join pg_namespace ns on ns\.oid = c\.relnamespace[\s\S]*?c\.relrowsecurity/);
    expect(block).toMatch(/create function public\.zz_write_probe[\s\S]*?from pg_class c join pg_namespace ns on ns\.oid = c\.relnamespace[\s\S]*?c\.relrowsecurity/);
    // Storage is in the loop, and the one table left out is named.
    expect(block).toMatch(/ns\.nspname = 'storage' and c\.relname = 'objects'/);
    expect(block).toMatch(/c\.relname <> 'view_as_sessions'/);
    expect([...block.matchAll(/c\.relname <> '(\w+)'/g)].map((m) => m[1])).toEqual(["view_as_sessions"]);
    // All three roles, compared to a direct read, and the write loop
    // runs for all three as well as for the control.
    for (const label of ["'admin'", "'viewer'", "'athlete'"]) expect(block).toContain(label);
    expect(block).toMatch(/zz_view_diff\(viewing, direct\)/);
    expect(block).toMatch(/control := zz_write_probe\(a2\)/);
    expect(block).toMatch(/probe := zz_write_probe\(a1\)/);
    // The three summary functions are compared too.
    for (const fn of ["member_program(p_org)", "member_program_schools(p_org, a2)", "member_giving(p_org)"]) expect(block).toContain(fn);
    // The catalog check on the gate, on reads and on helpers.
    expect(block).toMatch(/not like '%_viewing\(\)%'/);
    expect(block).toMatch(/still reading auth\.uid\(\) instead of the effective identity/);
    expect(block).toMatch(/private function\(s\) still reading auth\.uid\(\) directly/);
    expect(suite).toContain("ALL 0047 ASSERTIONS PASSED");
    // The table is write-exempt in the coverage check, with its reason.
    expect(suite).toMatch(/write_exempt text\[\] := array\['org_members', 'view_as_sessions'\]/);
  });

  // Verified this law bites: took the expires_at clause out of one of the
  // two function bodies below, and separately the owner check out of
  // start_view_as, watched this fail, reverted.
  it("0047 is shaped as the plan says: the session table, its trigger, the effective identity, both RPCs", () => {
    const m = migrationsOnDisk().find((x) => x.file === VIEW_AS_FILE);
    expect(m).toBeTruthy();
    const sql = m!.sql;

    const table = sql.match(/create table view_as_sessions \(([\s\S]*?)\n\);/);
    expect(table).toBeTruthy();
    const cols = [...table![1].matchAll(/^\s+(\w+)\s+/gm)].map((c) => c[1]).filter((c) => !["check"].includes(c));
    expect(cols).toEqual(["id", "org_id", "viewer_id", "target_id", "started_at", "expires_at", "ended_at", "end_reason"]);
    expect(table![1]).toMatch(/org_id\s+uuid not null references orgs\(id\) on delete cascade/);
    expect(table![1]).toMatch(/viewer_id\s+uuid not null references users\(id\) on delete cascade/);
    expect(table![1]).toMatch(/target_id\s+uuid not null references users\(id\) on delete cascade/);
    expect(table![1]).toMatch(/check \(viewer_id <> target_id\)/);
    expect(sql).toMatch(/create unique index view_as_sessions_one_active on view_as_sessions \(viewer_id\) where ended_at is null;/);

    // The identity: live means not ended, not expired, the viewer still
    // an owner, the target still a member. Both readers say so.
    for (const name of ["_view_target", "_view_org"]) {
      const body = sql.match(new RegExp(`create or replace function private\\.${name}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`))![1];
      expect(body, name).toMatch(/s\.viewer_id = auth\.uid\(\)/);
      expect(body, name).toMatch(/s\.ended_at is null/);
      expect(body, name).toMatch(/s\.expires_at > now\(\)/);
      expect(body, name).toMatch(/v\.role = 'owner'/);
      expect(body, name).toMatch(/exists \(select 1 from public\.org_members t where t\.user_id = s\.target_id and t\.org_id = s\.org_id\)/);
    }
    expect(sql).toMatch(/create or replace function private\._effective_uid\(\)[\s\S]*?select coalesce\(private\._view_target\(\), auth\.uid\(\)\)/);
    expect(sql).toMatch(/create or replace function private\._viewing\(\)[\s\S]*?select private\._view_target\(\) is not null/);

    // The coherence trigger: owner viewer, member target, 30 minutes, and
    // nothing changes after the fact but ending.
    const trig = sql.match(/create or replace function private\.view_as_is_coherent\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/)![1];
    expect(trig).toMatch(/viewer_role is distinct from 'owner'/);
    expect(trig).toMatch(/target_role is null/);
    expect(trig).toMatch(/interval '30 minutes'/);
    expect(trig).toMatch(/a session can only be ended, never changed/);
    expect(sql).toMatch(/create trigger view_as_sessions_coherent\s+before insert or update on view_as_sessions/);

    // The RPCs.
    const start = sql.match(/create or replace function public\.start_view_as\(p_org uuid, p_target uuid\) returns uuid\s+language plpgsql security definer\s+set search_path = ''[\s\S]*?\$\$([\s\S]*?)\$\$;/);
    expect(start).toBeTruthy();
    expect(start![1]).toMatch(/p_org not in \(select private\._owner_org_ids\(\)\)/);
    expect(start![1]).toMatch(/p_target = caller/);
    expect(start![1]).toMatch(/s\.viewer_id = caller and s\.ended_at is null/);
    expect(start![1]).toMatch(/from public\.org_members m where m\.org_id = p_org and m\.user_id = p_target/);
    expect(start![1]).toMatch(/interval '30 minutes'/);
    expect(sql).toMatch(/create or replace function public\.start_view_as\(p_target uuid\) returns uuid\s+language plpgsql security definer\s+set search_path = ''/);
    expect(sql).toMatch(/create or replace function public\.end_view_as\(\) returns void\s+language plpgsql security definer\s+set search_path = ''/);
    // Both read the real caller and never the effective one.
    expect(start![1]).not.toMatch(/_effective_uid/);
    expect(sql.match(/create or replace function public\.end_view_as\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/)![1]).not.toMatch(/_effective_uid/);

    // Grants: nothing for anon or public, signed-in callers only; the
    // table has no write grant left for a client role.
    expect(sql).toMatch(/revoke execute on function public\.start_view_as\(uuid, uuid\) from public, anon;/);
    expect(sql).toMatch(/revoke execute on function public\.end_view_as\(\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.start_view_as\(uuid, uuid\) to authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.end_view_as\(\) to authenticated;/);
    expect(sql).toMatch(/revoke all on public\.view_as_sessions from anon;/);
    expect(sql).toMatch(/revoke insert, update, delete, truncate on public\.view_as_sessions from authenticated;/);
    expect(sql).toMatch(/revoke execute on function private\._close_view_as\(uuid, boolean\) from public, anon, authenticated;/);

    // One read policy, on the real uid, and no write policy of any kind.
    const policies = [...sql.matchAll(/create policy (\w+) on view_as_sessions for (\w+)/g)].map((p) => `${p[1]}:${p[2]}`);
    expect(policies).toEqual(["view_as_sessions_read:select"]);
    expect(sql).toMatch(/create policy view_as_sessions_read on view_as_sessions for select\s+using \(org_id in \(select private\._owner_org_ids\(\)\) and viewer_id = \(select auth\.uid\(\)\)\);/);
  });

  // Verified this law bites: narrowed the loop's command list to
  // ('a', 'w'), and separately its schemas to ('public'), watched each
  // fail, reverted.
  it("0047 gates every write policy in public and storage from the catalog, and rewrites the five inline read policies", () => {
    const sql = migrationsOnDisk().find((x) => x.file === VIEW_AS_FILE)!.sql;
    expect(sql).toMatch(/where n\.nspname in \('public', 'storage'\)\s+and pol\.polcmd in \('a', 'w', 'd', '\*'\)/);
    // The gate is an initplan, "(select private._viewing())": bare, a
    // STABLE function in a policy runs once per row (9 s against 21 ms on
    // a 50,000 row delete).
    expect(sql).toMatch(/not \(select private\._viewing\(\)\)/);
    expect(sql).not.toMatch(/and not private\._viewing\(\)/);
    for (const [policy, table] of [
      ["org_members_self", "org_members"],
      ["users_self", "users"],
      ["athlete_guardians_read", "athlete_guardians"],
      ["athlete_message_reads_read", "athlete_message_reads"],
      ["grading_scales_readable", "high_school_grading_scales"],
    ]) {
      const one = sql.match(new RegExp(`alter policy ${policy} on ${table}\\s+using \\(([\\s\\S]*?)\\);`));
      expect(one, policy).toBeTruthy();
      expect(one![1], policy).toMatch(/private\._effective_uid\(\)/);
      expect(one![1], policy).not.toMatch(/auth\.uid\(\)/);
    }
  });

  // Verified this law bites: added a scratch migrations/0048_probe.sql
  // with `create policy probe_write on athlete_notes for insert with check
  // (true);`, watched it fail naming the file, deleted it. The same with a
  // private helper on auth.uid().
  it("no migration after 0046 leaves a write policy ungated, a read policy or helper on auth.uid(), or a definer writer without the gate", () => {
    const ms = migrationsOnDisk();
    expect(ungatedWritePolicies(ms)).toEqual([]);
    expect(readPoliciesOnRealUid(ms)).toEqual([]);
    expect(identityProblems(ms)).toEqual([]);
    expect(definerWritersWithoutTheGate(ms)).toEqual([]);
  });

  it("the parsers found what they are meant to: the policies, the nine helpers and the three guarded writers", () => {
    const ms = migrationsOnDisk();
    const policies = finalPolicies(ms);
    expect(policies.size).toBeGreaterThan(60);
    expect(policies.get("view_as_sessions.view_as_sessions_read")?.cmd).toBe("select");
    // 0047's own rewrite of a read policy is what the parser ends on.
    expect(policies.get("org_members.org_members_self")?.file).toBe(VIEW_AS_FILE);
    const fns = finalFunctions(ms);
    for (const name of ACCESS_HELPERS) expect([...fns.values()].some((f) => f.schema === "private" && f.name === name && f.file === VIEW_AS_FILE), name).toBe(true);
    for (const name of ["create_org", "log_family_message", "submit_assignment"]) {
      const f = [...fns.values()].find((x) => x.schema === "public" && x.name === name);
      expect(f?.file, name).toBe(VIEW_AS_FILE);
      expect(f?.body, name).toMatch(/private\._viewing\(\)/);
    }
    expect([...fns.values()].find((f) => f.name === "member_giving")?.body).toMatch(/private\._effective_uid\(\)/);
  });
});

// ── (c) The checkers, on planted text ────────────────────────────────

describe("LAW: the View As checkers catch what they are meant to catch", () => {
  const m = (n: number, sql: string): Migration => ({ file: `${String(n).padStart(4, "0")}_probe.sql`, n, sql: stripSqlComments(sql) });

  it("a write policy after 0046 needs the gate, before it the loop in 0047 covers it", () => {
    expect(ungatedWritePolicies([m(48, "create policy p on t for insert with check (org_id in (select private._staff_org_ids()));")])).not.toEqual([]);
    expect(ungatedWritePolicies([m(48, "create policy p on t for update using (true) with check (true);")])).not.toEqual([]);
    expect(ungatedWritePolicies([m(48, "create policy p on t for delete using (true);")])).not.toEqual([]);
    expect(ungatedWritePolicies([m(48, "create policy p on t for all using (true);")])).not.toEqual([]);
    expect(ungatedWritePolicies([m(48, "create policy p on t for insert with check (org_id in (select private._staff_org_ids()) and not (select private._viewing()));")])).toEqual([]);
    // Gated the bare way is caught too: it runs once per row.
    expect(ungatedWritePolicies([m(48, "create policy p on t for insert with check (org_id in (select private._staff_org_ids()) and not private._viewing());")])).not.toEqual([]);
    expect(ungatedWritePolicies([m(48, "create policy p on t for select using (true);")])).toEqual([]);
    expect(ungatedWritePolicies([m(30, "create policy p on t for insert with check (true);")])).toEqual([]);
    // An alter after 0046 that drops the gate is caught, one that keeps it is not.
    const created = m(30, "create policy p on t for insert with check (true);");
    expect(ungatedWritePolicies([created, m(48, "alter policy p on t with check (true);")])).not.toEqual([]);
    expect(ungatedWritePolicies([created, m(48, "alter policy p on t with check (not (select private._viewing()));")])).toEqual([]);
    // A policy dropped is gone.
    expect(ungatedWritePolicies([m(48, "create policy p on t for insert with check (true);"), m(49, "drop policy p on t;")])).toEqual([]);
  });

  it("a read policy on auth.uid() is caught, the effective identity is not, and the session table's own is allowed", () => {
    expect(readPoliciesOnRealUid([m(48, "create policy r on t for select using (user_id = (select auth.uid()));")])).not.toEqual([]);
    expect(readPoliciesOnRealUid([m(48, "create policy r on t for select using (user_id = (select private._effective_uid()));")])).toEqual([]);
    expect(readPoliciesOnRealUid([m(48, "create policy view_as_sessions_read on view_as_sessions for select using (viewer_id = (select auth.uid()));")])).toEqual([]);
    const created = m(30, "create policy r on t for select using (user_id = (select auth.uid()));");
    expect(readPoliciesOnRealUid([created, m(48, "alter policy r on t using (user_id = (select private._effective_uid()));")])).toEqual([]);
  });

  it("a private helper on auth.uid(), a public function that reads the caller freely, and a definer writer without the gate are caught", () => {
    const helpers = ACCESS_HELPERS.map((h) => `create or replace function private.${h}() returns setof uuid language sql stable security definer as $$ select 1 where private._effective_uid() is not null $$;`).join("\n");
    expect(identityProblems([m(47, helpers)])).toEqual([]);
    expect(identityProblems([m(47, helpers), m(48, "create or replace function private._staff_org_ids() returns setof uuid language sql as $$ select org_id from org_members where user_id = auth.uid() $$;")])).not.toEqual([]);
    expect(identityProblems([m(47, helpers), m(48, "create function private._new_helper() returns setof uuid language sql as $$ select 1 where auth.uid() is not null $$;")])).not.toEqual([]);
    expect(identityProblems([m(47, helpers), m(48, "create function public.who_am_i() returns uuid language sql as $$ select auth.uid() $$;")])).not.toEqual([]);
    expect(identityProblems([m(47, helpers), m(48, "create function public.who_am_i() returns uuid language sql as $$ select private._effective_uid() $$;")])).toEqual([]);
    // A helper the migrations never define is caught too.
    expect(identityProblems([m(47, "select 1;")])).not.toEqual([]);

    const writer = "create function public.writes_a_row() returns void language plpgsql security definer as $$ begin insert into public.t (a) values (1); end $$;";
    expect(definerWritersWithoutTheGate([m(48, writer)])).not.toEqual([]);
    expect(definerWritersWithoutTheGate([m(48, writer.replace("begin insert", "begin if private._viewing() then raise exception 'no'; end if; insert"))])).toEqual([]);
    expect(definerWritersWithoutTheGate([m(48, writer.replace("security definer", "stable"))])).toEqual([]);
    expect(definerWritersWithoutTheGate([m(48, "create function public.a() returns trigger language plpgsql security definer as $$ begin insert into public.t (a) values (1); return new; end $$;")])).toEqual([]);
  });
});

// ── (d) The fake mirrors the database ────────────────────────────────

function fresh(second = false): Dataset {
  const data = buildFixture();
  return second ? withSecondAdmin(data) : data;
}
const orgId = (data: Dataset, slug: string) => String(data.orgs!.find((o) => o.slug === slug)!.id);
const snapshot = (data: Dataset) => JSON.stringify(data);

describe("LAW: the fake refuses every write while viewing, records none, and follows the target for reads", () => {
  // Verified this law bites: removed the guard from FakeQuery.run(),
  // watched this fail on the first insert, restored it.
  it("an insert, update, upsert and delete on any table is refused with 42501, nothing is recorded, nothing changes", async () => {
    const data = fresh();
    const recorded: RecordedWrite[] = [];
    const client = createFakeClient(data, { userId: OWNER_ID, viewing: FAMILY_ID, recorded });
    const before = snapshot(data);
    for (const table of ["athletes", "activity_log", "athlete_notes", "athlete_messages", "assignments", "org_members", "users", "documents", "recruiting_targets", "orgs"]) {
      for (const [op, run] of [
        ["insert", () => client.from(table).insert({ id: "probe", org_id: "x" })],
        ["update", () => client.from(table).update({ name: "probe" }).eq("id", "probe")],
        ["upsert", () => client.from(table).upsert({ id: "probe", org_id: "x" })],
        ["delete", () => client.from(table).delete().eq("id", "probe")],
      ] as const) {
        const res = (await run()) as { data: unknown; error: { code?: string; message: string } | null };
        expect(res.error?.code, `${op} ${table}`).toBe("42501");
        expect(res.data, `${op} ${table}`).toBeNull();
      }
    }
    expect(recorded).toEqual([]);
    // Only the live session the fake put there differs from before.
    const after = JSON.parse(snapshot(data)) as Dataset;
    const strip = (d: Dataset) => ({ ...d, view_as_sessions: [] });
    expect(JSON.stringify(strip(after))).toBe(JSON.stringify(strip(JSON.parse(before) as Dataset)));
  });

  it("reads still work while viewing, and storage uploads and removals are refused, unrecorded", async () => {
    const data = fresh();
    const recorded: RecordedWrite[] = [];
    const client = createFakeClient(data, { userId: OWNER_ID, viewing: FAMILY_ID, recorded });
    const { data: rows, error } = await client.from("athletes").select("id, name");
    expect(error).toBeNull();
    expect((rows as unknown[]).length).toBeGreaterThan(0);
    const up = (await client.storage.from("documents").upload("x/y.pdf", new Uint8Array([1]))) as { error: { code?: string } | null };
    expect(up.error?.code).toBe("42501");
    const rm = (await client.storage.from("documents").remove(["x/y.pdf"])) as { data: unknown[] };
    expect(rm.data).toEqual([]);
    const dl = await client.storage.from("documents").download(`${orgId(data, ORG_WITH_MODULES)}/req_fixture/1-transcript.pdf`);
    expect(dl.error).toBeNull();
    expect(recorded).toEqual([]);
  });

  // Verified this law bites: took the viewing check out of the fake's
  // create_org, watched it create an org and this fail, restored it.
  it("create_org, log_family_message and submit_assignment refuse while viewing, and only for that reason", async () => {
    const data = fresh();
    const recorded: RecordedWrite[] = [];
    const client = createFakeClient(data, { userId: OWNER_ID, viewing: FAMILY_ID, recorded });
    const before = snapshot(data);
    for (const [name, args] of [
      ["create_org", { name: "Viewing Made This", slug: "viewing-made-this" }],
      ["log_family_message", { p_athlete: IDS.athlete }],
      ["submit_assignment", { p_assignment: IDS.assignmentDueSoon, p_note: "while viewing", p_file_name: null, p_file_size: null, p_media_type: null, p_storage_path: null }],
    ] as const) {
      const res = (await client.rpc(name, args)) as unknown as { error: { code: string; message: string } };
      expect(res.error, name).toMatchObject({ code: "42501" });
      expect(res.error.message, name).toMatch(/read only while viewing as someone else/);
    }
    expect(recorded).toEqual([]);
    expect(snapshot(data)).toBe(before);
    // Not viewing, the same login gets past that check to its own.
    const plain = createFakeClient(data, { userId: FAMILY_ID, recorded });
    const res = (await plain.rpc("submit_assignment", { p_assignment: IDS.assignmentDueSoon, p_note: "not viewing", p_file_name: null, p_file_size: null, p_media_type: null, p_storage_path: null })) as { error: { message: string } | null };
    expect(res.error).toBeNull();
    expect(recorded.length).toBeGreaterThan(0);
  });

  // Verified this law bites: passed opts.userId instead of the effective
  // id to fakeRpc, watched this fail, restored it.
  it("the read functions answer for the target, and auth.getUser() still answers with the real user", async () => {
    const data = fresh();
    const direct = createFakeClient(data, { userId: OWNER_ID });
    const asAthlete = createFakeClient(data, { userId: OWNER_ID, viewing: FAMILY_ID });
    const bridge = orgId(data, ORG_WITH_MODULES);
    const owner = (await direct.rpc("member_program", { p_org: bridge })) as { data: unknown[] };
    const viewed = (await asAthlete.rpc("member_program", { p_org: bridge })) as { data: unknown[] };
    expect(owner.data.length).toBeGreaterThan(0);
    // An Athlete login reads no program summary, and neither does the Admin viewing one.
    expect(viewed.data).toEqual([]);
    const asViewer = createFakeClient(fresh(), { userId: OWNER_ID, viewing: MEMBER_ID });
    const seenByViewer = (await asViewer.rpc("member_program", { p_org: bridge })) as { data: unknown[] };
    expect(seenByViewer.data.length).toBe(owner.data.length);
    const who = await asAthlete.auth.getUser();
    expect(who.data.user?.id).toBe(OWNER_ID);
  });

  it("a live session for the pair is in the dataset, once, and viewing someone the Admin does not own an org with is refused", () => {
    const data = fresh();
    createFakeClient(data, { userId: OWNER_ID, viewing: FAMILY_ID });
    createFakeClient(data, { userId: OWNER_ID, viewing: FAMILY_ID });
    const rows = data.view_as_sessions!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ org_id: orgId(data, ORG_WITH_MODULES), viewer_id: OWNER_ID, target_id: FAMILY_ID, ended_at: null });
    expect(new Date(String(rows[0].expires_at)).getTime() - new Date(String(rows[0].started_at)).getTime()).toBe(VIEW_AS_MINUTES * 60_000);
    expect(liveViewAsSession(data, OWNER_ID)).toBe(rows[0]);
    // A second, different target while one is live is a mistake in the test.
    expect(() => createFakeClient(data, { userId: OWNER_ID, viewing: MEMBER_ID })).toThrow(/already viewing/);
    // The Elite owner (a leftover staff row) owns nothing to view from.
    expect(() => createFakeClient(fresh(), { userId: OUTSIDER_ID, viewing: FAMILY_ID })).toThrow(/owns no org/);
    expect(() => createFakeClient(fresh(), { userId: null, viewing: FAMILY_ID })).toThrow(/signed-in user/);
  });

  it("view_as_sessions is never written by a query, viewing or not", async () => {
    const data = fresh();
    const client = createFakeClient(data, { userId: OWNER_ID });
    for (const run of [
      () => client.from("view_as_sessions").insert({ org_id: "x", viewer_id: OWNER_ID, target_id: FAMILY_ID }),
      () => client.from("view_as_sessions").update({ expires_at: "2099-01-01" }).eq("id", "x"),
      () => client.from("view_as_sessions").delete().eq("id", "x"),
    ]) {
      const res = (await run()) as { error: { code?: string } | null };
      expect(res.error?.code).toBe("42501");
    }
    expect(data.view_as_sessions).toEqual([]);
  });
});

describe("LAW: the fake's start_view_as and end_view_as refuse what the SQL refuses and write the same lines", () => {
  type Res = { data: unknown; error: { code: string; message: string } | null };
  const start = (client: ReturnType<typeof createFakeClient>, args: Record<string, unknown>) => client.rpc("start_view_as", args) as Promise<Res>;

  // Verified this law bites: dropped the owner check from fakeStartViewAs
  // and watched the Viewer, Athlete login and staff cases fail.
  it("is refused for a signed-out caller, a Viewer, an Athlete login, a leftover staff row, an owner elsewhere, someone in no org, self and a target outside the org, writing nothing", async () => {
    const data = fresh();
    const recorded: RecordedWrite[] = [];
    const bridge = orgId(data, ORG_WITH_MODULES);
    const elite = orgId(data, ORG_WITHOUT_MODULES);
    const as = (userId: string | null) => createFakeClient(data, { userId, recorded });
    const refused = async (res: Promise<Res>, code: string) => expect((await res).error?.code).toBe(code);

    await refused(start(as(null), { p_org: bridge, p_target: FAMILY_ID }), "42501");
    await refused(as(null).rpc("end_view_as") as Promise<Res>, "42501");
    // A Viewer, an Athlete login, and the leftover staff row (Elite's), each naming their own org.
    await refused(start(as(MEMBER_ID), { p_org: bridge, p_target: FAMILY_ID }), "42501");
    await refused(start(as(FAMILY_ID), { p_org: bridge, p_target: MEMBER_ID }), "42501");
    await refused(start(as(OUTSIDER_ID), { p_org: elite, p_target: MEMBER_ID }), "42501");
    await refused(start(as(OUTSIDER_ID), { p_target: MEMBER_ID }), "42501");
    // The Admin: a Bridge person named in Elite, self, and a stranger.
    await refused(start(as(OWNER_ID), { p_org: elite, p_target: FAMILY_ID }), "42501");
    await refused(start(as(OWNER_ID), { p_org: bridge, p_target: OWNER_ID }), "23514");
    await refused(start(as(OWNER_ID), { p_org: bridge, p_target: OUTSIDER_ID }), "42501");
    await refused(start(as(OWNER_ID), { p_org: bridge, p_target: "nobody" }), "42501");
    await refused(start(as(OWNER_ID), { p_org: bridge, p_target: null }), "23514");
    await refused(start(as(OWNER_ID), { p_org: null, p_target: FAMILY_ID }), "42501");
    expect(recorded).toEqual([]);
    expect(data.view_as_sessions).toEqual([]);
    expect(data.activity_log!.filter((l) => String(l.action).startsWith("view_as"))).toEqual([]);
  });

  it("starts for each role, writes one session and one literal line signed by the real Admin, and refuses a second while one is open", async () => {
    const data = fresh(true);
    const recorded: RecordedWrite[] = [];
    const bridge = orgId(data, ORG_WITH_MODULES);
    const client = createFakeClient(data, { userId: OWNER_ID, recorded });
    const lines: string[] = [];
    for (const [target, expected] of [
      [MEMBER_ID, "Started viewing as a Viewer"],
      [FAMILY_ID, "Started viewing as an Athlete"],
      [ADMIN_TWO_ID, "Started viewing as an Admin"],
    ] as const) {
      const before = data.activity_log!.length;
      const res = await start(client, { p_org: bridge, p_target: target });
      expect(res.error).toBeNull();
      const session = data.view_as_sessions!.find((s) => s.id === res.data)!;
      expect(session).toMatchObject({ org_id: bridge, viewer_id: OWNER_ID, target_id: target, ended_at: null });
      // A second start, by either form, is refused while this one is open.
      expect((await start(client, { p_org: bridge, p_target: FAMILY_ID })).error?.code).toBe("55000");
      expect((await start(client, { p_target: FAMILY_ID })).error?.code).toBe("55000");
      expect(data.activity_log!.length).toBe(before + 1);
      const line = data.activity_log![data.activity_log!.length - 1];
      expect(line).toMatchObject({ org_id: bridge, athlete_id: null, actor_id: OWNER_ID, action: "view_as_started", subject_type: "view_as", subject_id: session.id, summary: expected });
      lines.push(String(line.summary));
      expect(((await client.rpc("end_view_as")) as Res).error).toBeNull();
      expect(session).toMatchObject({ end_reason: "returned" });
      expect(data.activity_log![data.activity_log!.length - 1]).toMatchObject({ action: "view_as_ended", summary: "Stopped viewing as someone else" });
    }
    expect(lines).toHaveLength(3);
    expect(recorded.every((w) => w.via?.startsWith("rpc:"))).toBe(true);
    expect(recorded.map((w) => `${w.op} ${w.table}`).filter((x, i, a) => a.indexOf(x) === i).sort()).toEqual(["insert activity_log", "insert view_as_sessions", "update view_as_sessions"]);
  });

  it("the one-argument form finds the one shared org, and ending twice or with nothing open is quiet", async () => {
    const data = fresh();
    const recorded: RecordedWrite[] = [];
    const client = createFakeClient(data, { userId: OWNER_ID, recorded });
    // MEMBER is a Viewer in both Bridge and Elite, and OWNER owns both: two shared orgs.
    expect((await start(client, { p_target: MEMBER_ID })).error?.code).toBe("23514");
    expect((await start(client, { p_target: FAMILY_ID })).error).toBeNull();
    expect(((await client.rpc("end_view_as")) as Res).error).toBeNull();
    const writes = recorded.length;
    expect(((await client.rpc("end_view_as")) as Res).error).toBeNull();
    expect(recorded.length).toBe(writes);
  });

  // Verified this law bites: dropped the lazy close from fakeStartViewAs
  // and watched the old row stay open and this fail.
  it("a session past its time stops applying, the next start closes it as expired with its line, and ending one says expired", async () => {
    const data = fresh();
    const bridge = orgId(data, ORG_WITH_MODULES);
    const client = createFakeClient(data, { userId: OWNER_ID });
    const first = (await start(client, { p_org: bridge, p_target: FAMILY_ID })).data;
    const old = data.view_as_sessions!.find((s) => s.id === first)!;
    old.started_at = new Date(Date.now() - 40 * 60_000).toISOString();
    old.expires_at = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(liveViewAsSession(data, OWNER_ID)).toBeNull();
    const next = await start(client, { p_org: bridge, p_target: MEMBER_ID });
    expect(next.error).toBeNull();
    expect(old).toMatchObject({ end_reason: "expired" });
    expect(data.activity_log!.filter((l) => l.subject_id === old.id && l.action === "view_as_ended")).toEqual([expect.objectContaining({ summary: "Viewing as someone else ended after 30 minutes" })]);
    // Ending an expired, unclosed one.
    const live = data.view_as_sessions!.find((s) => s.id === next.data)!;
    live.started_at = new Date(Date.now() - 40 * 60_000).toISOString();
    live.expires_at = new Date(Date.now() - 1 * 60_000).toISOString();
    expect(((await client.rpc("end_view_as")) as Res).error).toBeNull();
    expect(live).toMatchObject({ end_reason: "expired" });
  });

  it("a session stops applying when the viewer is no longer an owner or the target is no longer a member", () => {
    const data = fresh();
    createFakeClient(data, { userId: OWNER_ID, viewing: FAMILY_ID });
    expect(liveViewAsSession(data, OWNER_ID)).not.toBeNull();
    const target = data.org_members!.findIndex((m) => m.user_id === FAMILY_ID);
    const [removed] = data.org_members!.splice(target, 1);
    expect(liveViewAsSession(data, OWNER_ID)).toBeNull();
    data.org_members!.push(removed);
    expect(liveViewAsSession(data, OWNER_ID)).not.toBeNull();
    const owner = data.org_members!.find((m) => m.user_id === OWNER_ID && m.org_id === removed.org_id)!;
    owner.role = "member";
    expect(liveViewAsSession(data, OWNER_ID)).toBeNull();
  });

  // Verified this law bites: changed one literal in the fake, and
  // separately one in the migration, watched each fail, reverted.
  it("the fake's lines are the migration's literals, word for word", () => {
    const sql = migrationsOnDisk().find((m) => m.file === VIEW_AS_FILE)!.sql;
    const fake = stripSqlComments(read(join(ROOT, "src/testing/fakeRpc.ts")).replace(/^\s*\/\/.*$/gm, ""));
    const literals = (text: string) => [...new Set([...text.matchAll(/'((?:Started viewing as|Stopped viewing as|Viewing as)[^']*)'/g)].map((m) => m[1]))].sort();
    const fromSql = literals(sql);
    const fromFake = [...new Set([...fake.matchAll(/"((?:Started viewing as|Stopped viewing as|Viewing as)[^"]*)"/g)].map((m) => m[1]))].sort();
    expect(fromSql).toEqual([
      "Started viewing as a Viewer",
      "Started viewing as an Admin",
      "Started viewing as an Athlete",
      "Stopped viewing as someone else",
      "Viewing as someone else ended after 30 minutes",
    ]);
    expect(fromFake).toEqual(fromSql);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The app's half (Phase 5, APP). The database half above proves the rows
// and the fake; what follows proves the app agrees with them: the guard
// reads the target's seat, every server action refuses first, the
// banner names the person, and Return ends it. Each law was planted,
// watched to fail, and reverted; the plant is written above it.
// ══════════════════════════════════════════════════════════════════════

// ── (e) Every server action refuses first ────────────────────────────

const ACTIONS_DIR = join(ROOT, "src/lib/actions");
const actionFiles = () =>
  readdirSync(ACTIONS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => ({ file: f, src: read(join(ACTIONS_DIR, f)) }));

// The one file that does not begin with the guard, and why: start and end
// are what turn viewing on and off, and each answers for the REAL caller
// (src/lib/actions/viewAs.ts). Named here so that adding a second is a
// change to this law, in review, and not a quiet omission.
const NO_GUARD_FILES = new Set(["viewAs.ts"]);

// Exports that change nothing and reach nothing that does, each with the
// reason. `previewApprovedListPaste` parses text and returns it,
// `isStubbedModel` reads one environment variable, and
// `pickApprovedListSchool` only redirects to the screen the school opens:
// an Admin viewing another Admin may take that step, and the write that
// follows is refused where it happens.
const READ_ONLY_EXPORTS = new Set(["approvedCourses.ts:previewApprovedListPaste", "approvedCourses.ts:pickApprovedListSchool", "documents.ts:isStubbedModel"]);

interface ExportedFn {
  name: string;
  params: string[];
  first: string;
}

// The file's exports. A function's first statement is what decides a
// guard: the law is that it comes before anything else can happen.
// Everything a "use server" file exports is a public endpoint, so an
// export that is not `export async function` (a const arrow, a default, a
// re-export) is reported as its own problem instead of being skipped.
function exportsOf(src: string): { fns: ExportedFn[]; odd: string[]; useServer: boolean } {
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true);
  const fns: ExportedFn[] = [];
  const odd: string[] = [];
  const first = sf.statements[0];
  const useServer = !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
  for (const n of sf.statements) {
    const exported = ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportDeclaration(n) && !n.isTypeOnly) odd.push(`re-export ${n.getText().slice(0, 40)}`);
    if (ts.isExportAssignment(n)) odd.push("export default");
    if (!exported) continue;
    if (ts.isFunctionDeclaration(n)) {
      if (ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        odd.push("export default");
        continue;
      }
      if (!n.body || !n.name) continue;
      const isAsync = !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (!isAsync) odd.push(`${n.name.text} is not async`);
      const stmt = n.body.statements[0];
      fns.push({ name: n.name.text, params: n.parameters.map((x) => x.name.getText()), first: stmt ? stmt.getText().replace(/\s+/g, " ") : "" });
    } else if (ts.isVariableStatement(n)) {
      odd.push(`export const ${n.declarationList.declarations.map((d) => d.name.getText()).join(", ")}`);
    }
  }
  return { fns, odd, useServer };
}

const GUARD_LINE = "await requireNotViewing();";

// Every problem with a set of action files, as sentences.
function actionGuardProblems(files: { file: string; src: string }[]): string[] {
  const out: string[] = [];
  for (const { file, src } of files) {
    if (NO_GUARD_FILES.has(file)) continue;
    const { fns, odd, useServer } = exportsOf(src);
    if (!useServer) out.push(`${file}: does not begin with "use server"`);
    for (const o of odd) out.push(`${file}: exports ${o}, which the guard law cannot see`);
    for (const f of fns) {
      if (READ_ONLY_EXPORTS.has(`${file}:${f.name}`)) continue;
      if (f.first !== GUARD_LINE) out.push(`${file}: ${f.name} does not begin with ${GUARD_LINE}`);
    }
  }
  return out;
}

describe("LAW: every server action refuses while viewing, before it does anything (static)", () => {
  // Verified this law bites: took the guard out of one function (then
  // moved it below the org lookup in another, then added an action to a
  // scratch file with no guard), watched each fail naming it, reverted.
  it("every exported function in src/lib/actions begins with await requireNotViewing(), bar the named read-only ones", () => {
    expect(actionGuardProblems(actionFiles())).toEqual([]);
  });

  it("there are a lot of them, and the exceptions are real, single-purpose and named", () => {
    const all = actionFiles();
    const guarded = all.filter((f) => !NO_GUARD_FILES.has(f.file)).flatMap((f) => exportsOf(f.src).fns.filter((x) => !READ_ONLY_EXPORTS.has(`${f.file}:${x.name}`)));
    expect(guarded.length).toBeGreaterThan(100);
    // A stale exception is a hole waiting for a function of that name.
    for (const key of READ_ONLY_EXPORTS) {
      const [file, name] = key.split(":");
      expect(exportsOf(all.find((f) => f.file === file)!.src).fns.map((f) => f.name), key).toContain(name);
    }
    for (const file of NO_GUARD_FILES) expect(all.map((f) => f.file)).toContain(file);
    // The three read-only ones write nothing themselves.
    for (const key of READ_ONLY_EXPORTS) {
      const [file] = key.split(":");
      const src = all.find((f) => f.file === file)!.src;
      const body = src.slice(src.indexOf(`export async function ${key.split(":")[1]}`)).split(/\n}\n/)[0]!;
      expect(body, key).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(|createAdminClient|\.storage\b/);
    }
  });

  it("the checker catches a function without the guard, a guard that is not first, a const arrow, a default export and a file without use server", () => {
    const guarded = '"use server";\nexport async function ok(slug: string) {\n  await requireNotViewing();\n  return slug;\n}\n';
    expect(actionGuardProblems([{ file: "a.ts", src: guarded }])).toEqual([]);
    expect(actionGuardProblems([{ file: "a.ts", src: guarded.replace("  await requireNotViewing();\n", "") }])).not.toEqual([]);
    expect(actionGuardProblems([{ file: "a.ts", src: guarded.replace("  await requireNotViewing();\n  return slug;", "  const org = await getOrgBySlug(slug);\n  await requireNotViewing();\n  return org;") }])).not.toEqual([]);
    expect(actionGuardProblems([{ file: "a.ts", src: `${guarded}export const sneaky = async () => {};\n` }])).not.toEqual([]);
    expect(actionGuardProblems([{ file: "a.ts", src: `${guarded}export default async function () {}\n` }])).not.toEqual([]);
    expect(actionGuardProblems([{ file: "a.ts", src: `${guarded}export { other } from "./b";\n` }])).not.toEqual([]);
    expect(actionGuardProblems([{ file: "a.ts", src: guarded.replace('"use server";\n', "") }])).not.toEqual([]);
    // A type export is nothing to guard; the exempt file is skipped by name.
    expect(actionGuardProblems([{ file: "a.ts", src: `${guarded}export interface S { a: string }\n` }])).toEqual([]);
    expect(actionGuardProblems([{ file: "viewAs.ts", src: guarded.replace("  await requireNotViewing();\n", "") }])).toEqual([]);
    // A file that writes and exports only helpers with no guard is still caught, once it exports one.
    expect(actionGuardProblems([{ file: "new.ts", src: '"use server";\nexport async function save() {\n  const supabase = await createClient();\n  await supabase.from("t").insert({});\n}\n' }])).not.toEqual([]);
  });

  // Verified this law bites: imported createAdminClient into viewAs.ts and
  // watched it fail; wrote generateLink into a scratch file under src/lib
  // and watched the no-minting law fail; reverted both.
  it("View As is the one exception, and it takes nothing from anyone: no service role, no token, only start and end", () => {
    const src = read(join(ACTIONS_DIR, "viewAs.ts"));
    const { fns, odd, useServer } = exportsOf(src);
    expect(useServer).toBe(true);
    expect(odd).toEqual([]);
    expect(fns.map((f) => f.name).sort()).toEqual(["endViewAs", "startViewAs"]);
    expect(src).not.toMatch(/createAdminClient|supabase\/admin/);
    // Start is an Admin's: the owner check, and the database's own after it.
    const start = src.slice(src.indexOf("export async function startViewAs"), src.indexOf("export async function endViewAs"));
    expect(start).toMatch(/requireOwner\(org\.id\)/);
    expect(start).toMatch(/rpc\("start_view_as"/);
    // End asks who the real caller is and nothing else: it must not need
    // the role of the person being viewed.
    const end = src.slice(src.indexOf("export async function endViewAs"));
    expect(end).not.toMatch(/require(Role|Owner|Member|Family|DirectoryEditor)\(/);
    expect(end).toMatch(/rpc\("end_view_as"/);
  });

  it("nothing in the app mints or forges a credential for another person", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else out.push(path);
      }
      return out;
    };
    const files = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/laws/") && !f.includes("/testing/"));
    const FORBIDDEN = /generateLink|SignJWT|jsonwebtoken|setSession\(|signInWithIdToken|auth\.admin\.(createUser|updateUserById)|createSigned(Upload)?Url/;
    expect(files.filter((f) => FORBIDDEN.test(read(f))).map((f) => f.slice(ROOT.length + 1))).toEqual([]);
    // The one verifyOtp is the callback for a person's OWN emailed link.
    expect(files.filter((f) => /verifyOtp/.test(read(f))).map((f) => f.slice(ROOT.length + 1))).toEqual(["src/app/auth/callback/route.ts"]);
  });
});

// ── (f) The guard reads the target's seat ────────────────────────────

const slug = ORG_WITH_MODULES;
const asData = (second = false) => {
  appData = second ? withSecondAdmin(buildFixture()) : buildFixture();
};

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; state: unknown; notFound: boolean }> {
  try {
    return { redirect: null, state: await fn(), notFound: false };
  } catch (e) {
    const message = (e as Error).message;
    if (message.startsWith(REDIRECT)) return { redirect: decodeURIComponent(message.slice(REDIRECT.length)), state: null, notFound: false };
    if (message === NOT_FOUND) return { redirect: null, state: null, notFound: true };
    throw e;
  }
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

const bridgeId = () => orgId(appData, ORG_WITH_MODULES);
const sessionRows = () => appData.view_as_sessions ?? [];
const viewLines = () => (appData.activity_log ?? []).filter((l) => String(l.action).startsWith("view_as"));

describe("LAW: while viewing, the guard is the person being viewed, and the banner data names them", () => {
  // Verified this law bites: read org_members by user.id instead of the
  // viewed id in getCurrentUser, watched the Athlete come back as an
  // owner and this fail, restored it.
  it("an Admin viewing an Athlete, a Viewer and another Admin is each of them, with the session on it", async () => {
    const { getCurrentUser } = await import("@/lib/auth/guard");
    asData(true);
    const plain = await getCurrentUser(bridgeId());
    expect(plain).toMatchObject({ id: OWNER_ID, role: "owner", viewingAs: null });
    for (const [target, role, label, name] of [
      [FAMILY_ID, "family", "Athlete", "Fixture Parent"],
      [MEMBER_ID, "member", "Viewer", "Example Member"],
      [ADMIN_TWO_ID, "owner", "Admin", "Fixture Second Admin"],
    ] as const) {
      asData(true);
      viewing = target;
      const user = await getCurrentUser(bridgeId());
      expect(user, target).toMatchObject({ id: target, role, org_id: bridgeId() });
      expect(user?.viewingAs, target).toMatchObject({ viewerId: OWNER_ID, name, role, roleLabel: label });
      expect(new Date(user!.viewingAs!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("the role guards answer for the target: an Admin viewing a Viewer or an Athlete cannot open Admin screens, and is sent where Return is", async () => {
    const { requireOwner, requireRole, requireMember, STAFF_ROLES } = await import("@/lib/auth/guard");
    viewing = MEMBER_ID;
    expect((await run(() => requireOwner(bridgeId()))).redirect).toBe("/unauthorized");
    expect((await run(() => requireRole(bridgeId(), STAFF_ROLES))).redirect).toBe("/unauthorized");
    expect((await run(() => requireMember(bridgeId()))).redirect).toBeNull();
    asData();
    viewing = FAMILY_ID;
    expect((await run(() => requireMember(bridgeId()))).redirect).toBe("/unauthorized");
    // Viewing another Admin, the Admin checks pass, and the write guard is what stops them.
    asData(true);
    viewing = ADMIN_TWO_ID;
    expect((await run(() => requireOwner(bridgeId()))).redirect).toBeNull();
  });

  it("in any org but the one being viewed there is nobody to be, and the answer is Not Authorized, never the sign-in screen", async () => {
    const { getCurrentUser, requireRole, STAFF_ROLES } = await import("@/lib/auth/guard");
    viewing = FAMILY_ID;
    const elite = orgId(appData, ORG_WITHOUT_MODULES);
    expect(await getCurrentUser(elite)).toBeNull();
    expect((await run(() => requireRole(elite, STAFF_ROLES))).redirect).toBe("/unauthorized");
    // Signed out is still the sign-in screen.
    viewing = null;
    currentUser = null;
    expect((await run(() => requireRole(elite, STAFF_ROLES))).redirect).toBe("/login");
  });

  // Verified this law bites: dropped the expires_at check in getViewAs,
  // watched an expired session keep the Athlete's seat, restored it.
  it("a session stops applying when it ends, runs out, or the seat behind it goes: the Admin is the Admin again", async () => {
    const { getCurrentUser } = await import("@/lib/auth/guard");
    const { getViewAs, requireNotViewing } = await import("@/lib/data/viewAs");
    viewing = FAMILY_ID;
    expect((await getCurrentUser(bridgeId()))?.viewingAs).not.toBeNull();
    const row = sessionRows()[0]!;

    // Past its time, never closed: not viewing, and a write is no longer refused.
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    viewing = null;
    expect(await getViewAs()).toBeNull();
    expect(await getCurrentUser(bridgeId())).toMatchObject({ id: OWNER_ID, role: "owner", viewingAs: null });
    await expect(requireNotViewing()).resolves.toBeUndefined();

    // Ended.
    row.expires_at = new Date(Date.now() + 60_000).toISOString();
    expect(await getViewAs()).not.toBeNull();
    row.ended_at = new Date().toISOString();
    row.end_reason = "returned";
    expect(await getViewAs()).toBeNull();
    row.ended_at = null;
    row.end_reason = null;

    // The viewer demoted, or the target removed, ends the effect at once, as the database does.
    const seat = appData.org_members!.find((m) => m.user_id === OWNER_ID && m.org_id === bridgeId())!;
    seat.role = "member";
    expect(await getViewAs()).toBeNull();
    seat.role = "owner";
    expect(await getViewAs()).not.toBeNull();
    const at = appData.org_members!.findIndex((m) => m.user_id === FAMILY_ID);
    appData.org_members!.splice(at, 1);
    expect(await getViewAs()).toBeNull();
  });

  it("only the caller's own session counts: someone else's live session does not make an Admin, or anybody, look like they are viewing", async () => {
    const { getViewAs } = await import("@/lib/data/viewAs");
    asData(true);
    currentUser = ADMIN_TWO_ID;
    viewing = null;
    sessionRows().push({ id: "s-other", org_id: bridgeId(), viewer_id: OWNER_ID, target_id: FAMILY_ID, started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), ended_at: null, end_reason: null });
    expect(await getViewAs()).toBeNull();
    currentUser = FAMILY_ID;
    expect(await getViewAs()).toBeNull();
  });

  // Verified this law bites: made getViewAs return null on any error and
  // watched this fail.
  it("when the app cannot tell whether it is viewing it refuses (throws), and only a missing table reads as not viewing", async () => {
    const { getViewAs, requireNotViewing } = await import("@/lib/data/viewAs");
    sessionsError = { code: "08006", message: "connection failure" };
    await expect(getViewAs()).rejects.toThrow(/Could not tell whether a View As is open/);
    await expect(requireNotViewing()).rejects.toThrow();
    // A write action fails closed too, and writes nothing.
    const { setDocaiBudget } = await import("@/lib/actions/docaiBudget");
    await expect(setDocaiBudget(ORG_WITH_MODULES, { errors: {} }, form({ budget: "35" }))).rejects.toThrow();
    expect(writes).toEqual([]);
    for (const code of ["42P01", "PGRST205"]) {
      sessionsError = { code, message: "relation does not exist" };
      await expect(getViewAs()).resolves.toBeNull();
    }
  });

  it("the words: a refusal names the person and how to get out, minutes left is never zero while live", async () => {
    const { readOnlyMessage, minutesLeft } = await import("@/lib/data/viewAs");
    expect(readOnlyMessage({ name: "Fixture Parent" })).toBe("Read only while viewing as Fixture Parent. Return to Admin to make changes.");
    const now = Date.parse("2026-09-28T12:00:00Z");
    expect(minutesLeft("2026-09-28T12:30:00Z", now)).toBe(30);
    expect(minutesLeft("2026-09-28T12:00:01Z", now)).toBe(1);
    expect(minutesLeft("2026-09-28T12:00:59Z", now)).toBe(1);
    expect(minutesLeft("2026-09-28T12:01:01Z", now)).toBe(2);
    expect(minutesLeft("not a date", now)).toBe(0);
  });
});

// ── (g) Every action refuses, at run time ────────────────────────────

// What a refusal looks like: a redirect back with the reason in the
// address, and nothing else.
const REFUSAL = /\?error=Read only while viewing as /;

describe("LAW: every exported action, run while viewing, refuses at once and writes nothing (runtime)", () => {
  // The argument for each parameter, by its name. The guard is the first
  // line, so the arguments never matter to a guarded action; they matter
  // to one that lost its guard, which then proceeds into its own logic
  // and comes back with anything but this refusal.
  const argFor = (name: string): unknown => {
    if (name === "slug") return ORG_WITH_MODULES;
    if (/^_?prev/i.test(name)) return { errors: {} };
    if (/form$/i.test(name)) return form({});
    if (name === "userId") return FAMILY_ID;
    if (/(^|[a-z])Id$/.test(name) || name === "id") return IDS.athlete;
    if (name === "role") return "owner";
    if (name === "decision") return "complete";
    return undefined;
  };

  // Verified this law bites: deleted the guard line from setDocaiBudget
  // and (separately) from submitAssignment and watched each fail naming
  // the action, restored them.
  for (const { file, src } of actionFiles()) {
    if (NO_GUARD_FILES.has(file)) continue;
    for (const fn of exportsOf(src).fns) {
      if (READ_ONLY_EXPORTS.has(`${file}:${fn.name}`)) continue;
      it(`${file}: ${fn.name}`, async () => {
        asData(true);
        viewing = ADMIN_TWO_ID;
        const mod = (await import(/* @vite-ignore */ `@/lib/actions/${file.replace(/\.ts$/, "")}`)) as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const r = await run(() => mod[fn.name](...fn.params.map(argFor)));
        expect(r.redirect, `${fn.name} returned or threw something other than the refusal`).toMatch(REFUSAL);
        expect(writes).toEqual([]);
        expect(viaServer).toEqual([]);
      });
    }
  }
});

describe("LAW: the actions that write through the service role are stopped by the guard, not by the fake", () => {
  // Realistic calls, taken from the run-time laws of each action: the
  // control (not viewing, the same call) writes, so the refusal below is
  // the guard and not an empty input.
  const CASES: { name: string; call: () => Promise<unknown> }[] = [
    { name: "setDocaiBudget", call: async () => (await import("@/lib/actions/docaiBudget")).setDocaiBudget(slug, { errors: {} }, form({ budget: "35" })) },
    { name: "setScoringPreset", call: async () => (await import("@/lib/actions/matching")).setScoringPreset(slug, { errors: {} }, form({ preset: "baseball_first" })) },
    { name: "updateOrgSettings", call: async () => (await import("@/lib/actions/org")).updateOrgSettings(slug, { errors: {} }, form({ name: " Renamed Foundation ", module_board_governance: "on" })) },
    { name: "createSchool", call: async () => (await import("@/lib/actions/schools")).createSchool(slug, { errors: {} }, form({ name: "View As College", division: "D2" })) },
    { name: "updateSchool", call: async () => (await import("@/lib/actions/schools")).updateSchool(slug, IDS.school, { errors: {} }, form({ name: "Fixture State University", division: "D2", gpaMin: "2.6", satRange: "", location: "New Town, CT", state: "CT" })) },
    { name: "mergeSchool", call: async () => (await import("@/lib/actions/schools")).mergeSchool(slug, IDS.schoolD3, form({ mergeInto: IDS.school })) },
    { name: "createCoach", call: async () => (await import("@/lib/actions/coaches")).createCoach(slug, IDS.schoolD3, { errors: {} }, form({ name: "New Coach", title: "Pitching Coach", email: "new@fixture.example", school_name: "Somewhere Else", isRecruitingCoordinator: "on" })) },
    { name: "deleteCoach", call: async () => (await import("@/lib/actions/coaches")).deleteCoach(slug, IDS.schoolD3, "cc2") },
    {
      name: "createTransferWindow",
      call: async () => (await import("@/lib/actions/transferWindows")).createTransferWindow(slug, { errors: {} }, form({ sport: "Baseball", division: "D1", seasonYear: "2026-27", windowLabel: "Winter", opensOn: "2026-12-01", closesOn: "2026-12-15", sourceUrl: "https://ncaa.org/windows" })),
    },
    { name: "deleteTransferWindow", call: async () => (await import("@/lib/actions/transferWindows")).deleteTransferWindow(slug, "tw1") },
    { name: "inviteMember", call: async () => (await import("@/lib/actions/members")).inviteMember(slug, { errors: {} }, form({ email: "New@Example.test", role: "owner", fullName: "New Person" })) },
    { name: "removeMember", call: async () => (await import("@/lib/actions/members")).removeMember(slug, FAMILY_ID) },
    { name: "renameMemberForm", call: async () => (await import("@/lib/actions/members")).renameMemberForm(slug, MEMBER_ID, form({ fullName: "  Renamed   Member " })) },
    { name: "setMemberTitle", call: async () => (await import("@/lib/actions/members")).setMemberTitle(slug, MEMBER_ID, "  Board Chair ") },
    { name: "createAthlete", call: async () => (await import("@/lib/actions/athletes")).createAthlete(slug, { errors: {}, values: {} }, form({ name: "New Athlete", sport: "baseball", recruitType: "hs", status: "Active" })) },
    { name: "createMetric", call: async () => (await import("@/lib/actions/metrics")).createMetric(slug, IDS.athlete, { errors: {} }, form({ metric: "fbVelo", value: "87", measuredOn: "2026-09-15", source: "pbr" })) },
  ];

  // The member actions ask for the service key and the site address
  // before they act; without them the control run would stop early and
  // prove nothing.
  const HAD = { key: process.env.SUPABASE_SERVICE_ROLE_KEY, site: process.env.NEXT_PUBLIC_SITE_URL };
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
  });
  afterEach(() => {
    if (HAD.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = HAD.key;
    if (HAD.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = HAD.site;
  });

  for (const c of CASES) {
    it(`${c.name}: writes when nobody is viewing, and writes nothing on either client while an Admin views another Admin`, async () => {
      // Control: the same call by the owner, not viewing.
      asData(true);
      const control = await run(c.call);
      expect(writes.length, `${c.name} did nothing in the control run, so the refusal below proves nothing (${String(control.redirect)})`).toBeGreaterThan(0);

      // Viewing another Admin: every Admin check passes, so only the guard stands.
      asData(true);
      writes = [];
      viaServer = [];
      viewing = ADMIN_TWO_ID;
      const r = await run(c.call);
      expect(r.redirect, c.name).toMatch(REFUSAL);
      expect(writes, c.name).toEqual([]);
      expect(viaServer, c.name).toEqual([]);
    });
  }

  it("a refusal goes back to the page the write came from, and only ever to a page in the app", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    asData(true);
    viewing = ADMIN_TWO_ID;
    for (const [ref, expected] of [
      [`https://app.example.test/org/${slug}/roster/new?x=1`, `/org/${slug}/roster/new`],
      [`https://app.example.test/`, `/`],
      [`https://evil.example.test/steal`, `/`],
      [`https://app.example.test//evil.example.test/x`, `/`],
      [null, `/`],
    ] as const) {
      referer = ref;
      const r = await run(() => createAthlete(slug, { errors: {}, values: {} }, form({ name: "X", sport: "baseball", recruitType: "hs", status: "Active" })));
      expect(r.redirect, String(ref)).toBe(`${expected}?error=Read only while viewing as Fixture Second Admin. Return to Admin to make changes.`);
    }
    expect(writes).toEqual([]);
  });

  it("while viewing an Athlete or a Viewer the actions refuse the same way, and an Athlete's own writes (a message, a submission) too", async () => {
    const { sendMessage } = await import("@/lib/actions/messages");
    const { submitAssignment } = await import("@/lib/actions/assignments");
    for (const target of [FAMILY_ID, MEMBER_ID]) {
      asData();
      viewing = target;
      const said = await run(() => sendMessage(slug, IDS.athlete, { errors: {} }, form({ body: "Sent while viewing" })));
      expect(said.redirect, target).toMatch(REFUSAL);
      const sub = await run(() => submitAssignment(slug, IDS.athlete, IDS.assignmentDueSoon, { errors: {} }, form({ note: "Sent while viewing" })));
      expect(sub.redirect, target).toMatch(REFUSAL);
      expect(writes, target).toEqual([]);
      expect(appData.athlete_messages?.some((m) => m.body === "Sent while viewing")).toBe(false);
    }
  });
});

// ── (h) Start and Return ─────────────────────────────────────────────

describe("LAW: only an Admin who owns the organization can start a View As, and only of someone in it", () => {
  // Verified this law bites: took requireOwner out of startViewAs and
  // watched the Not Authorized case fail, restored it.
  it("a Viewer, an Athlete login, a leftover staff row and an outsider are Not Authorized, and nothing is written", async () => {
    const { startViewAs } = await import("@/lib/actions/viewAs");
    const elite = ORG_WITHOUT_MODULES;
    for (const [who, org, target] of [
      [MEMBER_ID, slug, FAMILY_ID],
      [FAMILY_ID, slug, MEMBER_ID],
      [OUTSIDER_ID, elite, MEMBER_ID],
      // Someone with no seat in the org: the database hides the org and
      // the action says Not Authorized; on the fake, which has no row
      // level security, the guard finds no seat and says sign in.
      [OUTSIDER_ID, slug, FAMILY_ID],
    ] as const) {
      asData();
      currentUser = who;
      const r = await run(() => startViewAs(org, target));
      expect(r.redirect, `${who} in ${org}`).toMatch(org === slug && who === OUTSIDER_ID ? /^\/(unauthorized|login)$/ : /^\/unauthorized$/);
      expect(writes).toEqual([]);
      expect(sessionRows()).toEqual([]);
    }
  });

  it("an Admin is refused for self, for someone outside the organization, for a name that is not a person, and while one is open", async () => {
    const { startViewAs } = await import("@/lib/actions/viewAs");
    const back = `/org/${slug}/view-as?error=`;
    asData(true);
    expect((await run(() => startViewAs(slug, OWNER_ID))).redirect).toBe(`${back}Choose someone other than yourself.`);
    expect((await run(() => startViewAs(slug, OUTSIDER_ID))).redirect).toBe(`${back}That person is not in this organization.`);
    expect((await run(() => startViewAs(slug, "nobody"))).redirect).toBe(`${back}Choose a person from the list.`);
    expect(writes).toEqual([]);
    expect(sessionRows()).toEqual([]);

    // One open: a second start, by the same Admin, is refused with the person's name.
    expect((await run(() => startViewAs(slug, FAMILY_ID))).redirect).toBe(`/org/${slug}/family`);
    viewing = FAMILY_ID;
    const before = writes.length;
    const again = await run(() => startViewAs(slug, MEMBER_ID));
    expect(again.redirect).toBe(`${back}You are already viewing as Fixture Parent. Return to Admin first.`);
    expect(writes.length).toBe(before);
    expect(sessionRows()).toHaveLength(1);
  });

  it("an Admin starts one of each level, lands on that person's own home, and the only writes are the two functions' (session and line, signed by the real Admin)", async () => {
    const { startViewAs, endViewAs } = await import("@/lib/actions/viewAs");
    const home = `/org/${slug}`;
    for (const [target, landing, line] of [
      [FAMILY_ID, `${home}/family`, "Started viewing as an Athlete"],
      [MEMBER_ID, `${home}/member`, "Started viewing as a Viewer"],
      [ADMIN_TWO_ID, home, "Started viewing as an Admin"],
    ] as const) {
      asData(true);
      writes = [];
      viewing = null;
      const r = await run(() => startViewAs(slug, target));
      expect(r.redirect, target).toBe(landing);
      expect(sessionRows()).toEqual([expect.objectContaining({ org_id: bridgeId(), viewer_id: OWNER_ID, target_id: target, ended_at: null })]);
      expect(viewLines()).toEqual([expect.objectContaining({ action: "view_as_started", actor_id: OWNER_ID, summary: line })]);
      expect(writes.length).toBeGreaterThan(0);
      expect(writes.every((w) => w.via?.startsWith("rpc:"))).toBe(true);
      expect(viaServer).toEqual([]);
      // Return, from inside it.
      viewing = target;
      const back = await run(() => endViewAs(slug));
      expect(back.redirect).toBe(`${home}/more?notice=Returned to Admin.`);
      expect(sessionRows()[0]).toMatchObject({ end_reason: "returned" });
      expect(viewLines().map((l) => l.summary)).toEqual([line, "Stopped viewing as someone else"]);
    }
  });
});

describe("LAW: Return ends it from any screen, logs it, and never needs the role of the person being viewed", () => {
  it("ends the session and lands on More with the notice, while viewing an Athlete (who could never pass an Admin check)", async () => {
    const { endViewAs } = await import("@/lib/actions/viewAs");
    const { getViewAs } = await import("@/lib/data/viewAs");
    viewing = FAMILY_ID;
    expect(await getViewAs()).not.toBeNull();
    const r = await run(() => endViewAs(slug));
    expect(r.redirect).toBe(`/org/${slug}/more?notice=Returned to Admin.`);
    viewing = null;
    expect(await getViewAs()).toBeNull();
    expect(viewLines()).toEqual([expect.objectContaining({ action: "view_as_ended", actor_id: OWNER_ID, summary: "Stopped viewing as someone else" })]);
  });

  it("with nothing open it is quiet and still lands on More, with a hostile address it lands at the start, signed out it is the sign-in screen", async () => {
    const { endViewAs } = await import("@/lib/actions/viewAs");
    expect((await run(() => endViewAs(slug))).redirect).toBe(`/org/${slug}/more?notice=Returned to Admin.`);
    expect(writes).toEqual([]);
    viewing = null;
    for (const bad of ["../../evil", "a/b", "//evil.example.test", "", "UPPER", "-x"]) expect((await run(() => endViewAs(bad))).redirect, bad).toBe("/");
    currentUser = null;
    expect((await run(() => endViewAs(slug))).redirect).toBe("/login");
  });

  // Verified this law bites: made the fake's end_view_as never say
  // expired, watched this fail, restored it.
  it("a session that ran out is closed as expired, with the 30 minute line", async () => {
    const { endViewAs } = await import("@/lib/actions/viewAs");
    viewing = FAMILY_ID;
    // The fake makes the session on first use; then let it run out.
    const { createClient } = await import("@/lib/supabase/server");
    await createClient();
    const row = sessionRows()[0]!;
    row.started_at = new Date(Date.now() - 40 * 60_000).toISOString();
    row.expires_at = new Date(Date.now() - 10 * 60_000).toISOString();
    viewing = null;
    const r = await run(() => endViewAs(slug));
    expect(r.redirect).toBe(`/org/${slug}/more?notice=Returned to Admin.`);
    expect(row).toMatchObject({ end_reason: "expired" });
    expect(viewLines().map((l) => l.summary)).toEqual(["Viewing as someone else ended after 30 minutes"]);
  });

  it("a failed Return says so on Not Authorized, which carries the banner", async () => {
    const { endViewAs } = await import("@/lib/actions/viewAs");
    const { createClient } = await import("@/lib/supabase/server");
    viewing = FAMILY_ID;
    await createClient();
    // The database refusing the end (a forced failure on the session update).
    const failing = vi.spyOn(await import("@/testing/fakeRpc"), "fakeEndViewAs").mockReturnValue({ data: null, error: { code: "XX000", message: "boom" } });
    try {
      const r = await run(() => endViewAs(slug));
      expect(r.redirect).toBe("/unauthorized?error=Could not return to Admin. Try again.");
    } finally {
      failing.mockRestore();
    }
  });
});

// ── (i) The banner, and the screens ──────────────────────────────────

async function html(el: unknown): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(el as never);
}

async function layout(orgSlug = slug): Promise<string> {
  const mod = (await import("@/app/org/[slug]/layout")) as { default: (a: { children: unknown; params: Promise<{ slug: string }> }) => Promise<unknown> };
  return html(await mod.default({ children: createElement("main", null, "PAGE BODY"), params: p({ slug: orgSlug }) as Promise<{ slug: string }> }));
}

describe("LAW: the banner is in Chrome, names the person, offers Return, and never shows otherwise", () => {
  // Verified this law bites: removed the banner from Chrome and watched
  // every case fail; showed it always and watched the plain case fail.
  it("a plain session has no banner", async () => {
    const out = await layout();
    expect(out).toContain("PAGE BODY");
    expect(out).not.toMatch(/view-as-banner|Viewing as|Return to Admin/);
  });

  it("viewing an Athlete, a Viewer and another Admin: the banner names them and their level, is first in the column, and the tab bar is theirs", async () => {
    const cases: [string, string, string, string][] = [
      [FAMILY_ID, "Fixture Parent", "Athlete", "family"],
      [MEMBER_ID, "Example Member", "Viewer", "member"],
      [ADMIN_TWO_ID, "Fixture Second Admin", "Admin", "org"],
    ];
    const tabs: Record<string, RegExp> = { family: /\/family\/colleges|Colleges/, member: /\/member\/program|Program/, org: /\/roster|Athletes/ };
    for (const [target, name, label, bar] of cases) {
      asData(true);
      viewing = target;
      const out = await layout();
      expect(out, target).toContain('data-kit="view-as-banner"');
      expect(out, target).toContain(`Viewing as ${name}`);
      expect(out, target).toContain(`${label} · Read only`);
      expect(out, target).toMatch(/Return to Admin/);
      expect(out, target).toMatch(tabs[bar]!);
      // In the flow, above the page and above the mark's corner: the banner comes before the body.
      expect(out.indexOf("view-as-banner")).toBeGreaterThan(-1);
      expect(out.indexOf("view-as-banner")).toBeLessThan(out.indexOf("PAGE BODY"));
      // Never fixed, never sticky: it does not ride over the screen or the tab bar.
      const banner = out.slice(out.indexOf("view-as-banner") - 200, out.indexOf("Return to Admin"));
      expect(banner).not.toMatch(/\bfixed\b|\bsticky\b|\babsolute\b/);
    }
  });

  it("a session that has run out shows no banner, and a session in another org is not shown in this one", async () => {
    viewing = FAMILY_ID;
    await layout();
    sessionRows()[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    viewing = null;
    expect(await layout()).not.toMatch(/Viewing as/);
  });

  it("Return is a form that posts to the end action for this organization", async () => {
    viewing = FAMILY_ID;
    const out = await layout();
    expect(out).toMatch(/<form[^>]*>[\s\S]*Return to Admin[\s\S]*<\/form>/);
    expect(out).toMatch(/<button[^>]*>Return to Admin<\/button>/);
  });

  it("Not Authorized and the start carry the banner while viewing, and neither does otherwise", async () => {
    const un = (await import("@/app/unauthorized/page")) as { default: (a: { searchParams?: Promise<{ error?: string }> }) => Promise<unknown> };
    const start = (await import("@/app/page")) as { default: () => Promise<unknown> };
    expect(await html(await un.default({}))).not.toMatch(/Viewing as|Return to Admin/);
    // Viewing: the page says who cannot open it, and the way out is there.
    viewing = FAMILY_ID;
    const out = await html(await un.default({}));
    expect(out).toMatch(/Viewing as Fixture Parent/);
    expect(out).toMatch(/Return to Admin/);
    expect(out).toMatch(/Fixture Parent cannot open that page/);
    // A failed Return leaves its message here.
    expect(await html(await un.default({ searchParams: p({ error: "Could not return to Admin. Try again." }) as Promise<{ error?: string }> }))).toMatch(/Could not return to Admin\. Try again\./);
    // The start: an Admin with more than one org gets the picker, with the banner on it.
    const picker = await html(await start.default());
    expect(picker).toMatch(/Viewing as Fixture Parent[\s\S]*Return to Admin/);
    asData();
    viewing = null;
    currentUser = OWNER_ID;
    expect(await html(await start.default())).not.toMatch(/Viewing as/);
  });
});

async function screen(path: string, props: Record<string, unknown>): Promise<string> {
  const mod = (await import(/* @vite-ignore */ path)) as { default: (a: Record<string, unknown>) => Promise<unknown> };
  return html(await mod.default(props));
}

const LEVEL_PAGE = "@/app/org/[slug]/view-as/page";
const PEOPLE_PAGE = "@/app/org/[slug]/view-as/[role]/page";

describe("LAW: the View As screens are the Admin's, list only this organization's people, and start with a button each", () => {
  it("the levels screen offers Athlete, Viewer and Admin with their counts, excluding the Admin looking", async () => {
    asData(true);
    const out = await screen(LEVEL_PAGE, { params: p({ slug }) });
    expect(out).toMatch(/View As[\s\S]*Choose a Level[\s\S]*Athlete[\s\S]*Viewer[\s\S]*Admin/);
    expect(out).toContain(`/org/${slug}/view-as/athlete`);
    expect(out).toContain(`/org/${slug}/view-as/viewer`);
    expect(out).toContain(`/org/${slug}/view-as/admin`);
    // One other Admin (the second), one Athlete login, one Viewer.
    expect(out).toMatch(/Admin[\s\S]*1 person/);
    expect(out).toContain(`/org/${slug}/more`);
  });

  it("each level lists its people by name with their Title, and the Athlete list shows who they see", async () => {
    asData(true);
    const athletes = await screen(PEOPLE_PAGE, { params: p({ slug, role: "athlete" }) });
    expect(athletes).toMatch(/Athletes[\s\S]*Fixture Parent[\s\S]*Sees[\s\S]*Fixture Athlete/);
    expect(athletes).toMatch(/<button[^>]*>View As<\/button>/);
    expect(athletes).not.toMatch(/Example Member|Fixture Second Admin|Example Owner/);
    const viewers = await screen(PEOPLE_PAGE, { params: p({ slug, role: "viewer" }) });
    expect(viewers).toMatch(/Viewers[\s\S]*Example Member/);
    expect(viewers).not.toMatch(/Fixture Parent|Fixture Second Admin/);
    const admins = await screen(PEOPLE_PAGE, { params: p({ slug, role: "admin" }) });
    expect(admins).toMatch(/Admins[\s\S]*Fixture Second Admin/);
    // Never yourself.
    expect(admins).not.toMatch(/Example Owner/);
  });

  it("the list is this organization's members and nobody else: the other org's people never appear", async () => {
    asData(true);
    for (const role of ["athlete", "viewer", "admin"]) {
      const out = await screen(PEOPLE_PAGE, { params: p({ slug, role }) });
      // OUTSIDER (Elite's leftover staff row) is not a Bridge member.
      expect(out, role).not.toMatch(/Example Outsider|outsider@/i);
    }
    asData();
    const none = await screen(PEOPLE_PAGE, { params: p({ slug, role: "admin" }) });
    expect(none).toMatch(/No Other Admins/);
  });

  it("only an owner opens them: a Viewer, an Athlete login and a leftover staff row are Not Authorized, an unknown level is not found", async () => {
    for (const [who, org] of [
      [MEMBER_ID, slug],
      [FAMILY_ID, slug],
      [OUTSIDER_ID, ORG_WITHOUT_MODULES],
    ] as const) {
      currentUser = who;
      expect((await run(() => screen(LEVEL_PAGE, { params: p({ slug: org }) }))).redirect, who).toBe("/unauthorized");
      expect((await run(() => screen(PEOPLE_PAGE, { params: p({ slug: org, role: "admin" }) }))).redirect, who).toBe("/unauthorized");
    }
    currentUser = OWNER_ID;
    expect((await run(() => screen(PEOPLE_PAGE, { params: p({ slug, role: "everyone" }) }))).notFound).toBe(true);
    expect((await run(() => screen(LEVEL_PAGE, { params: p({ slug: "nowhere" }) }))).notFound).toBe(true);
  });

  it("an Admin who is already viewing another Admin is told to Return first instead of being shown a list that would refuse", async () => {
    asData(true);
    viewing = ADMIN_TWO_ID;
    for (const out of [await screen(LEVEL_PAGE, { params: p({ slug }) }), await screen(PEOPLE_PAGE, { params: p({ slug, role: "admin" }) })]) {
      expect(out).toMatch(/Return to Admin First/);
      expect(out).toMatch(/You are viewing as Fixture Second Admin/);
      expect(out).not.toMatch(/<button[^>]*>View As<\/button>/);
    }
  });
});

// Found by the adversarial review of Phase 5: a session left open by a
// sign-out, and a Panel screen with no way back.
describe("LAW: signing out ends a View As, and every Panel screen an Admin can land on carries the banner", () => {
  it("signout asks end_view_as to close the session before it signs the Admin out", () => {
    const src = read("src/lib/auth/actions.ts");
    const fn = src.slice(src.indexOf("export async function signout"));
    const end = fn.indexOf('rpc("end_view_as")');
    const out = fn.indexOf("auth.signOut()");
    expect(end).toBeGreaterThan(-1);
    expect(out).toBeGreaterThan(end);
  });

  it("the org picker, Not Authorized and Create an Organization pass the banner to their Panel", () => {
    for (const f of ["src/app/page.tsx", "src/app/unauthorized/page.tsx", "src/app/orgs/new/page.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/<Panel viewing=\{/);
      expect(src, f).toMatch(/getViewAs/);
    }
  });

  it("Create an Organization offers no form while viewing", async () => {
    asData();
    viewing = FAMILY_ID;
    const html = await screen("@/app/orgs/new/page", {});
    expect(html).toMatch(/Viewing as Fixture Parent/);
    expect(html).toMatch(/Read only while viewing as Fixture Parent/);
    expect(html).not.toMatch(/Web Address/);
  });
});
