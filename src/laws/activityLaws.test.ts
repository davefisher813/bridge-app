// Stage 5, Phase 6: the activity log (migration 0044).
//
// Dave approved the plan 2026-09-27. The rule the log lives by: an
// append-only, Admin-only record whose summaries never carry the text of
// a check-in note, a message or a document reading. Two layers hold it,
// a branded type in src/lib/data/activity.ts and these laws, and both
// are required: the type stops `summary: someString`, the laws stop a
// note handed to a template as if it were a name, a family or member
// screen reading the table, a delete path anywhere in src, and a
// migration that lets a parameter reach summary.
//
// Each law was planted, watched to fail, and reverted; the plant is
// written above each one.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { buildFixture, FAMILY_ID, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { ACTIVITY_ACTIONS, ACTIVITY_SUBJECT_TYPES, activitySummary, logActivity } from "@/lib/data/activity";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");
const MIGRATIONS = join(ROOT, "migrations");
const SCRIPTS = join(ROOT, "scripts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(ROOT.length + 1);
const THIS_LAW = join(SRC, "laws/activityLaws.test.ts");
const ACTIVITY = join(SRC, "lib/data/activity.ts");
const ALL_TS = walk(SRC).filter((f) => /\.tsx?$/.test(f) && f !== THIS_LAW);
const SOURCES = ALL_TS.filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/testing/") && !f.includes("/laws/"));

// The bodies the fixture carries that must never reach a summary: the
// check-in note, both messages, the staff note and the two lines the
// stand-in model read off the fixture transcript.
const BODIES = ["Fixture check-in note", "Fixture message from staff", "Fixture reply from the family", "Fixture note.", "Fixture squad note", "The GPA cell was smudged", "No graduation year was read"];

// ── (a) No caller hands logActivity a note, a body or a reading ──────

// The text of every `logActivity(` call: from the open paren to its
// matching close, so a property named inside a nested object counts.
function callsOf(src: string, fn: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${fn}\\(`, "g");
  for (const m of src.matchAll(re)) {
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(m.index!, i + 1));
  }
  return out;
}

const FORBIDDEN_PROPS = ["notes", "note", "body", "text", "extracted", "content", "instructions", "family_note", "reviewer_comment", "message", "warnings", "reasons"];

// What is wrong with one call's text, or nothing.
function problemsInCall(call: string): string[] {
  const out: string[] = [];
  for (const prop of FORBIDDEN_PROPS) {
    if (new RegExp(`[{,\\s]${prop}\\s*[:,}]`).test(call)) out.push(`passes a property named "${prop}"`);
  }
  // summary is a branded value from activitySummary(), never a literal.
  if (/\bsummary\s*:\s*(["'`])/.test(call)) out.push("hands summary a string literal");
  if (/\bsummary\s*:\s*[\w.]+\s*\+/.test(call)) out.push("builds summary by concatenation");
  if (/as\s+ActivitySummary\b/.test(call)) out.push("casts to ActivitySummary");
  return out;
}

describe("LAW: a summary is built from a template, and no caller hands the log a note, a body or a reading", () => {
  it("the checker catches each shape it is meant to catch, and lets a clean call through", () => {
    expect(problemsInCall('logActivity(supabase, { orgId, actorId, action: "checkin_logged", subjectType: "checkin", summary, notes: parsed.values.notes })')).not.toEqual([]);
    expect(problemsInCall("logActivity(supabase, { orgId, actorId, action, subjectType, summary: activitySummary(action, { name, body: parsed.values.body }) })")).not.toEqual([]);
    expect(problemsInCall('logActivity(supabase, { orgId, actorId, action, subjectType, summary: "Sent " + body })')).not.toEqual([]);
    expect(problemsInCall('logActivity(supabase, { orgId, actorId, action, subjectType, summary: `Applied ${extracted.gpa}` })')).not.toEqual([]);
    expect(problemsInCall("logActivity(supabase, { orgId, actorId, action, subjectType, summary: text as ActivitySummary })")).not.toEqual([]);
    expect(problemsInCall('logActivity(supabase, { orgId: org.id, actorId: user.id, athleteId, action: "athlete_edited", subjectType: "athlete", subjectId: athleteId, summary: activitySummary("athlete_edited", { name: athlete.name }) })')).toEqual([]);
    expect(problemsInCall("logActivity(supabase, { orgId, actorId, action, subjectType, summary })")).toEqual([]);
  });

  // Verified this law bites: added a scratch src/lib/actions/_probe.ts
  // whose logActivity call passed `notes` and `summary: "Logged" as
  // ActivitySummary`, and chained `.from("activity_log").delete()`;
  // this law, the cast law and the append-only law each failed naming
  // the file. Deleted it.
  it("every logActivity call in src passes names, statuses, kinds and dates only", () => {
    const offenders: string[] = [];
    for (const f of SOURCES.filter((f) => f !== ACTIVITY)) {
      for (const call of callsOf(read(f), "logActivity")) {
        for (const p of problemsInCall(call)) offenders.push(`${rel(f)}: ${p}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Verified this law bites: the same scratch file's `as ActivitySummary`
  // failed here, naming the file.
  it("only activity.ts makes an ActivitySummary", () => {
    const offenders = ALL_TS.filter((f) => f !== ACTIVITY && /as\s+ActivitySummary\b|<ActivitySummary>/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
    const src = read(ACTIVITY).replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/export type ActivitySummary = string & \{ readonly __brand: "ActivitySummary" \}/);
    expect(src.match(/as ActivitySummary\b/g)?.length).toBe(1);
    // The insert takes the branded type and nothing looser.
    expect(src).toMatch(/summary: ActivitySummary;/);
  });

  // Verified this law bites: gave message_sent a `body?: string` and
  // wrote it into the template, watched it fail naming "body", reverted.
  it("the templates accept no property that could carry free text", () => {
    const src = read(ACTIVITY);
    const start = src.indexOf("export interface ActivitySubjects");
    const block = src.slice(src.indexOf("{", start) + 1, src.indexOf("\n}\n", start)).replace(/^\s*\/\/.*$/gm, "");
    // Each action's line holds its subject in braces; every property
    // named inside them has to be one of the allowed kinds of value.
    const props = [...block.matchAll(/\{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/(\w+)\??:/g)].map((x) => x[1]));
    expect(props.length).toBeGreaterThan(20);
    const allowed = new Set(["name", "from", "to", "advisor", "school", "kind", "date", "role", "athlete"]);
    expect(props.filter((p) => !allowed.has(p))).toEqual([]);
    expect(block).not.toMatch(/\bnotes?\b|\bbody\b|\btext\b|\bextracted\b|\bcontent\b|\binstructions\b|\bsummary\b/);
  });
});

// ── (b) The harness: fixture bodies never reach a recorded log write ─

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(REDIRECT + url);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
});

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

async function quietly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const message = (e as Error).message;
    if (!message.startsWith(REDIRECT) && message !== NOT_FOUND) throw e;
  }
}

const logWrites = () => writes.filter((w) => w.table === "activity_log");
const leaked = (rows: RecordedWrite[]) => {
  const text = JSON.stringify(rows.map((w) => w.rows));
  return BODIES.filter((b) => text.includes(b));
};

describe("LAW: the fixture bodies never appear in a recorded activity_log write", () => {
  // Verified this law bites: appended "Fixture note." to the
  // athlete_edited template, watched it fail naming the body, reverted.
  it("every template, fed the fixture's names, writes a row that carries none of the bodies", async () => {
    const client = createFakeClient(data, { userId: OWNER_ID, recorded: writes }) as never;
    const subjects: Record<string, object> = {
      athlete_status_changed: { name: "Fixture Athlete", from: "Active", to: "Committed" },
      advisor_set: { name: "Fixture Athlete", advisor: "Example Owner" },
      target_added: { name: "Fixture Athlete", school: "Fixture State University" },
      target_status_changed: { name: "Fixture Athlete", school: "Fixture State University", from: "Target", to: "Offer" },
      target_removed: { name: "Fixture Athlete", school: "Fixture State University" },
      checkin_logged: { name: "Fixture Athlete", kind: "call", date: "2026-09-21" },
      member_invited: { name: "Example Member", role: "Viewer" },
      member_role_changed: { name: "Example Member", from: "Viewer", to: "Admin" },
      assignment_reviewed: { name: "Fixture Athlete", kind: "transcript", to: "Accepted" },
    };
    for (const action of ACTIVITY_ACTIONS) {
      const subject = subjects[action] ?? { name: "Fixture Athlete", kind: "transcript" };
      const summary = activitySummary(action, subject as never);
      const r = await logActivity(client, { orgId: String(data.orgs[0].id), actorId: OWNER_ID, athleteId: IDS.athlete, action, subjectType: ACTIVITY_SUBJECT_TYPES[0], summary });
      expect(r.ok, action).toBe(true);
    }
    expect(logWrites()).toHaveLength(ACTIVITY_ACTIONS.length);
    expect(leaked(logWrites())).toEqual([]);
  });

  // The actions that take free text, run with the fixture's own bodies.
  // Each must have logged (a row exists to be searched) and the row must
  // carry none of the body; without the first half a missing call site
  // would pass this as cleanly as a clean one.
  it("a check-in with the fixture note logs nothing of the note", async () => {
    const { logCheckin } = await import("@/lib/actions/checkins");
    await quietly(() => logCheckin(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ kind: "call", occurredOn: "2026-09-21", notes: "Fixture check-in note." })));
    expect(writes.some((w) => w.table === "athlete_checkins")).toBe(true);
    expect(logWrites()).toHaveLength(1);
    expect(leaked(logWrites())).toEqual([]);
  });

  it("a staff message and a family message log nothing of the body", async () => {
    const { sendMessage } = await import("@/lib/actions/messages");
    await quietly(() => sendMessage(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ body: "Fixture message from staff." })));
    currentUser = FAMILY_ID;
    await quietly(() => sendMessage(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ body: "Fixture reply from the family." })));
    expect(writes.filter((w) => w.table === "athlete_messages")).toHaveLength(2);
    expect(logWrites()).toHaveLength(2);
    expect(leaked(logWrites())).toEqual([]);
    // A family row, when it is logged, is the SQL function's fixed line.
    for (const w of logWrites().filter((w) => w.rows[0]?.actor_id === FAMILY_ID)) expect(w.rows[0]?.summary).toBe("Sent a message");
  });

  it("a staff note logs nothing of the note", async () => {
    const { addNote } = await import("@/lib/actions/athletes");
    await quietly(() => addNote(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ body: "Fixture note." })));
    expect(writes.some((w) => w.table === "athlete_notes")).toBe(true);
    expect(leaked(logWrites())).toEqual([]);
  });

  // Verified this law bites: set the fixture's check-in row summary to
  // "Fixture check-in note.", watched it fail, reverted.
  it("the fixture's own rows carry names, statuses, kinds and dates only", () => {
    const rows = buildFixture().activity_log;
    expect(rows.length).toBeGreaterThan(4);
    const text = JSON.stringify(rows.map((r) => r.summary));
    expect(BODIES.filter((b) => text.includes(b))).toEqual([]);
    expect(text).not.toMatch(/@|\d{3}-\d{4}|\d{4}-\d{2}-\d{2}/);
    for (const r of rows) {
      expect(ACTIVITY_ACTIONS).toContain(r.action);
      expect(ACTIVITY_SUBJECT_TYPES).toContain(r.subject_type);
      expect(String(r.summary).length).toBeLessThanOrEqual(200);
    }
    // Rows on the fixture athlete, none on the transfer, so the section
    // and the empty state both have something to render.
    expect(rows.some((r) => r.athlete_id === IDS.athlete)).toBe(true);
    expect(rows.some((r) => r.athlete_id === IDS.athleteTransfer)).toBe(false);
  });
});

// ── (c) No family or member screen or loader reads the log ───────────

describe("LAW: a family or member screen never names the activity log", () => {
  // Verified this law bites: added `// loadOrgActivity` to
  // src/lib/data/family.ts, watched it fail naming the file, reverted.
  it("no family or member page or loader names activity_log or its helpers", () => {
    const scoped = SOURCES.filter((f) => /\/app\/org\/\[slug\]\/(family|member)\//.test(f) || /\/lib\/data\/(family|member)[^/]*\.ts$/.test(f));
    expect(scoped.length).toBeGreaterThan(3);
    const offenders = scoped.filter((f) => /activity_log|loadActivity|loadOrgActivity|loadAthleteActivity|logActivity|ActivitySummary|log_family_message/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

// ── (d) Append only: no update or delete path anywhere in src ────────

describe("LAW: nothing in src updates, upserts or deletes an activity_log row", () => {
  // Verified this law bites: the scratch src/lib/actions/_probe.ts above
  // chained `.from("activity_log").delete().eq(...)`, watched it fail
  // naming the file, deleted it.
  it("every .from(\"activity_log\") chain is an insert or a select", () => {
    const offenders: string[] = [];
    for (const f of ALL_TS) {
      const src = read(f);
      for (const m of src.matchAll(/\.from\(\s*["'`]activity_log["'`]\s*\)/g)) {
        const tail = src.slice(m.index! + m[0].length).split(";")[0];
        if (/\.(update|upsert|delete)\(/.test(tail)) offenders.push(`${rel(f)}: .from("activity_log")${tail.trim().slice(0, 60)}`);
      }
      if (/from\(\s*["'`]activity_log["'`]\s*\)\s*\.\s*(update|upsert|delete)/.test(src.replace(/\s+/g, ""))) offenders.push(`${rel(f)}: compact update or delete`);
    }
    expect(offenders).toEqual([]);
  });

  // Verified this law bites: made the fake's family write take its
  // summary from `args.body`, watched this and the fake's own test in
  // src/lib/data/activity.test.ts fail, reverted.
  it("the fake writes the log the way the database does: inserts only, one row per family message", () => {
    const fake = read(join(SRC, "testing/fakeSupabase.ts"));
    expect(fake).toMatch(/table: "activity_log"/);
    expect(fake).toMatch(/summary: "Sent a message"/);
  });
});

// ── (f) The migration: shape, and no parameter reaches summary ───────

describe("LAW: migration 0044 is append only, Admins only, and its family function carries no text", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith("0044_"));
  const sql = file ? read(join(MIGRATIONS, file)).replace(/^\s*--.*$/gm, "") : "";

  // Verified this law bites: changed athlete_id to `on delete cascade`,
  // watched it fail, reverted.
  it("exists and creates the table with the plan's columns and the app's enum", () => {
    expect(file).toBe("0044_activity_log.sql");
    const table = sql.match(/create table activity_log \(([\s\S]*?)\n\);/);
    expect(table).toBeTruthy();
    const cols = [...table![1].matchAll(/^\s+(\w+)\s+/gm)].map((m) => m[1]);
    expect(cols).toEqual(["id", "org_id", "athlete_id", "actor_id", "action", "subject_type", "subject_id", "summary", "created_at"]);
    expect(table![1]).toMatch(/athlete_id\s+uuid references athletes\(id\) on delete set null/);
    expect(table![1]).toMatch(/actor_id\s+uuid references users\(id\) on delete set null/);
    expect(table![1]).not.toMatch(/athletes\(id\) on delete cascade|users\(id\) on delete cascade/);
    expect(table![1]).toMatch(/summary\s+text not null check \(length\(btrim\(summary\)\) between 1 and 200\)/);
    const enumValues = [...sql.match(/create type activity_action as enum \(([\s\S]*?)\);/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(enumValues).toEqual([...ACTIVITY_ACTIONS]);
    const subjectTypes = [...sql.match(/subject_type in \(([^)]*)\)/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(subjectTypes).toEqual([...ACTIVITY_SUBJECT_TYPES]);
    for (const col of ["org_id", "athlete_id", "actor_id"]) expect(sql).toMatch(new RegExp(`create index \\w+ on activity_log \\(${col}`));
  });

  // Verified this law bites: appended
  // `create policy activity_log_update on activity_log for update using (true);`
  // to 0044, watched it fail, reverted. The same with the read policy
  // widened to _member_org_ids(), which the RLS suite alone cannot
  // catch today (that helper admits owner and staff only since 0031).
  it("has a read policy on _staff_org_ids(), an insert policy signed by the session, and no other policy", () => {
    const policies = [...sql.matchAll(/create policy (\w+) on activity_log for (\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(policies).toEqual(["activity_log_read:select", "activity_log_insert:insert"]);
    expect(sql).toMatch(/create policy activity_log_read on activity_log for select\s+using \(org_id in \(select private\._staff_org_ids\(\)\)\);/);
    expect(sql).not.toMatch(/activity_log[\s\S]{0,120}_member_org_ids/);
    expect(sql).toMatch(/create policy activity_log_insert on activity_log for insert\s+with check \(org_id in \(select private\._staff_org_ids\(\)\) and actor_id = \(select auth\.uid\(\)\)\);/);
    expect(sql).toMatch(/alter table activity_log enable row level security;/);
  });

  it("carries the coherence trigger for athlete rows and the honesty trigger that refuses an update", () => {
    expect(sql).toMatch(/create trigger activity_log_coherent\s+before insert or update on activity_log\s+for each row when \(new\.athlete_id is not null\)\s+execute function private\.athlete_row_is_coherent\(\);/);
    expect(sql).toMatch(/create trigger activity_log_honest\s+before insert or update on activity_log\s+for each row execute function private\.activity_is_honest\(\);/);
    const honest = sql.match(/create or replace function private\.activity_is_honest\(\)[\s\S]*?\$\$;/)![0];
    expect(honest).toMatch(/new\.created_at := now\(\);/);
    expect(honest).toMatch(/new\.actor_id := session_uid;/);
    expect(honest).toMatch(/raise exception 'activity_log: a row is never rewritten, redated or re-signed'\s+using errcode = 'check_violation';/);
  });

  // Verified this law bites: gave log_family_message a `p_body text`
  // parameter, assigned it to a variable and wrote that as the summary,
  // watched it fail three ways (the parameter, the assignment, the
  // non-literal), reverted. The same with the table's revoke from anon
  // deleted.
  it("every function that writes the log takes no text and writes a literal summary, and nothing is granted to anon", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
      const text = read(join(MIGRATIONS, f)).replace(/^\s*--.*$/gm, "");
      for (const fn of text.matchAll(/create (?:or replace )?function (\S+)\s*\(([^)]*)\)[\s\S]*?\$\$([\s\S]*?)\$\$/g)) {
        const [, name, args, body] = fn;
        if (!/insert into (?:public\.)?activity_log/.test(body)) continue;
        if (/\btext\b/i.test(args)) offenders.push(`${f}: ${name} takes a text parameter`);
        if (/summary\s*:=\s*p_/.test(body)) offenders.push(`${f}: ${name} assigns summary from a parameter`);
        if (/\|\|/.test(body)) offenders.push(`${f}: ${name} concatenates text`);
        for (const ins of body.matchAll(/insert into (?:public\.)?activity_log\s*\(([^)]*)\)\s*values\s*\(([\s\S]*?)\);/g)) {
          const cols = ins[1].split(",").map((c) => c.trim());
          const vals = ins[2].split(",").map((v) => v.trim());
          const at = cols.indexOf("summary");
          if (at < 0 || !/^'[^']*'$/.test(vals[at] ?? "")) offenders.push(`${f}: ${name} writes a summary that is not a literal`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(sql).toMatch(/create or replace function public\.log_family_message\(p_athlete uuid\) returns void\s+language plpgsql security definer\s+set search_path = ''/);
    expect(sql).toMatch(/private\._family_athlete_ids\(\)/);
    expect(sql).toMatch(/revoke all on public\.activity_log from anon;/);
    expect(sql).toMatch(/revoke execute on function public\.log_family_message\(uuid\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.log_family_message\(uuid\) to authenticated;/);
  });

  // Verified this law bites: deleted the 0044 line from
  // scripts/run_rls_test.sh, watched it fail, restored it.
  it("the RLS suite applies 0044 and holds the log to its cases", () => {
    const runner = read(join(SCRIPTS, "run_rls_test.sh"));
    expect(runner).toMatch(/migrations\/0044_activity_log\.sql/);
    const suite = read(join(SCRIPTS, "rls_test.sql"));
    expect(suite).toMatch(/array\['activity_log', 'insert into activity_log/);
    expect(suite).toMatch(/ALL 0044 ASSERTIONS PASSED/);
    for (const line of ["log_family_message('00000000-0000-0000-0000-000000000120')", "an Admin updated % log rows", "an Admin deleted % log rows", "a Viewer read % log rows", "an Athlete login read % log rows", "Elite''s Admin read % of Bridge''s log", "a leftover staff row read % Bridge log rows"]) {
      expect(suite, line).toContain(line);
    }
  });
});
