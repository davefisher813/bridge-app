// Bulk actions on the org Assignments list (migration 0071; Dave,
// 2026-10-13: multi-select with a bulk action bar on operational lists).
//
// Held to: only an Admin acts, and is checked before any read or write;
// every query is scoped by org AND the ids, so another org's id is never
// touched; one activity line per row changed, never the title; the notice
// names the counts ("3 completed, 1 skipped"); rows that cannot be acted
// on are skipped, not forced (a submitted or filed row does not move, a
// complete row is not completed again); delete is Admin only and has no
// undo; the migration is structure only.
//
// Each law was planted, watched to fail, and reverted; the plant is
// written above each one. The SQL is proved by scripts/rls_test.sql (the
// section at its end, "0071").

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { filterColumns, form, run, writesTo } from "@/testing/actionHarness";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
});

const read = (p: string) => readFileSync(p, "utf8");
const strip = (sql: string) => sql.replace(/--.*$/gm, "");
const row = (id: string) => data.assignments.find((a) => a.id === id)!;
const ids = (...list: string[]) => {
  const fd = new FormData();
  for (const id of list) fd.append("ids", id);
  return fd;
};
const decoded = (r: { redirect: string | null }) => decodeURIComponent(r.redirect!);

// The fixture's Bridge rows: overdue and due soon (assigned), submitted
// (with a file), revision (sent back, no file), complete, cancelled; and
// Elite's one row.
const BRIDGE_OPEN = [IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentSubmitted, IDS.assignmentRevision];

type Bulk = typeof import("@/lib/actions/assignmentsBulk");
const actions: [string, (b: Bulk) => (slug: string, fd: FormData) => Promise<void>, Record<string, string>][] = [
  ["bulkCompleteAssignments", (b) => b.bulkCompleteAssignments, {}],
  ["bulkCancelAssignments", (b) => b.bulkCancelAssignments, {}],
  ["bulkReassignAssignments", (b) => b.bulkReassignAssignments, { athlete_id: IDS.athleteTransfer }],
  ["bulkChangeDueDate", (b) => b.bulkChangeDueDate, { due_on: "2026-12-01" }],
  ["bulkDeleteAssignments", (b) => b.bulkDeleteAssignments, {}],
];

function formWith(idList: string[], extra: Record<string, string>): FormData {
  const fd = ids(...idList);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

// ── Only an Admin acts ───────────────────────────────────────────────

describe("LAW: a Viewer is refused before any read or write", () => {
  // Planted: moved requireRole below parseBulkIds/createClient in begin();
  // the writes check still held but the read check below failed; and with
  // the role check removed the Viewer's delete landed.
  for (const [name, pick, extra] of actions) {
    it(`${name} writes nothing for a Viewer and the rows stay`, async () => {
      currentUser = MEMBER_ID;
      const before = JSON.stringify(data.assignments);
      const mod = await import("@/lib/actions/assignmentsBulk");
      const r = await run(() => pick(mod)(ORG_WITH_MODULES, formWith(BRIDGE_OPEN, extra)));
      expect(r.redirect).toContain("/unauthorized");
      expect(writes).toEqual([]);
      expect(JSON.stringify(data.assignments)).toBe(before);
    });
  }

  it("begin() checks the role before it parses the ids or opens a client", () => {
    const src = read("src/lib/actions/assignmentsBulk.ts");
    const begin = src.slice(src.indexOf("async function begin"), src.indexOf("type Started"));
    expect(begin.indexOf("requireRole(org.id, STAFF_ROLES)")).toBeGreaterThan(-1);
    expect(begin.indexOf("requireRole(")).toBeLessThan(begin.indexOf("parseBulkIds("));
    expect(begin.indexOf("requireRole(")).toBeLessThan(begin.indexOf("createClient()"));
  });

  it("every exported action starts with begin() and takes no other door", () => {
    const src = read("src/lib/actions/assignmentsBulk.ts");
    const exported = [...src.matchAll(/export async function (\w+)\(slug: string, formData: FormData\): Promise<void> \{\n\s+await requireNotViewing\(\);\n\s+const s = await begin\(slug, formData\);/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual(actions.map((a) => a[0]).sort());
    expect((src.match(/export async function/g) ?? []).length).toBe(actions.length);
    expect(src).not.toMatch(/createAdminClient/);
  });

  it("delete is Admin only: a staff-keyed policy in the migration, a role check in the action", () => {
    const sql = strip(read("migrations/0071_assignments_bulk_delete.sql"));
    expect(sql).toMatch(/create policy assignments_delete on assignments for delete\s+using \(org_id in \(select private\._staff_org_ids\(\)\)\)/);
    expect(sql).not.toMatch(/_member_org_ids|_family_athlete_ids|_any_org_ids/);
  });
});

// ── Scoped by org and ids ────────────────────────────────────────────

describe("LAW: another org's rows are never touched", () => {
  // Planted: dropped .eq("org_id", ...) from the read in begin(); the
  // Elite row was completed, and the filter-columns check failed.
  for (const [name, pick, extra] of actions) {
    it(`${name} leaves an Elite row alone and counts it as skipped`, async () => {
      const mod = await import("@/lib/actions/assignmentsBulk");
      const eliteBefore = JSON.stringify(row(IDS.assignmentElite));
      const r = await run(() => pick(mod)(ORG_WITH_MODULES, formWith([IDS.assignmentElite], extra)));
      expect(JSON.stringify(data.assignments.find((a) => a.id === IDS.assignmentElite))).toBe(eliteBefore);
      expect(writes.filter((w) => w.table === "assignments")).toEqual([]);
      expect(r.redirect).toContain("error=");
      expect(decoded(r)).toMatch(/0 \w+, 1 skipped/);
    });
  }

  it("every write names the org and the ids in its filters", async () => {
    const mod = await import("@/lib/actions/assignmentsBulk");
    for (const [, pick, extra] of actions) {
      writes.length = 0;
      data = buildFixture();
      await run(() => pick(mod)(ORG_WITH_MODULES, formWith([IDS.assignmentOverdue, IDS.assignmentDueSoon], extra)));
      const w = writes.filter((x) => x.table === "assignments");
      expect(w.length).toBe(1);
      expect(filterColumns(w[0])).toEqual(expect.arrayContaining(["id", "org_id"]));
    }
  });

  it("a malformed or empty id list is refused with nothing written", async () => {
    const { bulkDeleteAssignments } = await import("@/lib/actions/assignmentsBulk");
    const r = await run(() => bulkDeleteAssignments(ORG_WITH_MODULES, ids("not-an-id", "' or true --")));
    expect(decoded(r)).toContain("error=Nothing was selected.");
    expect(writes).toEqual([]);
  });
});

// ── Mark Complete ────────────────────────────────────────────────────

describe("bulkCompleteAssignments", () => {
  it("completes open, overdue, submitted and sent-back rows, skips finished ones, stamps the reviewer, and says so", async () => {
    const { bulkCompleteAssignments } = await import("@/lib/actions/assignmentsBulk");
    const r = await run(() => bulkCompleteAssignments(ORG_WITH_MODULES, ids(...BRIDGE_OPEN, IDS.assignmentComplete, IDS.assignmentCancelled)));
    expect(decoded(r)).toContain("notice=4 completed, 2 skipped.");
    for (const id of BRIDGE_OPEN) {
      expect(row(id)).toMatchObject({ status: "complete", reviewed_by: OWNER_ID });
      expect(row(id).reviewed_at).toBeTruthy();
    }
    expect(row(IDS.assignmentCancelled).status).toBe("cancelled");
    const ups = writesTo(writes, "assignments", "update");
    expect(ups).toHaveLength(1);
    expect(filterColumns(ups[0])).toEqual(expect.arrayContaining(["id", "org_id", "status"]));
  });
});

// ── Cancel ───────────────────────────────────────────────────────────

describe("bulkCancelAssignments", () => {
  it("cancels what is active and leaves complete work alone", async () => {
    const { bulkCancelAssignments } = await import("@/lib/actions/assignmentsBulk");
    const r = await run(() => bulkCancelAssignments(ORG_WITH_MODULES, ids(IDS.assignmentOverdue, IDS.assignmentSubmitted, IDS.assignmentComplete)));
    expect(decoded(r)).toContain("notice=2 cancelled, 1 skipped.");
    expect(row(IDS.assignmentOverdue).status).toBe("cancelled");
    expect(row(IDS.assignmentComplete).status).toBe("complete");
    expect(writesTo(writes, "assignments", "delete")).toEqual([]);
  });
});

// ── Reassign ─────────────────────────────────────────────────────────

describe("bulkReassignAssignments", () => {
  // Planted: dropped the document_id check from the eligible filter; the
  // submitted row with a file moved and this failed.
  it("moves open and sent-back rows to the athlete, skips the submitted and filed one", async () => {
    const { bulkReassignAssignments } = await import("@/lib/actions/assignmentsBulk");
    const r = await run(() => bulkReassignAssignments(ORG_WITH_MODULES, formWith(BRIDGE_OPEN, { athlete_id: IDS.athleteTransfer })));
    expect(decoded(r)).toContain("notice=3 moved, 1 skipped.");
    for (const id of [IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentRevision]) expect(row(id).athlete_id).toBe(IDS.athleteTransfer);
    expect(row(IDS.assignmentSubmitted).athlete_id).toBe(IDS.athlete);
    // Moving never changes the org or the status.
    expect(row(IDS.assignmentOverdue)).toMatchObject({ org_id: row(IDS.assignmentSubmitted).org_id, status: "assigned" });
  });

  it("an open row that carries a file stays put", async () => {
    const { bulkReassignAssignments } = await import("@/lib/actions/assignmentsBulk");
    row(IDS.assignmentRevision).document_id = IDS.documentFiled;
    const r = await run(() => bulkReassignAssignments(ORG_WITH_MODULES, formWith([IDS.assignmentRevision, IDS.assignmentDueSoon], { athlete_id: IDS.athleteTransfer })));
    expect(decoded(r)).toContain("notice=1 moved, 1 skipped.");
    expect(row(IDS.assignmentRevision).athlete_id).toBe(IDS.athlete);
  });

  it("refuses an athlete of another org or one that does not exist, with nothing written", async () => {
    const { bulkReassignAssignments } = await import("@/lib/actions/assignmentsBulk");
    for (const target of [IDS.athleteElite, "00000000-0000-0000-0000-00000000dead", ""]) {
      writes.length = 0;
      const r = await run(() => bulkReassignAssignments(ORG_WITH_MODULES, formWith([IDS.assignmentOverdue], { athlete_id: target })));
      expect(r.redirect).toContain("error=");
      expect(writesTo(writes, "assignments")).toEqual([]);
      expect(row(IDS.assignmentOverdue).athlete_id).toBe(IDS.athlete);
    }
  });

  it("a row already on that athlete is skipped, not rewritten", async () => {
    const { bulkReassignAssignments } = await import("@/lib/actions/assignmentsBulk");
    const r = await run(() => bulkReassignAssignments(ORG_WITH_MODULES, formWith([IDS.assignmentOverdue], { athlete_id: IDS.athlete })));
    expect(decoded(r)).toContain("0 moved, 1 skipped");
    expect(writesTo(writes, "assignments")).toEqual([]);
  });

  it("the log line sits on the new athlete and names both athletes, never the title", async () => {
    const { bulkReassignAssignments } = await import("@/lib/actions/assignmentsBulk");
    await run(() => bulkReassignAssignments(ORG_WITH_MODULES, formWith([IDS.assignmentOverdue], { athlete_id: IDS.athleteTransfer })));
    const log = writesTo(writes, "activity_log", "insert")[0]!.rows[0]!;
    expect(log).toMatchObject({ action: "assignment_reassigned", athlete_id: IDS.athleteTransfer, subject_id: IDS.assignmentOverdue });
    expect(String(log.summary)).not.toContain("Send Fall Transcript");
  });
});

// ── Change Due Date ──────────────────────────────────────────────────

describe("bulkChangeDueDate", () => {
  it("sets a date on active rows and skips finished ones", async () => {
    const { bulkChangeDueDate } = await import("@/lib/actions/assignmentsBulk");
    const r = await run(() => bulkChangeDueDate(ORG_WITH_MODULES, formWith([IDS.assignmentOverdue, IDS.assignmentComplete], { due_on: "2026-12-01" })));
    expect(decoded(r)).toContain("notice=1 updated, 1 skipped.");
    expect(row(IDS.assignmentOverdue).due_on).toBe("2026-12-01");
    expect(row(IDS.assignmentComplete).due_on).toBe("2026-08-30");
  });

  it("a blank date clears it, and says so in the log", async () => {
    const { bulkChangeDueDate } = await import("@/lib/actions/assignmentsBulk");
    await run(() => bulkChangeDueDate(ORG_WITH_MODULES, formWith([IDS.assignmentOverdue], { due_on: "" })));
    expect(row(IDS.assignmentOverdue).due_on).toBeNull();
    expect(String(writesTo(writes, "activity_log", "insert")[0]!.rows[0]!.summary)).toMatch(/^Cleared the due date/);
  });

  it("a date that is not a date is refused with nothing written", async () => {
    const { bulkChangeDueDate } = await import("@/lib/actions/assignmentsBulk");
    for (const bad of ["2026-02-31", "soon", "12/01/2026"]) {
      const r = await run(() => bulkChangeDueDate(ORG_WITH_MODULES, formWith([IDS.assignmentOverdue], { due_on: bad })));
      expect(r.redirect).toContain("error=");
    }
    expect(writes).toEqual([]);
  });
});

// ── Delete ───────────────────────────────────────────────────────────

describe("bulkDeleteAssignments", () => {
  it("deletes the rows in this org, any status, and not another org's", async () => {
    const { bulkDeleteAssignments } = await import("@/lib/actions/assignmentsBulk");
    const r = await run(() => bulkDeleteAssignments(ORG_WITH_MODULES, ids(IDS.assignmentOverdue, IDS.assignmentComplete, IDS.assignmentSubmitted, IDS.assignmentElite)));
    expect(decoded(r)).toContain("notice=3 deleted, 1 skipped.");
    expect(data.assignments.some((a) => a.id === IDS.assignmentOverdue || a.id === IDS.assignmentComplete || a.id === IDS.assignmentSubmitted)).toBe(false);
    expect(data.assignments.some((a) => a.id === IDS.assignmentElite)).toBe(true);
    const del = writesTo(writes, "assignments", "delete");
    expect(del).toHaveLength(1);
    expect(filterColumns(del[0])).toEqual(expect.arrayContaining(["id", "org_id"]));
  });
});

// ── The log ──────────────────────────────────────────────────────────

describe("LAW: one activity line per row changed, and never the title", () => {
  // Planted: logged once for the whole batch; the count check failed.
  // Planted: put the title in a summary; the title check failed.
  const titles = () => data.assignments.map((a) => String(a.title));
  for (const [name, pick, extra] of actions) {
    it(`${name} logs one line per row it changed`, async () => {
      const mod = await import("@/lib/actions/assignmentsBulk");
      const before = titles();
      const orgOf = row(IDS.assignmentOverdue).org_id;
      await run(() => pick(mod)(ORG_WITH_MODULES, formWith([IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentRevision], extra)));
      expect(writesTo(writes, "assignments")).toHaveLength(1);
      const logs = writesTo(writes, "activity_log", "insert");
      expect(logs).toHaveLength(3);
      expect(new Set(logs.map((l) => l.rows[0]!.subject_id))).toEqual(new Set([IDS.assignmentOverdue, IDS.assignmentDueSoon, IDS.assignmentRevision]));
      for (const l of logs) {
        expect(l.rows[0]).toMatchObject({ subject_type: "assignment", org_id: orgOf });
        for (const t of before) expect(String(l.rows[0]!.summary)).not.toContain(t);
      }
    });
  }

  it("a skipped row writes no line", async () => {
    const { bulkCompleteAssignments } = await import("@/lib/actions/assignmentsBulk");
    await run(() => bulkCompleteAssignments(ORG_WITH_MODULES, ids(IDS.assignmentComplete, IDS.assignmentCancelled, IDS.assignmentElite)));
    expect(writesTo(writes, "activity_log")).toEqual([]);
  });

  it("the new actions are in the closed list and have templates", async () => {
    const { ACTIVITY_ACTIONS, activitySummary } = await import("@/lib/data/activity");
    for (const a of ["assignment_deleted", "assignment_reassigned", "assignment_due_changed"] as const) expect(ACTIVITY_ACTIONS).toContain(a);
    expect(activitySummary("assignment_deleted", { name: "Fixture Athlete", kind: "transcript" })).toBe("Deleted the transcript assignment for Fixture Athlete");
    const sql = strip(read("migrations/0071_assignments_bulk_delete.sql"));
    for (const a of ["assignment_deleted", "assignment_reassigned", "assignment_due_changed"]) expect(sql).toContain(`add value if not exists '${a}'`);
  });
});

// ── The notice names the counts ──────────────────────────────────────

describe("LAW: the notice names the counts", () => {
  it("lands on the list with 'N done, M skipped', or just 'N done'", async () => {
    const { bulkCancelAssignments } = await import("@/lib/actions/assignmentsBulk");
    const a = await run(() => bulkCancelAssignments(ORG_WITH_MODULES, ids(IDS.assignmentOverdue, IDS.assignmentDueSoon)));
    expect(a.redirect).toBe(`/org/${ORG_WITH_MODULES}/assignments?notice=${encodeURIComponent("2 cancelled.")}`);
    const b = await run(() => bulkCancelAssignments(ORG_WITH_MODULES, ids(IDS.assignmentRevision, IDS.assignmentComplete)));
    expect(decoded(b)).toBe(`/org/${ORG_WITH_MODULES}/assignments?notice=1 cancelled, 1 skipped.`);
  });
});

// ── The screen ───────────────────────────────────────────────────────

describe("LAW: the Assignments list offers the bar, the sheet names the count, delete is red and says there is no undo", () => {
  const page = read("src/app/org/[slug]/assignments/page.tsx");
  it("wraps the sections in one BulkSelect over every id on screen, and every row is selectable", () => {
    expect(page).toContain('<BulkSelect ids={searched.map((r) => r.id)} noun="assignment" actions={actions}>');
    expect((page.match(/<AssignmentRows selectable /g) ?? []).length).toBe(4);
    expect(read("src/components/AssignmentRows.tsx")).toContain("<BulkCheck id={row.id} label={row.title} />");
  });
  it("offers Mark Complete, Reassign, Change Due Date, Cancel and Delete, in Title Case, with a count in each question", () => {
    for (const label of ["Mark Complete", "Reassign", "Change Due Date", "Cancel", "Delete"]) expect(page).toContain(`label="${label}"`);
    expect((page.match(/question="[^"]*\{n\}[^"]*"/g) ?? []).length).toBe(5);
  });
  it("only Delete is destructive, and its sheet says there is no undo", () => {
    expect((page.match(/destructive/g) ?? []).length).toBe(1);
    const del = page.slice(page.indexOf("bulkDeleteAssignments.bind"));
    expect(del).toContain("destructive");
    expect(del).toContain("There is no undo");
  });
  it("the athletes in Reassign are active ones of this org", () => {
    expect(page).toMatch(/from\("athletes"\)\.select\("id, name"\)\.eq\("org_id", org\.id\)\.is\("deleted_at", null\)/);
  });
  it("the athlete's own lists stay as they were (no selectable rows there)", () => {
    expect(read("src/app/org/[slug]/roster/[id]/assignments/page.tsx")).not.toContain("selectable");
  });
});

// ── The migration ────────────────────────────────────────────────────

describe("LAW: migration 0071 is structure only", () => {
  // Planted: added an insert statement and a uuid literal; both failed.
  const sql = strip(read("migrations/0071_assignments_bulk_delete.sql"));
  it("has no data statements and no id literals", () => {
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate|copy)\b/i);
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
  it("adds a staff-keyed delete policy and changes the honesty trigger only for open rows with no file", () => {
    expect(sql).toMatch(/create policy assignments_delete/);
    expect(sql).toMatch(/new\.athlete_id is distinct from old\.athlete_id\s+and \(old\.status not in \('assigned', 'needs_revision'\) or old\.document_id is not null or new\.document_id is not null\)/);
    expect(sql).toMatch(/new\.org_id is distinct from old\.org_id/);
  });
  it("has a down script, a ledger row, and the RLS suite section at the end of the file", () => {
    expect(read("scripts/down/0071_assignments_bulk_delete_down.sql")).toMatch(/drop policy if exists assignments_delete/);
    expect(read("migrations/APPLIED.md")).toMatch(/\| 0071_assignments_bulk_delete\.sql \| applied \|/);
    const suite = read("scripts/rls_test.sql");
    // Appended last when it was written; later sections (0073) follow it, so
    // it is held by its marker and its closing line, not by being the last.
    expect(suite).toContain("\\echo 'ALL 0071 ASSERTIONS PASSED'");
    expect(suite).toContain("-- ===== 0071: bulk delete and reassign =====");
    expect(read("scripts/run_rls_test.sh")).toContain("migrations/0071_assignments_bulk_delete.sql");
  });
});
