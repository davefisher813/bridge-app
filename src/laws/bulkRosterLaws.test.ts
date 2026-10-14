// Bulk actions on the roster (Dave, 2026-10-13: multi-select with a bar,
// the count always visible, ONE confirmation naming the count, Undo only
// where the app already has it).
//
// Held to:
//   - every bulk action is an Admin's and refuses a Viewer before any
//     read or write; ids from another org are never found;
//   - Assign Advisor goes through the single-athlete code
//     (setAthleteAdvisor): a log row per athlete changed, none for one
//     already there, and ONE Undo puts every previous advisor back
//     (leaving alone anyone changed by hand since);
//   - Change Status offers Active and Inactive only; Committed, Enrolled,
//     Graduated and Drafted keep their own flows, and athletes in them
//     are skipped and counted; one log row per athlete;
//   - the CSV escapes formula cells, holds the athletes asked for in
//     this org and nobody else, and carries no contact data.
//
// Each law was planted and seen to fail before it was kept; the plant is
// named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { form, run, writesTo } from "@/testing/actionHarness";
import { csvCell, rosterCsv, ROSTER_CSV_HEADER, toCsv } from "@/lib/bulk/csv";
import { bulkStatusDecision, BULK_STATUSES } from "@/lib/bulk/rosterStatus";
import { decodeAdvisorUndo, encodeAdvisorUndo, planAdvisorRestore } from "@/lib/data/undoPlan";

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
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

const SECOND_ADMIN = "00000000-0000-0000-0000-0000000000d9";

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  data.users.push({ id: SECOND_ADMIN, email: "second@example.test", full_name: "Second Admin", last_sign_in_at: "2026-09-01T12:00:00.000Z" });
  data.org_members.push({ id: "m-second", user_id: SECOND_ADMIN, org_id: data.orgs[0]!.id, role: "owner" });
});

const P = <T>(v: T) => Promise.resolve(v);
const logs = (action?: string) => writesTo(writes, "activity_log", "insert").map((w) => w.rows[0] as Record<string, unknown>).filter((r) => !action || r.action === action);
const athlete = (id: string) => data.athletes.find((a) => a.id === id)!;
const idsForm = (ids: string[], extra: Record<string, string> = {}) => {
  const fd = form(extra);
  for (const id of ids) fd.append("ids", id);
  return fd;
};
const msg = (to: string | null) => decodeURIComponent((to ?? "").replace(/\+/g, " "));

// ── Pure pieces ──────────────────────────────────────────────────────
// Planted: dropped the formula prefix from csvCell; the "=" cell test failed; reverted.
describe("LAW: a CSV cell can never run as a formula", () => {
  it("prefixes = + - @ tab and carriage return, quotes everything, doubles quotes", () => {
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(bad)).toBe(`"'${bad}"`);
    expect(csvCell('He said "hi", twice')).toBe('"He said ""hi"", twice"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell("O'Brien")).toBe('"O\'Brien"');
  });
  it("the roster CSV has a fixed, contact-free header", () => {
    expect([...ROSTER_CSV_HEADER]).toEqual(["Name", "Sport", "Position", "Status", "Recruit Type", "Grad Year", "Advisor", "GPA"]);
    const csv = rosterCsv([{ name: "=cmd()", sport: "baseball", position: null, status: "Active", recruitType: "High School", gradYear: 2028, advisor: "Pat", gpa: 3.5 }]);
    expect(csv).toContain(`"'=cmd()"`);
    expect(csv).toContain('"3.50"');
    expect(toCsv(["A"], [["b"]])).toBe('﻿"A"\r\n"b"\r\n');
  });
});

// Planted: let Committed into BULK_STATUSES; the offered-statuses test failed; reverted.
describe("LAW: a bulk status change never bypasses a flow that needs facts", () => {
  it("offers only Active and Inactive", () => {
    expect([...BULK_STATUSES]).toEqual(["Active", "Inactive"]);
  });
  it("skips placed athletes, committed targets, no-ops and Transferring to Active", () => {
    for (const from of ["Committed", "Enrolled", "Graduated", "Drafted"]) expect(bulkStatusDecision(from, "Inactive", false)).toEqual({ change: false, reason: "placed" });
    expect(bulkStatusDecision("Active", "Inactive", true)).toEqual({ change: false, reason: "committed_target" });
    expect(bulkStatusDecision("Active", "Active", false)).toEqual({ change: false, reason: "already" });
    expect(bulkStatusDecision("Transferring", "Active", false)).toEqual({ change: false, reason: "transferring" });
    expect(bulkStatusDecision("Transferring", "Inactive", false)).toEqual({ change: true });
    expect(bulkStatusDecision("Inactive", "Active", false)).toEqual({ change: true });
  });
});

describe("the batch Undo", () => {
  const A = "00000000-0000-0000-0000-0000000000c1";
  const B = "00000000-0000-0000-0000-0000000000c2";
  const C = "00000000-0000-0000-0000-0000000000c3";
  const undo = { assigned: SECOND_ADMIN, entries: [{ athleteId: A, before: OWNER_ID }, { athleteId: B, before: OWNER_ID }, { athleteId: C, before: null }] };
  it("round-trips through the query string and refuses anything else", () => {
    expect(decodeAdvisorUndo(encodeAdvisorUndo(undo))).toEqual(undo);
    expect(decodeAdvisorUndo(encodeAdvisorUndo({ assigned: null, entries: [{ athleteId: A, before: OWNER_ID }] }))).toEqual({ assigned: null, entries: [{ athleteId: A, before: OWNER_ID }] });
    for (const junk of ["drop table", "", "none~", "none~x:y", "none~none:nothex", undefined, 5]) expect(decodeAdvisorUndo(junk)).toBeNull();
  });
  it("restores only athletes whose advisor is still what the bulk action set", () => {
    const plan = planAdvisorRestore(undo, new Map<string, string | null>([[A, SECOND_ADMIN], [B, MEMBER_ID], [C, SECOND_ADMIN]]));
    expect(plan.kept).toEqual([B]);
    expect(plan.groups).toEqual([{ advisorId: OWNER_ID, athleteIds: [A] }, { advisorId: null, athleteIds: [C] }]);
  });
});

// ── Assign Advisor ───────────────────────────────────────────────────
// Planted: removed requireRole from admin(); the Viewer test failed; reverted.
describe("LAW: bulk Assign Advisor is an Admin's, scoped to this org, logged per athlete", () => {
  it("refuses a Viewer before any write", async () => {
    currentUser = MEMBER_ID;
    const { bulkAssignAdvisor } = await import("@/lib/actions/athletesBulk");
    const r = await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([IDS.athlete], { advisorId: SECOND_ADMIN })));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("refuses a target who is not an Admin and writes nothing", async () => {
    const { bulkAssignAdvisor } = await import("@/lib/actions/athletesBulk");
    const r = await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([IDS.athlete], { advisorId: MEMBER_ID })));
    expect(msg(r.redirect)).toMatch(/Only an Admin/);
    expect(writes).toEqual([]);
    expect(athlete(IDS.athlete).advisor_id).toBe(OWNER_ID);
  });

  it("changes the selected, logs one row each, skips the ones already there, and never touches another org", async () => {
    const { bulkAssignAdvisor } = await import("@/lib/actions/athletesBulk");
    const eliteBefore = athlete(IDS.athleteElite).advisor_id;
    // athlete and athleteNoGpa are advised by the owner, athleteTransfer by nobody.
    expect(athlete(IDS.athleteTransfer).advisor_id ?? null).toBeNull();
    const r = await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([IDS.athlete, IDS.athleteNoGpa, IDS.athleteTransfer, IDS.athleteElite], { advisorId: OWNER_ID })));
    // Owner already advises two; the third is changed; Elite's is not found here.
    expect(msg(r.redirect)).toMatch(/1 athlete now have this advisor\. 3 athletes skipped: 2 already had them, 1 not on this roster\./);
    expect(athlete(IDS.athleteTransfer).advisor_id).toBe(OWNER_ID);
    expect(athlete(IDS.athleteElite).advisor_id).toBe(eliteBefore);
    expect(logs("advisor_set").map((l) => l.subject_id)).toEqual([IDS.athleteTransfer]);
    const updates = writesTo(writes, "athletes", "update");
    expect(updates.every((u) => u.filters.some((f) => f.column === "org_id"))).toBe(true);
  });

  it("one row per athlete, advisor_set for many and advisor_cleared for Unassigned", async () => {
    const { bulkAssignAdvisor } = await import("@/lib/actions/athletesBulk");
    await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([IDS.athlete, IDS.athleteNoGpa, IDS.athleteTransfer], { advisorId: SECOND_ADMIN })));
    expect(logs("advisor_set")).toHaveLength(3);
    expect(new Set(logs("advisor_set").map((l) => l.athlete_id))).toEqual(new Set([IDS.athlete, IDS.athleteNoGpa, IDS.athleteTransfer]));
    writes = [];
    const r = await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([IDS.athlete, IDS.athleteNoGpa], { advisorId: "" })));
    expect(msg(r.redirect)).toMatch(/2 athletes now have no advisor/);
    expect(logs("advisor_cleared")).toHaveLength(2);
    expect(athlete(IDS.athlete).advisor_id).toBeNull();
  });

  it("a missing advisor field is an error, not an Unassign", async () => {
    const { bulkAssignAdvisor } = await import("@/lib/actions/athletesBulk");
    const r = await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([IDS.athlete])));
    expect(msg(r.redirect)).toMatch(/Pick an advisor/);
    expect(writes).toEqual([]);
  });

  it("nothing selected is an error", async () => {
    const { bulkAssignAdvisor } = await import("@/lib/actions/athletesBulk");
    const r = await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([], { advisorId: OWNER_ID })));
    expect(msg(r.redirect)).toMatch(/Nothing was selected/);
    expect(writes).toEqual([]);
  });
});

// Planted: made undoBulkAdvisor restore only the first group; the
// "restores every previous advisor" test failed; reverted.
describe("LAW: one Undo restores every athlete's previous advisor", () => {
  it("assign, then Undo, puts back the owner on two and nobody on one, with a row each", async () => {
    const { bulkAssignAdvisor, undoBulkAdvisor } = await import("@/lib/actions/athletesBulk");
    const r = await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([IDS.athlete, IDS.athleteNoGpa, IDS.athleteTransfer], { advisorId: SECOND_ADMIN })));
    const token = new URL(r.redirect!, "http://x").searchParams.get("undo");
    expect(token).toBeTruthy();
    expect(athlete(IDS.athlete).advisor_id).toBe(SECOND_ADMIN);
    writes = [];

    const u = await run(() => undoBulkAdvisor(ORG_WITH_MODULES, form({ undo: token! })));
    expect(msg(u.redirect)).toMatch(/Advisors restored for 3 athletes\./);
    expect(u.redirect).not.toMatch(/undo=/);
    expect(athlete(IDS.athlete).advisor_id).toBe(OWNER_ID);
    expect(athlete(IDS.athleteNoGpa).advisor_id).toBe(OWNER_ID);
    expect(athlete(IDS.athleteTransfer).advisor_id ?? null).toBeNull();
    expect(logs("advisor_set")).toHaveLength(2);
    expect(logs("advisor_cleared")).toHaveLength(1);
  });

  it("leaves alone an athlete whose advisor was changed by hand since", async () => {
    const { bulkAssignAdvisor, undoBulkAdvisor } = await import("@/lib/actions/athletesBulk");
    const r = await run(() => bulkAssignAdvisor(ORG_WITH_MODULES, idsForm([IDS.athlete, IDS.athleteTransfer], { advisorId: SECOND_ADMIN })));
    const token = new URL(r.redirect!, "http://x").searchParams.get("undo")!;
    athlete(IDS.athlete).advisor_id = null;
    const u = await run(() => undoBulkAdvisor(ORG_WITH_MODULES, form({ undo: token })));
    expect(msg(u.redirect)).toMatch(/Advisors restored for 1 athlete\. 1 athlete left as they are/);
    expect(athlete(IDS.athlete).advisor_id).toBeNull();
  });

  it("refuses a Viewer and a made-up token", async () => {
    const { undoBulkAdvisor } = await import("@/lib/actions/athletesBulk");
    const bad = await run(() => undoBulkAdvisor(ORG_WITH_MODULES, form({ undo: "drop table" })));
    expect(msg(bad.redirect)).toMatch(/not valid/);
    currentUser = MEMBER_ID;
    const v = await run(() => undoBulkAdvisor(ORG_WITH_MODULES, form({ undo: encodeAdvisorUndo({ assigned: null, entries: [{ athleteId: IDS.athlete, before: OWNER_ID }] }) })));
    expect(v.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("the roster page offers Undo for a real token and nothing for junk", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = (await import("@/app/org/[slug]/roster/page")) as { default: (p: Record<string, unknown>) => Promise<unknown> };
    const token = encodeAdvisorUndo({ assigned: SECOND_ADMIN, entries: [{ athleteId: IDS.athlete, before: OWNER_ID }] });
    const html = renderToStaticMarkup((await mod.default({ params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ notice: "Done.", undo: token }) })) as never);
    expect(html.replace(/<[^>]+>/g, "")).toMatch(/Undo/);
    expect(html).toContain(`value="${token}"`);
    const junk = renderToStaticMarkup((await mod.default({ params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ notice: "Done.", undo: "drop table" }) })) as never);
    expect(junk.replace(/<[^>]+>/g, "")).not.toMatch(/Undo/);
  });
});

// ── Change Status ────────────────────────────────────────────────────
// Planted: let status "Enrolled" through isBulkStatus; the refusal test failed; reverted.
describe("LAW: bulk Change Status sets Active or Inactive and skips what has its own flow", () => {
  it("refuses Committed, Enrolled, Graduated, Drafted and Transferring as a target, writing nothing", async () => {
    const { bulkChangeStatus } = await import("@/lib/actions/athletesBulk");
    for (const status of ["Committed", "Enrolled", "Graduated", "Drafted", "Transferring", "", "Banana"]) {
      const r = await run(() => bulkChangeStatus(ORG_WITH_MODULES, idsForm([IDS.athlete], { status })));
      expect(msg(r.redirect)).toMatch(/Only Active and Inactive/);
    }
    expect(writes).toEqual([]);
    expect(athlete(IDS.athlete).status).toBe("Active");
  });

  it("refuses a Viewer before any write", async () => {
    currentUser = MEMBER_ID;
    const { bulkChangeStatus } = await import("@/lib/actions/athletesBulk");
    const r = await run(() => bulkChangeStatus(ORG_WITH_MODULES, idsForm([IDS.athlete], { status: "Inactive" })));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("changes the changeable, skips the placed, the other org and the no-ops, one log row each", async () => {
    const { bulkChangeStatus } = await import("@/lib/actions/athletesBulk");
    const ids = [IDS.athlete, IDS.athleteNoGpa, IDS.athleteCommitted, IDS.athleteEnrolled, IDS.athleteGraduated, IDS.athleteDrafted, IDS.athleteTransferring, IDS.athleteElite];
    const before = Object.fromEntries(ids.map((id) => [id, athlete(id).status]));
    const r = await run(() => bulkChangeStatus(ORG_WITH_MODULES, idsForm(ids, { status: "Inactive" })));
    expect(athlete(IDS.athlete).status).toBe("Inactive");
    expect(athlete(IDS.athleteNoGpa).status).toBe("Inactive");
    expect(athlete(IDS.athleteTransferring).status).toBe("Inactive");
    for (const id of [IDS.athleteCommitted, IDS.athleteEnrolled, IDS.athleteGraduated, IDS.athleteDrafted, IDS.athleteElite]) expect(athlete(id).status).toBe(before[id]);
    expect(msg(r.redirect)).toMatch(/3 athletes set to Inactive\. 5 athletes skipped: 4 placed/);
    expect(msg(r.redirect)).toMatch(/1 not on this roster/);
    const rows = logs("athlete_status_changed");
    expect(rows.map((l) => l.subject_id).sort()).toEqual([IDS.athlete, IDS.athleteNoGpa, IDS.athleteTransferring].sort());
    expect(rows[0]!.summary).toMatch(/Inactive/);
    expect(writesTo(writes, "athletes", "update").every((u) => u.filters.some((f) => f.column === "org_id"))).toBe(true);
  });

  it("an Active athlete with a committed target is skipped, and Transferring does not become Active", async () => {
    const { bulkChangeStatus } = await import("@/lib/actions/athletesBulk");
    data.recruiting_targets.push({ id: "t-x", org_id: data.orgs[0]!.id, athlete_id: IDS.athleteNoGpa, school_id: IDS.school, status: "Committed" });
    const r = await run(() => bulkChangeStatus(ORG_WITH_MODULES, idsForm([IDS.athleteNoGpa, IDS.athleteTransferring], { status: "Active" })));
    expect(athlete(IDS.athleteNoGpa).status).toBe("Active");
    expect(athlete(IDS.athleteTransferring).status).toBe("Transferring");
    expect(msg(r.redirect)).toMatch(/0 athletes set to Active\. 2 athletes skipped/);
    expect(logs()).toHaveLength(0);
  });
});

// ── Export ───────────────────────────────────────────────────────────
// Planted: dropped the org_id filter from the export query; the other-org test failed; reverted.
describe("LAW: the roster export is Admin-only, org-scoped, escaped and contact-free", () => {
  const get = async (ids: string[], user: string | null = OWNER_ID) => {
    currentUser = user;
    const { GET } = await import("@/app/org/[slug]/roster/export/route");
    return GET(new NextRequest(`http://localhost/org/${ORG_WITH_MODULES}/roster/export?ids=${ids.join(",")}`), { params: P({ slug: ORG_WITH_MODULES }) });
  };

  it("answers a Viewer, an outsider and a signed-out caller with 404", async () => {
    expect((await get([IDS.athlete], MEMBER_ID)).status).toBe(404);
    expect((await get([IDS.athlete], null)).status).toBe(404);
  });

  it("exports the selected athletes of this org, not another org's, with the advisor's name", async () => {
    const res = await get([IDS.athlete, IDS.athleteElite]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="athletes-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const text = await res.text();
    const lines = text.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe(ROSTER_CSV_HEADER.map((h) => `"${h}"`).join(","));
    expect(lines).toHaveLength(2);
    expect(text).toContain(athlete(IDS.athlete).name);
    expect(text).toContain("Example Owner");
    expect(text).not.toContain(athlete(IDS.athleteElite).name);
    expect(text).not.toMatch(/@example\.test/);
  });

  it("neutralises a formula in a name", async () => {
    athlete(IDS.athlete).name = "=HYPERLINK(\"http://evil\")";
    const text = await (await get([IDS.athlete])).text();
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).not.toMatch(/(^|,)"=/m);
  });

  it("refuses nothing selected and more than 200", async () => {
    expect((await get([])).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    expect((await get(many)).status).toBe(400);
  });

  it("the Export action sends an Admin to the route with the ids and a Viewer to Unauthorized", async () => {
    const { bulkExportAthletes } = await import("@/lib/actions/athletesBulk");
    const r = await run(() => bulkExportAthletes(ORG_WITH_MODULES, idsForm([IDS.athlete, IDS.athleteNoGpa])));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/export?ids=${IDS.athlete},${IDS.athleteNoGpa}`);
    currentUser = MEMBER_ID;
    const v = await run(() => bulkExportAthletes(ORG_WITH_MODULES, idsForm([IDS.athlete])));
    expect(v.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });
});

// ── The shape of the code ────────────────────────────────────────────
// Planted: moved a createClient() above the admin() call in
// bulkChangeStatus; the order test failed; reverted.
describe("LAW: every bulk action checks the role first and parses its ids", () => {
  const src = readFileSync("src/lib/actions/athletesBulk.ts", "utf8");
  const bodies = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}\n/g)].map((m) => ({ name: m[1]!, body: m[2]! }));

  it("finds the four actions", () => {
    expect(bodies.map((b) => b.name).sort()).toEqual(["bulkAssignAdvisor", "bulkChangeStatus", "bulkExportAthletes", "undoBulkAdvisor"]);
  });
  it("admin() (requireRole) comes before any client or write", () => {
    for (const b of bodies) {
      expect(b.body.indexOf("await admin(")).toBeGreaterThanOrEqual(0);
      const first = b.body.search(/createClient\(|\.from\(|logActivity\(/);
      if (first >= 0) expect(b.body.indexOf("await admin(")).toBeLessThan(first);
    }
    expect(src).toMatch(/requireRole\(org\.id, STAFF_ROLES\)/);
  });
  it("selection actions parse ids with parseBulkIds", () => {
    for (const b of bodies.filter((x) => x.name !== "undoBulkAdvisor")) expect(b.body).toMatch(/parseBulkIds\(formData\)/);
  });
  it("every athlete read or write is scoped by org_id", () => {
    for (const m of src.matchAll(/from\("athletes"\)[^;]*;/g)) expect(m[0]).toMatch(/\.eq\("org_id", org\.id\)/);
  });
  it("assigning goes through setAthleteAdvisor, the single-athlete path, not its own update", () => {
    expect(src).toMatch(/setAthleteAdvisor\(/);
    expect(src).not.toMatch(/\.update\(\{[^}]*advisor_id/);
  });
});

describe("LAW: the roster page wraps its list in one BulkSelect with a checkbox per row", () => {
  const page = readFileSync("src/app/org/[slug]/roster/page.tsx", "utf8");
  it("uses the kit's BulkSelect, BulkCheck and BulkAction for the three actions", () => {
    expect(page).toMatch(/<BulkSelect\s+ids=\{rows\.map/);
    expect(page).toMatch(/noun="athlete"/);
    expect(page).toMatch(/<BulkCheck\s+id=\{a\.id\}/);
    for (const label of ["Assign Advisor", "Change Status", "Export CSV"]) expect(page).toContain(`label="${label}"`);
  });
  it("renders a Select button for an Admin and no checkbox until they tap it", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = (await import("@/app/org/[slug]/roster/page")) as { default: (p: Record<string, unknown>) => Promise<unknown> };
    const html = renderToStaticMarkup((await mod.default({ params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) })) as never);
    expect(html.replace(/<[^>]+>/g, "")).toMatch(/Select/);
    expect(html).not.toContain('type="checkbox"');
  });
});

