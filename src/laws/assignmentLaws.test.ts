// Stage 5, Phase 4: assignments (migrations 0045 and 0046).
//
// Dave approved the plan 2026-09-27 (docs/PLAN_STAGE5.md, "Phase 4:
// Assignments"). The rules an assignment lives by:
//
//   - Overdue is computed from due_on and status, never stored, and
//     there is no in-progress status.
//   - The Viewer reads nothing about assignments.
//   - The one thing an Athlete login writes is the submit_assignment
//     function, never a query of its own, and the file it sends lands
//     only under <org>/family/<request>/<file>.
//   - A submission runs no Doc AI and sends no email.
//   - The family's note and the reviewer's comment never reach an
//     activity line.
//   - Every Admin action scopes by org and athlete and refuses the wrong
//     role, and the fake's copy of the database function refuses what
//     the SQL does.
//
// Each law was planted, watched to fail, and reverted; the plant is
// written above each one. The SQL is proved by scripts/rls_test.sql,
// which run_rls_test.sh applies after 0046; the planted cases there are
// listed at the head of its 0046 block.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { buildFixture, FAMILY_ID, IDS, MEMBER_ID, ORG_WITH_MODULES, OUTSIDER_ID, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { activitySummary } from "@/lib/data/activity";
import {
  ASSIGNMENT_CATEGORIES,
  ASSIGNMENT_KINDS,
  ASSIGNMENT_KIND_LOG_WORD,
  ASSIGNMENT_STATUSES,
  FAMILY_STORAGE_PATH,
  computeOverdue,
  isFamilyStoragePathFor,
} from "@/lib/data/assignments";

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
const stripLineComments = (src: string) => src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, "");

const THIS_LAW = join(SRC, "laws/assignmentLaws.test.ts");
const ALL_TS = walk(SRC).filter((f) => /\.tsx?$/.test(f) && f !== THIS_LAW);
const SOURCES = ALL_TS.filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/testing/") && !f.includes("/laws/"));

const M45 = join(MIGRATIONS, "0045_doc_status_filed.sql");
const M46 = join(MIGRATIONS, "0046_assignments.sql");
const ACTIONS = join(SRC, "lib/actions/assignments.ts");
const DATA = join(SRC, "lib/data/assignments.ts");
const VALIDATION = join(SRC, "lib/validation/assignment.ts");

// ── The harness: the same mocks the action laws use ──────────────────

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";
const BRIDGE_ID = "00000000-0000-0000-0000-0000000000a1";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let revalidated: string[] = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void revalidated.push(path) }));
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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }) }));
// The service role: the submit action reads a family's file with it and
// nothing else. Its writes land in the same list.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes }) }));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  revalidated = [];
});

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; notFound: boolean; state: { errors: Record<string, string>; [k: string]: unknown } | null }> {
  try {
    return { redirect: null, notFound: false, state: (await fn()) as never };
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return { redirect: m.slice(REDIRECT.length), notFound: false, state: null };
    if (m === NOT_FOUND) return { redirect: null, notFound: true, state: null };
    throw e;
  }
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

const PDF = Buffer.from("%PDF-1.4\n%a fresh score report\n1 0 obj << >> endobj\n%%EOF\n");
const FAMILY_PATH = `${BRIDGE_ID}/family/req_law/1-scores.pdf`;
const inserts = (table: string) => writes.filter((w) => w.op === "insert" && w.table === table);
const updates = (table: string) => writes.filter((w) => w.op === "update" && w.table === table);
// The Postgres code a fake function answered with, if it refused.
const codeOf = (r: unknown) => (r as { error?: { code?: string } | null }).error?.code;

// A file the family login "uploaded" to the bucket, as the browser would.
function putFamilyFile(over: { name?: string; owner?: string | null; bytes?: Buffer } = {}) {
  const name = over.name ?? FAMILY_PATH;
  data.storage_objects!.push({ bucket: "documents", name, owner: over.owner === undefined ? FAMILY_ID : over.owner, base64: (over.bytes ?? PDF).toString("base64") });
  return name;
}

const submitForm = (path: string | null, note = "A private family note.") =>
  form({ note, ...(path ? { storagePath: path, fileName: "scores.pdf", mediaType: "application/pdf" } : {}) });

// ── (a) Overdue is computed, never stored ────────────────────────────

describe("LAW: overdue is computed from due_on and status and is never stored", () => {
  // Verified this law bites: added `overdue boolean not null default
  // false,` to the table in 0046, watched the column check fail, then
  // reverted; added `overdue: true` to the create action's insert and
  // watched the payload check fail, reverted.
  it("the table has no overdue, due soon or late column", () => {
    const sql = stripSqlComments(read(M46));
    const table = sql.match(/create\s+table\s+assignments\s*\(([\s\S]*?)\n\);/i);
    expect(table).not.toBeNull();
    const columns = table![1].split("\n").map((l) => l.trim().match(/^(\w+)\s+/)?.[1]).filter(Boolean) as string[];
    expect(columns).toContain("due_on");
    expect(columns.filter((c) => /overdue|due_soon|is_late|late$/i.test(c))).toEqual([]);
    expect(sql).not.toMatch(/\balter\s+table\s+assignments[\s\S]*?overdue/i);
  });

  it("no write to assignments in src carries an overdue field", () => {
    const offenders: string[] = [];
    for (const f of SOURCES) {
      const src = read(f);
      for (const m of src.matchAll(/\.from\(\s*["'`]assignments["'`]\s*\)/g)) {
        const tail = src.slice(m.index! + m[0].length).split(";")[0];
        if (/\.(insert|update|upsert)\(/.test(tail) && /overdue|dueSoon|due_soon/i.test(tail)) offenders.push(rel(f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the fixture rows and a loaded row carry no overdue field", () => {
    for (const r of buildFixture().assignments) expect(Object.keys(r).filter((k) => /overdue|late/i.test(k))).toEqual([]);
  });

  it("computeOverdue answers from its arguments alone", () => {
    expect(computeOverdue("2026-09-01", "assigned", "2026-09-29")).toBe(true);
    expect(computeOverdue("2026-09-01", "assigned", "2026-08-29")).toBe(false);
    expect(computeOverdue("2026-09-01", "submitted", "2026-09-29")).toBe(false);
    const body = read(DATA).match(/export function computeOverdue[\s\S]*?\n}\n/);
    expect(body).not.toBeNull();
    expect(body![0]).not.toMatch(/\.from\(|await|Date\.now|new Date\(\)/);
  });
});

// ── (b) No in-progress status ────────────────────────────────────────

describe("LAW: an assignment is assigned, submitted, needs revision, complete or cancelled, and never in progress", () => {
  // Verified this law bites: added 'in_progress' to the enum in 0046,
  // watched both checks fail, reverted.
  it("the enum in the migration is the list the app carries", () => {
    const sql = stripSqlComments(read(M46));
    const enumBody = sql.match(/create\s+type\s+assignment_status\s+as\s+enum\s*\(([^)]*)\)/i)?.[1] ?? "";
    const values = [...enumBody.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...ASSIGNMENT_STATUSES]);
    expect(values).toHaveLength(5);
  });

  it("no assignment code or migration names an in-progress state", () => {
    const offenders = [M46, DATA, ACTIONS, VALIDATION]
      .filter((f) => /in[_ -]?progress/i.test(f.endsWith(".sql") ? stripSqlComments(read(f)) : stripLineComments(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the categories and kinds are the migration's, and adding one is a migration", () => {
    const sql = stripSqlComments(read(M46));
    const list = (name: string) => [...(sql.match(new RegExp(`create\\s+type\\s+${name}\\s+as\\s+enum\\s*\\(([^)]*)\\)`, "i"))?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(list("assignment_category")).toEqual([...ASSIGNMENT_CATEGORIES]);
    expect(list("assignment_kind")).toEqual([...ASSIGNMENT_KINDS]);
  });
});

// ── (c) The Viewer never sees assignments ────────────────────────────

describe("LAW: no Viewer screen or loader names an assignment", () => {
  // Verified this law bites: added `// assignments` to
  // src/lib/data/member.ts, watched it fail naming the file, reverted.
  it("no file under member/ or lib/data/member* mentions assignments, and the migration keys reads off Admins and the athlete's login", () => {
    const scoped = SOURCES.filter((f) => /\/app\/org\/\[slug\]\/member\//.test(f) || /\/lib\/data\/member[^/]*\.ts$/.test(f));
    expect(scoped.length).toBeGreaterThan(3);
    const offenders = scoped.filter((f) => /assignment|submit_assignment/i.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  // Verified this law bites: widened the read policy to
  // private._any_org_ids(), watched it fail here and in the RLS suite
  // (a Bridge Viewer read 1 row), reverted.
  it("the read policy is Admins plus the athlete's own login, and nothing wider", () => {
    const sql = stripSqlComments(read(M46));
    const read_ = sql.match(/create policy assignments_read on assignments for select\s+using\s*\(([\s\S]*?)\);/i)?.[1] ?? "";
    expect(read_).toMatch(/private\._staff_org_ids\(\)/);
    expect(read_).toMatch(/private\._family_athlete_ids\(\)/);
    expect(read_).not.toMatch(/_any_org_ids|_member_org_ids|_observer_org_ids/);
    const cmds = [...sql.matchAll(/create policy \w+ on assignments for (\w+)/gi)].map((m) => m[1].toLowerCase()).sort();
    expect(cmds).toEqual(["insert", "select", "update"]);
    expect(sql).not.toMatch(/for all/i);
  });

  it("the data module a family screen imports never names the staff-only tables", () => {
    expect(read(DATA)).not.toMatch(/athlete_notes|athlete_checkins|activity_log|logActivity/);
  });
});

// ── (d) The only family write is the function ────────────────────────

describe("LAW: an Athlete login writes an assignment only through submit_assignment", () => {
  // Verified this law bites: added `.from("assignments").update({ status:
  // "submitted" })` to submitAssignment, watched both the static and the
  // recorded-write checks fail, reverted.
  it("submitAssignment calls the function and never queries the table to write", () => {
    const src = stripLineComments(read(ACTIONS));
    const body = src.slice(src.indexOf("export async function submitAssignment"));
    expect(body).toMatch(/\.rpc\(\s*["']submit_assignment["']/);
    expect(body).not.toMatch(/\.from\(\s*["']assignments["']\s*\)/);
    expect(body).not.toMatch(/\.from\(\s*["']documents["']\s*\)\s*\.\s*(insert|update|upsert|delete)/);
    // A query write. (createHash's own .update(bytes) is not one.)
    expect(body).not.toMatch(/\.(insert|upsert|delete)\(|\.update\(\s*\{/);
    // The only place the file names the function.
    expect((src.match(/\.rpc\(/g) ?? []).length).toBe(1);
  });

  it("nothing in src deletes an assignment or updates one from a family path", () => {
    const offenders: string[] = [];
    for (const f of SOURCES) {
      const src = read(f);
      const family = /\/app\/org\/\[slug\]\/family\//.test(f) || /\/lib\/data\/family[^/]*\.ts$/.test(f);
      for (const m of src.matchAll(/\.from\(\s*["'`]assignments["'`]\s*\)/g)) {
        const tail = src.slice(m.index! + m[0].length).split(";")[0];
        if (/\.delete\(/.test(tail)) offenders.push(`${rel(f)}: deletes an assignment`);
        if (family && /\.(insert|update|upsert|delete)\(/.test(tail)) offenders.push(`${rel(f)}: a family path writes an assignment`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a submission's writes are all the function's: the document, the row and the log line, marked as such", async () => {
    currentUser = FAMILY_ID;
    putFamilyFile();
    const { submitAssignment } = await import("@/lib/actions/assignments");
    const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue, { errors: {} }, submitForm(FAMILY_PATH)));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/family/${IDS.athlete}`);
    expect(writes.length).toBe(3);
    expect(writes.every((w) => w.via === "rpc:submit_assignment")).toBe(true);
    expect(writes.map((w) => `${w.op}:${w.table}`).sort()).toEqual(["insert:activity_log", "insert:documents", "update:assignments"]);
    const row = data.assignments.find((a) => a.id === IDS.assignmentOverdue)!;
    expect(row.status).toBe("submitted");
    expect(row.family_note).toBe("A private family note.");
    const doc = inserts("documents")[0].rows[0];
    expect(row.document_id).toBe(doc.id);
    expect(doc).toMatchObject({ status: "filed", source_role: "parent", org_id: BRIDGE_ID, athlete_id: IDS.athlete, media_type: "application/pdf", read_by: null, storage_paths: [FAMILY_PATH] });
    expect(doc.content_hash).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(doc.file_size).toBe(PDF.byteLength);
    expect(revalidated).toEqual(expect.arrayContaining([`/org/${ORG_WITH_MODULES}`, `/org/${ORG_WITH_MODULES}/mine`, `/org/${ORG_WITH_MODULES}/assignments`, `/org/${ORG_WITH_MODULES}/family/${IDS.athlete}`, `/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}`]));
  });

  it("a note-only submission of a confirm assignment files no document", async () => {
    currentUser = FAMILY_ID;
    const { submitAssignment } = await import("@/lib/actions/assignments");
    const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentDueSoon, { errors: {} }, submitForm(null, "  Confirmed. ")));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/family/${IDS.athlete}`);
    expect(inserts("documents")).toEqual([]);
    expect(data.assignments.find((a) => a.id === IDS.assignmentDueSoon)).toMatchObject({ status: "submitted", family_note: "Confirmed.", document_id: null });
  });

  it("a sent-back row is resubmitted with a new file, and keeps the reviewer's comment", async () => {
    currentUser = FAMILY_ID;
    putFamilyFile();
    const { submitAssignment } = await import("@/lib/actions/assignments");
    const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentRevision, { errors: {} }, submitForm(FAMILY_PATH, "Added it.")));
    expect(r.redirect).not.toBeNull();
    expect(data.assignments.find((a) => a.id === IDS.assignmentRevision)).toMatchObject({ status: "submitted", reviewer_comment: "Please add the second parent's contribution." });
  });
});

// ── (e) The upload path ──────────────────────────────────────────────

describe("LAW: a family upload lives at <org>/family/<request>/<file> and nowhere else", () => {
  // Verified this law bites: dropped the [2] = 'family' line from the
  // storage policy, watched the SQL check fail here and the RLS suite
  // fail (a family login wrote into a staff request folder), reverted.
  it("the storage policy admits the login's own org and the family folder, and the function checks the same shape the app does", () => {
    const sql = stripSqlComments(read(M46));
    const policy = sql.match(/create policy documents_bucket_family_insert on storage\.objects for insert\s+with check\s*\(([\s\S]*?)\);/i)?.[1] ?? "";
    expect(policy).toMatch(/bucket_id = 'documents'/);
    expect(policy).toMatch(/\(storage\.foldername\(name\)\)\[1\] in \(select org_id::text from private\._family_org_ids\(\) as org_id\)/);
    expect(policy).toMatch(/\(storage\.foldername\(name\)\)\[2\] = 'family'/);
    // Exactly org, family, request: two folders and a file, no flatter and no deeper.
    expect(policy).toMatch(/array_length\(storage\.foldername\(name\), 1\) = 3/);
    // The one storage policy this migration adds, and none altered.
    expect([...sql.matchAll(/create policy (\w+) on storage\.objects/gi)].map((m) => m[1])).toEqual(["documents_bucket_family_insert"]);
    expect(sql).not.toMatch(/alter policy|drop policy (?!if exists documents_bucket_family_insert)/i);
    // The function's regular expression names the same character classes as the app's.
    expect(sql).toContain("/family/[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$");
    expect(FAMILY_STORAGE_PATH.source).toContain("family\\/[A-Za-z0-9_-]+\\/[A-Za-z0-9._-]+$");
  });

  it("the app accepts a four-segment family path and refuses every other shape", () => {
    const org = BRIDGE_ID;
    expect(isFamilyStoragePathFor(`${org}/family/r/f.pdf`, org)).toBe(true);
    for (const bad of [`${org}/r/f.pdf`, `${org}/family/f.pdf`, `${org}/family/a/b/f.pdf`, `${org}/staff/r/f.pdf`, `00000000-0000-0000-0000-0000000000a2/family/r/f.pdf`, `${org}/family/r/..`, `${org}/family/../f.pdf`, "f.pdf"]) {
      expect(isFamilyStoragePathFor(bad, org), bad).toBe(false);
    }
  });

  it("submitAssignment refuses a path outside the family folder, another org's, and a staff request folder, and writes nothing", async () => {
    currentUser = FAMILY_ID;
    const { submitAssignment } = await import("@/lib/actions/assignments");
    for (const bad of [`${BRIDGE_ID}/req_fixture/1-transcript.pdf`, `00000000-0000-0000-0000-0000000000a2/family/req_law/1-scores.pdf`, `${BRIDGE_ID}/family/1-scores.pdf`, `${BRIDGE_ID}/family/req_law/../x.pdf`]) {
      putFamilyFile({ name: bad });
      const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue, { errors: {} }, submitForm(bad)));
      expect(r.redirect, bad).toBeNull();
      expect(r.state?.errors.file, bad).toBeTruthy();
    }
    expect(writes).toEqual([]);
  });

  it("the bytes decide what a file is: an empty file, text sent as a PDF, and an image sent as a PDF are refused", async () => {
    currentUser = FAMILY_ID;
    const { submitAssignment } = await import("@/lib/actions/assignments");
    const cases: Array<[string, Buffer]> = [
      ["1-empty.pdf", Buffer.alloc(0)],
      ["2-text.pdf", Buffer.from("just some text, not a pdf")],
      ["3-png.pdf", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    ];
    for (const [file, bytes] of cases) {
      const path = `${BRIDGE_ID}/family/req_law/${file}`;
      putFamilyFile({ name: path, bytes });
      const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue, { errors: {} }, submitForm(path)));
      expect(r.state?.errors.file, file).toBeTruthy();
    }
    expect(writes).toEqual([]);
  });

  it("the same bytes as a file already filed for the athlete are refused with a pointer to it", async () => {
    currentUser = FAMILY_ID;
    const filed = data.documents.find((d) => d.id === IDS.documentFiled)!;
    filed.content_hash = createHash("sha256").update(PDF).digest("hex");
    putFamilyFile();
    const { submitAssignment } = await import("@/lib/actions/assignments");
    const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue, { errors: {} }, submitForm(FAMILY_PATH)));
    expect(r.state?.errors.file).toMatch(/already uploaded on .* as june-score-report\.pdf/);
    expect(writes).toEqual([]);
  });

  it("an upload assignment cannot be submitted without a file", async () => {
    currentUser = FAMILY_ID;
    const { submitAssignment } = await import("@/lib/actions/assignments");
    const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue, { errors: {} }, submitForm(null)));
    expect(r.state?.errors.file).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it("the function, given the same path shapes directly, refuses each with the database's own code and writes nothing", async () => {
    const client = createFakeClient(data, { userId: FAMILY_ID, recorded: writes });
    putFamilyFile({ name: `${BRIDGE_ID}/req_fixture/staff.pdf` });
    putFamilyFile({ name: `00000000-0000-0000-0000-0000000000a2/family/r/x.pdf` });
    putFamilyFile({ name: `${BRIDGE_ID}/family/r/theirs.pdf`, owner: OWNER_ID });
    const call = (path: string | null, extra: Record<string, unknown> = {}) =>
      client.rpc("submit_assignment", { p_assignment: IDS.assignmentOverdue, p_note: null, p_file_name: "x.pdf", p_file_size: 100, p_media_type: "application/pdf", p_storage_path: path, ...extra });
    for (const path of [`${BRIDGE_ID}/req_fixture/staff.pdf`, `00000000-0000-0000-0000-0000000000a2/family/r/x.pdf`, `${BRIDGE_ID}/family/r/theirs.pdf`, `${BRIDGE_ID}/family/r/missing.pdf`]) {
      expect(codeOf(await call(path)), path).toBe("23514");
    }
    putFamilyFile();
    expect(codeOf(await call(FAMILY_PATH, { p_media_type: "text/html" }))).toBe("23514");
    expect(codeOf(await call(FAMILY_PATH, { p_file_size: 10_485_761 }))).toBe("23514");
    expect(codeOf(await call(FAMILY_PATH, { p_file_size: 0 }))).toBe("23514");
    // An upload assignment called with no file and none attached before, directly.
    expect(codeOf(await call(null, { p_file_name: null, p_file_size: null, p_media_type: null }))).toBe("23514");
    expect(writes).toEqual([]);
    expect(data.assignments.find((a) => a.id === IDS.assignmentOverdue)?.status).toBe("assigned");
  });
});

// ── (f) No Doc AI on a submission, and no email ──────────────────────

describe("LAW: a submission runs no Doc AI and sends no email", () => {
  // Verified this law bites: imported runExtractionPipeline into the
  // action, watched the static check fail, reverted.
  it("the assignment code imports no model, pipeline, ledger or mailer", () => {
    for (const f of [ACTIONS, DATA, VALIDATION]) {
      const src = stripLineComments(read(f));
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) {
        expect(i, `${rel(f)} imports ${i}`).not.toMatch(/docai\/pipeline|docai\/stubCaller|ai\/anthropicCaller|docaiUsage|docaiBudget|applyExtraction|resend|nodemailer|sendgrid|postmark/i);
      }
      if (f !== ACTIONS) continue;
      expect(imports.filter((i) => i.includes("docai/"))).toEqual(["@/lib/docai/acceptance"]);
      expect(src).not.toMatch(/ANTHROPIC|runExtractionPipeline|processDocument|signInWithOtp|inviteUserByEmail|\.functions\.invoke/);
    }
  });

  it("no migration in this phase sets a document to a status a reader would pick up, or names a model", () => {
    const sql = stripSqlComments(read(M46));
    expect([...sql.matchAll(/insert\s+into\s+public\.documents[\s\S]*?returning/gi)].every((m) => /'filed'/.test(m[0]) && /'parent'/.test(m[0]))).toBe(true);
    expect(sql).not.toMatch(/read_by|anthropic|docai_usage/i);
  });

  it("a whole submission records no Doc AI ledger row and no sign-in or invite call", async () => {
    currentUser = FAMILY_ID;
    putFamilyFile();
    const { submitAssignment } = await import("@/lib/actions/assignments");
    await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue, { errors: {} }, submitForm(FAMILY_PATH)));
    expect(writes.filter((w) => w.table === "docai_usage" || w.table.startsWith("auth:"))).toEqual([]);
    expect(inserts("documents")[0].rows[0].read_by).toBeNull();
  });
});

// ── (g) The note and the comment never reach the log ─────────────────

describe("LAW: a family note and a reviewer comment never reach an activity line", () => {
  const SECRETS = ["A private family note.", "Please redo the SECRET second page.", "Secret Title For Assignment", "Secret instructions text."];
  const leaked = (rows: RecordedWrite[]) => rows.flatMap((w) => w.rows.map((r) => String(r.summary))).filter((s) => SECRETS.some((x) => s.includes(x)));

  // Verified this law bites: passed `kind: parsed.comment` to the
  // reviewed template and watched this fail, reverted.
  it("create, review, cancel and submit each log a line, and none carries a title, an instruction, a note or a comment", async () => {
    const { createAssignment, reviewAssignment, cancelAssignment, submitAssignment } = await import("@/lib/actions/assignments");
    await run(() => createAssignment(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ title: SECRETS[2], instructions: SECRETS[3], category: "academics", kind: "upload" })));
    await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentSubmitted, "needs_revision", SECRETS[1]));
    await run(() => cancelAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentDueSoon));
    currentUser = FAMILY_ID;
    putFamilyFile();
    await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue, { errors: {} }, submitForm(FAMILY_PATH, SECRETS[0])));

    const lines = writes.filter((w) => w.table === "activity_log").flatMap((w) => w.rows.map((r) => String(r.summary)));
    expect(lines).toEqual([
      "Created an upload assignment for Fixture Athlete",
      "Reviewed the upload assignment for Fixture Athlete as Needs Revision",
      "Cancelled the confirmation assignment for Fixture Athlete",
      "Submitted the upload assignment",
    ]);
    expect(leaked(writes)).toEqual([]);
    // The text is stored where it belongs.
    expect(data.assignments.find((a) => a.id === IDS.assignmentSubmitted)?.reviewer_comment).toBe(SECRETS[1]);
    expect(data.assignments.find((a) => a.id === IDS.assignmentOverdue)?.family_note).toBe(SECRETS[0]);
  });

  it("the actions' logActivity calls hand a template names and kinds only", () => {
    const src = read(ACTIONS);
    const calls = [...src.matchAll(/activitySummary\(\s*"(\w+)"\s*,\s*(\{[\s\S]*?\})\s*\)/g)];
    expect(calls.map((c) => c[1])).toEqual(["assignment_created", "assignment_reviewed", "assignment_cancelled"]);
    for (const c of calls) expect(c[2], c[1]).not.toMatch(/title|instructions|note|comment|familyNote|reviewerComment|body/i);
  });

  it("the database's log helper takes only the assignment id and writes a literal per kind, and the words match the app's", () => {
    const sql = stripSqlComments(read(M46));
    const fn = sql.match(/create or replace function private\.log_assignment_submitted\(([^)]*)\)[\s\S]*?\$\$([\s\S]*?)\$\$/i);
    expect(fn).not.toBeNull();
    expect(fn![1].trim()).toBe("p_assignment uuid");
    expect(fn![2]).not.toMatch(/\|\||summary\s*:=|format\(/i);
    const literals = [...fn![2].matchAll(/'assignment', a\.id, '([^']*)'\)/g)].map((m) => m[1]);
    expect(literals).toHaveLength(4);
    // The same sentence the app's template makes for each kind's word.
    const expected = ASSIGNMENT_KINDS.map((k) => activitySummary("assignment_submitted", { kind: ASSIGNMENT_KIND_LOG_WORD[k] }));
    expect(literals.sort()).toEqual([...expected].sort());
    // submit_assignment itself writes no line: only through the helper.
    const submit = sql.match(/create or replace function public\.submit_assignment\([\s\S]*?\$\$([\s\S]*?)\$\$/i)?.[1] ?? "";
    expect(submit).toMatch(/perform private\.log_assignment_submitted\(a\.id\)/);
    expect(submit).not.toMatch(/insert\s+into\s+public\.activity_log|summary/i);
  });

  it("the fake's line for each kind is the database's literal", async () => {
    currentUser = FAMILY_ID;
    const { submitAssignment } = await import("@/lib/actions/assignments");
    await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentDueSoon, { errors: {} }, submitForm(null)));
    const fromFake = inserts("activity_log")[0].rows[0];
    expect(fromFake.summary).toBe(activitySummary("assignment_submitted", { kind: ASSIGNMENT_KIND_LOG_WORD.confirm }));
    expect(fromFake).toMatchObject({ action: "assignment_submitted", subject_type: "assignment", actor_id: FAMILY_ID, athlete_id: IDS.athlete });
  });
});

// ── (h) Who may submit, and what may be submitted ────────────────────

describe("LAW: submitAssignment refuses an Admin, another athlete's login, and any row that is not open", () => {
  // Verified this law bites: removed the role check (requireFamily) from
  // the action, watched the Admin case fail; removed the status check
  // from the fake mirror and from 0046, watched this and the RLS suite
  // fail, reverted.
  it("an Admin and a Viewer are sent away, and nothing is written", async () => {
    const { submitAssignment } = await import("@/lib/actions/assignments");
    for (const who of [OWNER_ID, MEMBER_ID, OUTSIDER_ID]) {
      currentUser = who;
      const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue, { errors: {} }, submitForm(null)));
      expect(r.redirect, who).toMatch(/^\/(unauthorized|login)$/);
    }
    expect(writes).toEqual([]);
  });

  it("a login not linked to the athlete does not find it, and one linked cannot reach another athlete's row", async () => {
    currentUser = FAMILY_ID;
    const { submitAssignment } = await import("@/lib/actions/assignments");
    const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athleteTransfer, IDS.assignmentOverdue, { errors: {} }, submitForm(null)));
    expect(r.notFound).toBe(true);
    // Linked to the athlete in the URL but naming another athlete's row.
    data.assignments.push({ ...data.assignments.find((a) => a.id === IDS.assignmentDueSoon)!, id: "other-athlete-row", athlete_id: IDS.athleteNoGpa });
    const other = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, "other-athlete-row", { errors: {} }, submitForm(null)));
    expect(other.state?.errors.form).toBeTruthy();
    const elite = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentElite, { errors: {} }, submitForm(null)));
    expect(elite.state?.errors.form).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it("a submitted, complete or cancelled row is refused", async () => {
    currentUser = FAMILY_ID;
    const { submitAssignment } = await import("@/lib/actions/assignments");
    for (const id of [IDS.assignmentSubmitted, IDS.assignmentComplete, IDS.assignmentCancelled]) {
      const r = await run(() => submitAssignment(ORG_WITH_MODULES, IDS.athlete, id, { errors: {} }, submitForm(null)));
      expect(r.state?.errors.form, id).toMatch(/open for submission/);
    }
    expect(writes).toEqual([]);
  });

  it("the fake function mirrors the database's refusals, with its codes", async () => {
    const asUser = (userId: string | null) => createFakeClient(data, { userId, recorded: writes });
    const args = (id: string) => ({ p_assignment: id, p_note: "n", p_file_name: null, p_file_size: null, p_media_type: null, p_storage_path: null });
    // Signed out and an Admin: 42501. So is a row that is not there or not theirs.
    for (const who of [null, OWNER_ID, MEMBER_ID]) expect(codeOf(await asUser(who).rpc("submit_assignment", args(IDS.assignmentOverdue))), String(who)).toBe("42501");
    expect(codeOf(await asUser(FAMILY_ID).rpc("submit_assignment", args("no-such-row")))).toBe("42501");
    expect(codeOf(await asUser(FAMILY_ID).rpc("submit_assignment", args(IDS.assignmentElite)))).toBe("42501");
    // A removed athlete, and a family whose membership is gone.
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-28T00:00:00.000Z";
    expect(codeOf(await asUser(FAMILY_ID).rpc("submit_assignment", args(IDS.assignmentOverdue)))).toBe("42501");
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = null;
    // Complete, cancelled, submitted: 23514. A note over 4,000: 23514.
    for (const id of [IDS.assignmentComplete, IDS.assignmentCancelled, IDS.assignmentSubmitted]) expect(codeOf(await asUser(FAMILY_ID).rpc("submit_assignment", args(id))), id).toBe("23514");
    expect(codeOf(await asUser(FAMILY_ID).rpc("submit_assignment", { ...args(IDS.assignmentOverdue), p_note: "x".repeat(4001) }))).toBe("23514");
    expect(writes).toEqual([]);
    data.org_members = data.org_members.filter((m) => !(m.user_id === FAMILY_ID && m.org_id === BRIDGE_ID));
    expect(codeOf(await asUser(FAMILY_ID).rpc("submit_assignment", args(IDS.assignmentOverdue)))).toBe("42501");
    expect(writes).toEqual([]);
  });

  it("the database function checks the same things in the same order, is security definer with an empty search path, and is closed to anon", () => {
    const sql = stripSqlComments(read(M46));
    const head = sql.match(/create or replace function public\.submit_assignment\(([\s\S]*?)\) returns uuid\s+language plpgsql security definer\s+set search_path = ''/i);
    expect(head).not.toBeNull();
    const body = sql.match(/create or replace function public\.submit_assignment\([\s\S]*?\$\$([\s\S]*?)\$\$/i)![1];
    const at = (needle: RegExp) => body.search(needle);
    expect(at(/sign in first/)).toBeGreaterThan(-1);
    expect(at(/private\._family_athlete_ids\(\)/)).toBeGreaterThan(at(/sign in first/));
    expect(at(/a\.status not in \('assigned', 'needs_revision'\)/)).toBeGreaterThan(at(/private\._family_athlete_ids\(\)/));
    expect(at(/o\.owner = caller/)).toBeGreaterThan(at(/a\.status not in/));
    // An upload assignment needs a file (or one attached before), in the function as in the fake.
    expect(body).toMatch(/a\.kind = 'upload' and p_storage_path is null and a\.document_id is null/);
    expect(sql).toMatch(/revoke execute on function public\.submit_assignment\(uuid, text, text, int, text, text, text\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.submit_assignment\(uuid, text, text, int, text, text, text\) to authenticated;/);
    expect(sql).toMatch(/revoke all on public\.assignments from anon;/);
  });
});

// ── (i) Admin actions: role, org and athlete scope ───────────────────

describe("LAW: an Admin's create, review and cancel are scoped by org and athlete, and refuse everyone else", () => {
  const FOREIGN_ATHLETE = "00000000-0000-0000-0000-0000000009f1";

  it("createAssignment writes the row in this org, on this athlete, as the caller, and logs it", async () => {
    const { createAssignment } = await import("@/lib/actions/assignments");
    const r = await run(() => createAssignment(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ title: "New Task", category: "ncaa", kind: "confirm", dueOn: "2026-11-01", instructions: "Do it." })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/assignments`);
    expect(inserts("assignments")[0].rows[0]).toMatchObject({ org_id: BRIDGE_ID, athlete_id: IDS.athlete, title: "New Task", category: "ncaa", kind: "confirm", due_on: "2026-11-01", instructions: "Do it.", created_by: OWNER_ID });
    expect(inserts("activity_log")).toHaveLength(1);
  });

  it("createAssignment refuses a bad form and an athlete of another org, and a family login and a Viewer are sent away", async () => {
    const { createAssignment } = await import("@/lib/actions/assignments");
    const bad = await run(() => createAssignment(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ title: "  " })));
    expect(bad.state?.errors.title).toBeTruthy();
    data.athletes.push({ ...data.athletes[0], id: FOREIGN_ATHLETE, org_id: data.orgs[1].id });
    const foreign = await run(() => createAssignment(ORG_WITH_MODULES, FOREIGN_ATHLETE, { errors: {} }, form({ title: "X" })));
    expect(foreign.state?.errors.form).toMatch(/roster/i);
    for (const who of [FAMILY_ID, MEMBER_ID]) {
      currentUser = who;
      const r = await run(() => createAssignment(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ title: "X" })));
      expect(r.redirect, who).toBe("/unauthorized");
    }
    expect(writes).toEqual([]);
  });

  // Verified this law bites: removed `.eq("org_id", org.id)` from the
  // review update, watched the filter check fail, reverted.
  it("reviewAssignment filters its update by id, org and athlete, and only a submitted row", async () => {
    const { reviewAssignment } = await import("@/lib/actions/assignments");
    const r = await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentSubmitted, "complete", null));
    expect(r.state?.errors).toEqual({});
    const update = updates("assignments")[0];
    expect(update.filters.map((f) => f.column).sort()).toEqual(["athlete_id", "id", "org_id", "status"]);
    expect(update.filters.find((f) => f.column === "org_id")?.value).toBe(BRIDGE_ID);
    expect(update.filters.find((f) => f.column === "athlete_id")?.value).toBe(IDS.athlete);
    expect(update.rows[0]).toMatchObject({ status: "complete", reviewed_by: OWNER_ID });
  });

  it("reviewAssignment: Needs Revision needs a comment, a decision must be one of two, and only a submitted row is reviewed", async () => {
    const { reviewAssignment } = await import("@/lib/actions/assignments");
    const noComment = await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentSubmitted, "needs_revision", "   "));
    expect(noComment.state?.errors.comment).toBeTruthy();
    for (const bad of ["cancelled", "assigned", "in_progress", ""]) {
      const r = await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentSubmitted, bad, "x"));
      expect(r.state?.errors.form, bad).toBeTruthy();
    }
    for (const id of [IDS.assignmentOverdue, IDS.assignmentComplete, IDS.assignmentRevision, IDS.assignmentCancelled]) {
      const r = await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, id, "complete", null));
      expect(r.state?.errors.form, id).toMatch(/submitted/i);
    }
    expect(writes).toEqual([]);
    const ok = await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentSubmitted, "needs_revision", "Missing page two."));
    expect(ok.state?.errors).toEqual({});
    expect(data.assignments.find((a) => a.id === IDS.assignmentSubmitted)).toMatchObject({ status: "needs_revision", reviewer_comment: "Missing page two." });
  });

  it("reviewAssignment refuses another org's athlete and another org's or athlete's assignment, changing nothing", async () => {
    const { reviewAssignment } = await import("@/lib/actions/assignments");
    data.athletes.push({ ...data.athletes[0], id: FOREIGN_ATHLETE, org_id: data.orgs[1].id });
    const foreignAthlete = await run(() => reviewAssignment(ORG_WITH_MODULES, FOREIGN_ATHLETE, IDS.assignmentSubmitted, "complete", null));
    expect(foreignAthlete.state?.errors.form).toBeTruthy();
    data.assignments.find((a) => a.id === IDS.assignmentElite)!.status = "submitted";
    const foreignRow = await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentElite, "complete", null));
    expect(foreignRow.state?.errors.form).toBeTruthy();
    const wrongAthlete = await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athleteNoGpa, IDS.assignmentSubmitted, "complete", null));
    expect(wrongAthlete.state?.errors.form).toBeTruthy();
    expect(writes).toEqual([]);
    expect(data.assignments.find((a) => a.id === IDS.assignmentElite)?.status).toBe("submitted");
  });

  it("review and cancel send a family login and a Viewer away", async () => {
    const { reviewAssignment, cancelAssignment, completeAssignment } = await import("@/lib/actions/assignments");
    for (const who of [FAMILY_ID, MEMBER_ID]) {
      currentUser = who;
      expect((await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentSubmitted, "complete", null))).redirect, who).toBe("/unauthorized");
      expect((await run(() => cancelAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue))).redirect, who).toBe("/unauthorized");
      expect((await run(() => completeAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentSubmitted))).redirect, who).toBe("/unauthorized");
    }
    expect(writes).toEqual([]);
  });

  it("cancelAssignment cancels an open or submitted row scoped by org and athlete, and leaves a complete or cancelled one", async () => {
    const { cancelAssignment } = await import("@/lib/actions/assignments");
    await run(() => cancelAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue));
    const update = updates("assignments")[0];
    expect(update.filters.map((f) => f.column)).toEqual(expect.arrayContaining(["id", "org_id", "athlete_id"]));
    expect(update.rows[0]).toEqual({ status: "cancelled" });
    expect(data.assignments.find((a) => a.id === IDS.assignmentOverdue)?.status).toBe("cancelled");
    writes = [];
    for (const id of [IDS.assignmentComplete, IDS.assignmentCancelled, IDS.assignmentElite]) await run(() => cancelAssignment(ORG_WITH_MODULES, IDS.athlete, id));
    expect(writes).toEqual([]);
    expect(data.assignments.find((a) => a.id === IDS.assignmentComplete)?.status).toBe("complete");
    expect(data.assignments.find((a) => a.id === IDS.assignmentElite)?.status).toBe("assigned");
  });

  it("no assignment is ever deleted by an action", async () => {
    const { cancelAssignment, reviewAssignment } = await import("@/lib/actions/assignments");
    await run(() => cancelAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentOverdue));
    await run(() => reviewAssignment(ORG_WITH_MODULES, IDS.athlete, IDS.assignmentSubmitted, "complete", null));
    expect(writes.filter((w) => w.op === "delete")).toEqual([]);
  });
});

// ── (j) The migrations and the SQL suite ─────────────────────────────

describe("LAW: migrations 0045 and 0046 are structure only, applied and proved by the RLS suite", () => {
  it("0045 adds one enum value and nothing else", () => {
    const sql = stripSqlComments(read(M45)).trim();
    expect(sql).toBe("alter type doc_status add value if not exists 'filed';");
  });

  it("0046 carries the table, its org, the coherence and honesty triggers, RLS, and no data", () => {
    const sql = stripSqlComments(read(M46));
    expect(sql).toMatch(/create table assignments/);
    expect(sql).toMatch(/org_id\s+uuid not null references orgs\(id\) on delete cascade/);
    expect(sql).toMatch(/athlete_id\s+uuid not null references athletes\(id\) on delete cascade/);
    expect(sql).toMatch(/alter table assignments enable row level security/);
    expect(sql).toMatch(/create trigger assignments_coherent[\s\S]*?private\.athlete_row_is_coherent\(\)/);
    expect(sql).toMatch(/create trigger assignments_document_coherent/);
    expect(sql).toMatch(/create trigger assignments_honest/);
    expect(sql).toMatch(/new\.updated_at := now\(\)/);
    expect(sql).not.toMatch(/create policy \w+ on assignments for delete/i);
    expect(sql).not.toMatch(/\binsert\s+into\s+(?!public\.(documents|activity_log))\w/i);
  });

  it("run_rls_test.sh applies both after 0044, and the suite holds the planted cases", () => {
    const runner = read(join(SCRIPTS, "run_rls_test.sh"));
    const at = (n: string) => runner.indexOf(`migrations/${n}`);
    expect(at("0045_doc_status_filed.sql")).toBeGreaterThan(at("0044_activity_log.sql"));
    expect(at("0046_assignments.sql")).toBeGreaterThan(at("0045_doc_status_filed.sql"));
    const suite = read(join(SCRIPTS, "rls_test.sql"));
    expect(suite).toMatch(/array\['assignments', 'insert into assignments/);
    expect(suite).toContain("a family member writes nothing but a message and an assignment submission");
    expect(suite).toContain("ALL 0046 ASSERTIONS PASSED");
    for (const line of [
      "a Bridge Viewer read % Bridge assignments through their Elite staff role",
      "a Viewer read % assignments, expected 0",
      "an Athlete login read % assignments of another athlete",
      "an Athlete login wrote to %",
      "anon can execute submit_assignment",
      "an Athlete login submitted for a removed athlete",
      "a leftover staff row read % Bridge assignments",
      "an assignment filed a Bridge athlete under Elite Squad''s org",
      "submit_assignment case % was refused as %, expected %",
      "a login whose family membership was removed still read % assignments",
    ]) {
      expect(suite, line).toContain(line);
    }
  });
});

// ── (k) The fixture, and a filed document never reads as Needs Review ─

describe("LAW: the fixture carries an assignment in each status and a family file", () => {
  it("has each status on the fixture athlete, none on the transfer, one in another org, and a family storage object", () => {
    const rows = buildFixture().assignments;
    const mine = rows.filter((r) => r.athlete_id === IDS.athlete);
    expect([...new Set(mine.map((r) => r.status))].sort()).toEqual([...ASSIGNMENT_STATUSES].sort());
    expect(rows.filter((r) => r.athlete_id === IDS.athleteTransfer)).toEqual([]);
    expect(rows.filter((r) => r.org_id !== BRIDGE_ID).length).toBeGreaterThan(0);
    const overdue = mine.find((r) => r.id === IDS.assignmentOverdue)!;
    expect(computeOverdue(overdue.due_on as string, overdue.status as string, "2026-09-29")).toBe(true);
    expect(mine.filter((r) => computeOverdue(r.due_on as string | null, r.status as string, "2026-09-29")).map((r) => r.id)).toEqual([IDS.assignmentOverdue]);
    const objects = buildFixture().storage_objects!;
    expect(objects.some((o) => String(o.name).startsWith(`${BRIDGE_ID}/family/`) && o.owner === FAMILY_ID)).toBe(true);
    const doc = buildFixture().documents.find((d) => d.id === IDS.documentFiled)!;
    expect(doc).toMatchObject({ status: "filed", source_role: "parent", read_by: null, athlete_id: IDS.athlete });
    expect(mine.find((r) => r.id === IDS.assignmentSubmitted)?.document_id).toBe(IDS.documentFiled);
  });
});

describe("LAW: a filed document never renders in Needs Review or with an Apply button", () => {
  // Verified this law bites: routed 'filed' into the pending group on
  // the documents list, watched it fail, reverted.
  async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
    return renderToStaticMarkup((await mod.default(props)) as never);
  }

  it("the documents list does not put a family file under Needs Review", async () => {
    const html = await render("@/app/org/[slug]/documents/page", { params: Promise.resolve({ slug: ORG_WITH_MODULES }), searchParams: Promise.resolve({}) });
    const at = html.indexOf("june-score-report.pdf");
    // The list must show a filed file, under its own heading. A list
    // that silently omits it would pass a check that only looks at the
    // heading above it.
    expect(at).toBeGreaterThan(-1);
    const before = html.slice(0, at);
    // Section labels only: the row's own title also says Family Upload.
    const heads = [...before.matchAll(/text-muted">(Being Read|Needs Review|Not Used|Applied|Discarded|Family Upload)</g)];
    expect(heads.length).toBeGreaterThan(0);
    expect(heads[heads.length - 1][1]).toBe("Family Upload");
  });

  // A filed row has no Discard, so a staff upload of the same bytes must
  // not be refused as a twin of it (the message would send an Admin to a
  // button that is not there). Verified this law bites: removed the
  // .neq("status", "filed") line, watched it fail, reverted.
  it("a staff upload is not refused as a twin of a family's filed copy", () => {
    const src = readFileSync(join(SRC, "lib/actions/documents.ts"), "utf8");
    const twin = src.match(/\.eq\("content_hash", hash\)([\s\S]*?)\.limit\(1\)/)?.[1] ?? "";
    expect(twin).toMatch(/\.neq\("status", "discarded"\)/);
    expect(twin).toMatch(/\.neq\("status", "filed"\)/);
  });

  it("the document's own page offers no Apply, and the pending reading is untouched", async () => {
    const filed = await render("@/app/org/[slug]/documents/[id]/page", { params: Promise.resolve({ slug: ORG_WITH_MODULES, id: IDS.documentFiled }) });
    expect(filed).toMatch(/june-score-report\.pdf/);
    expect(filed).not.toMatch(/>Apply</);
    expect(filed).not.toMatch(/Needs Review/);
    expect(filed).toMatch(/Family Upload/);
    const pending = await render("@/app/org/[slug]/documents/[id]/page", { params: Promise.resolve({ slug: ORG_WITH_MODULES, id: IDS.document }) });
    expect(pending).toMatch(/fixture\.pdf/);
  });
});
