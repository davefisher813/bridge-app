// Doc AI piece 7: document approvers (migration 0067; docs/ROADMAP.md,
// "Approver roles for Pieces 7 and 8, names unassigned").
//
// Three areas (academic, eligibility, financial), each held by at most
// one Admin per org, set in Organization Settings. Nobody is named yet,
// and the mechanism must change nothing until somebody is:
//   - Nobody named: any Admin marks Ready with one tap, as before.
//   - Somebody named: only they mark that area's documents Ready; anyone
//     else sees who it is waiting on, and the server refuses them.
//   - Naming, changing or clearing an approver asks first, is logged and
//     offers Undo (Dave's standing authority rule, 2026-10-06).
//   - A demoted or removed approver's area clears, logged.
//   - The database's type-to-area map is the app's.
//
// Each law was planted and seen to fail before it was kept; the plant is
// named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { APPROVER_AREAS, AREA_CATEGORIES } from "@/lib/documents/approvers";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");
const REDIRECT = "NEXT_REDIRECT:";
const APPROVER = "00000000-0000-0000-0000-0000000000a7";

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
    throw new Error(REDIRECT + url);
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

const bridge = () => data.orgs.find((o) => o.slug === ORG_WITH_MODULES)!.id as string;

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  // A second Admin, who can be named an approver.
  data.users.push({ id: APPROVER, email: "approver@example.test", full_name: "Pat Approver", last_sign_in_at: "2026-09-01T12:00:00.000Z" });
  data.org_members.push({ id: "m-approver", user_id: APPROVER, org_id: bridge(), role: "owner" });
});

const P = <T>(v: T) => Promise.resolve(v);
const logs = (action?: string) => writes.filter((w) => w.table === "activity_log" && w.op === "insert").map((w) => w.rows[0] as Record<string, unknown>).filter((r) => !action || r.action === action);
const text = (html: string) => html.replace(/<[^>]+>/g, "");
const docWrites = () => writes.filter((w) => w.table === "documents" && w.op === "update");
const transcript = () => data.documents.find((d) => d.id === IDS.document)!;
const nameAcademic = (userId = APPROVER) => data.doc_approvers.push({ org_id: bridge(), area: "academic", user_id: userId, set_by: OWNER_ID });

async function run(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return m.slice(REDIRECT.length);
    throw e;
  }
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}

const documentPage = () => render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.document }), searchParams: P({}) });

// ── Nobody named changes nothing ─────────────────────────────────────
// Verified this law bites: made readyGate answer "waiting" for an area
// with nobody named, watched both tests (and the open-area one below)
// fail, reverted.
describe("LAW: with nobody named, Ready stays a single Admin tap", () => {
  it("the document screen offers Mark Ready as one plain submit", async () => {
    expect(transcript().category).toBe("transcript");
    expect(transcript().lifecycle).toBe("needs_review");
    const html = await documentPage();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Mark Ready<\/button>/);
    expect(text(html)).not.toMatch(/Waiting on/);
  });

  it("any Admin's tap moves it, and who did it is kept", async () => {
    const { moveDocument } = await import("@/lib/actions/documents");
    expect((await moveDocument(ORG_WITH_MODULES, IDS.document, "ready")).ok).toBe(true);
    expect(transcript().lifecycle).toBe("ready");
    expect(transcript().approved_by).toBe(OWNER_ID);
    expect(logs("document_ready")).toHaveLength(1);
  });
});

// ── Named: theirs alone ──────────────────────────────────────────────
// Verified this law bites: dropped the gate check from moveDocument,
// watched "refuses everyone else" fail; rendered Mark Ready whatever the
// gate said, watched "shows who it waits on" fail. Reverted both.
describe("LAW: a named approver alone marks their area's documents Ready", () => {
  it("everyone else sees who it is waiting on instead of the button", async () => {
    nameAcademic();
    const html = await documentPage();
    expect(text(html)).toMatch(/Waiting on Pat Approver to Approve/);
    expect(html).not.toMatch(/>Mark Ready</);
    currentUser = APPROVER;
    const theirs = await documentPage();
    expect(theirs).toMatch(/>Mark Ready</);
  });

  it("the server refuses everyone else and writes nothing", async () => {
    nameAcademic();
    const { moveDocument } = await import("@/lib/actions/documents");
    const r = await moveDocument(ORG_WITH_MODULES, IDS.document, "ready");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Waiting on Pat Approver/);
    expect(docWrites()).toEqual([]);
    expect(transcript().lifecycle).toBe("needs_review");
  });

  it("the approver's tap moves it and the screen says who approved", async () => {
    nameAcademic();
    currentUser = APPROVER;
    const { moveDocument } = await import("@/lib/actions/documents");
    expect((await moveDocument(ORG_WITH_MODULES, IDS.document, "ready")).ok).toBe(true);
    expect(transcript().approved_by).toBe(APPROVER);
    expect(text(await documentPage())).toMatch(/Approved by Pat Approver/);
  });

  it("another area stays open, and a demoted approver's leftover row blocks nothing", async () => {
    data.doc_approvers.push({ org_id: bridge(), area: "financial", user_id: APPROVER });
    const { moveDocument } = await import("@/lib/actions/documents");
    expect((await moveDocument(ORG_WITH_MODULES, IDS.document, "ready")).ok).toBe(true);

    data = buildFixture();
    data.users.push({ id: APPROVER, email: "approver@example.test", full_name: "Pat Approver" });
    data.org_members.push({ id: "m-approver", user_id: APPROVER, org_id: bridge(), role: "member" });
    nameAcademic();
    expect((await moveDocument(ORG_WITH_MODULES, IDS.document, "ready")).ok).toBe(true);
  });
});

// ── The setting ──────────────────────────────────────────────────────
// Verified this law bites: removed the logActivity call from
// setDocApprover, then separately dropped the undo parameters from its
// redirect, and watched "logs, and the redirect carries" fail each time;
// hid the settings screen's Undo form, watched "offers Undo" fail;
// removed the isEligibleAdvisor check, watched "refuses a Viewer" fail.
// Reverted each.
describe("LAW: naming an approver asks first, is logged and offers Undo", () => {
  it("Organization Settings lists each area with Nobody Yet, and no tap changes one", async () => {
    const html = await render("@/app/org/[slug]/settings/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) });
    const t = text(html);
    expect(t).toMatch(/Document Approvers/);
    for (const label of ["Academic Approver", "Eligibility Approver", "Financial Approver"]) expect(t).toContain(label);
    expect(t.match(/Nobody Yet/g)?.length).toBe(3);
    // The sheet posts only from its confirm step: nothing on the screen
    // submits an approver.
    expect(html).not.toMatch(/name="approverId"/);
    const src = readFileSync(join(SRC, "app/org/[slug]/settings/page.tsx"), "utf8");
    expect(src).toMatch(/confirm=\{`Make \{choice\} the \$\{AREA_LABEL\[area\]\}/);
  });

  it("logs, and the redirect carries who held it before", async () => {
    const { setDocApprover } = await import("@/lib/actions/docApprovers");
    const to = await run(() => setDocApprover(ORG_WITH_MODULES, "academic", form({ approverId: APPROVER })));
    expect(to).toMatch(/undo=none&area=academic$/);
    expect(data.doc_approvers).toEqual([expect.objectContaining({ org_id: bridge(), area: "academic", user_id: APPROVER })]);
    expect(logs("doc_approver_set")).toHaveLength(1);
    expect(logs("doc_approver_set")[0]).toMatchObject({ subject_type: "org", subject_id: bridge() });

    writes.length = 0;
    const back = await run(() => setDocApprover(ORG_WITH_MODULES, "academic", form({ approverId: "" })));
    expect(back).toMatch(new RegExp(`undo=${APPROVER}&area=academic$`));
    expect(data.doc_approvers).toEqual([]);
    expect(logs("doc_approver_cleared")).toHaveLength(1);
  });

  it("offers Undo back to whoever held it, and a made-up value offers nothing", async () => {
    const page = (q: Record<string, string>) => render("@/app/org/[slug]/settings/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P(q) });
    const html = await page({ notice: "Academic Approver Cleared.", undo: APPROVER, area: "academic" });
    expect(text(html)).toMatch(/Undo/);
    expect(html).toMatch(new RegExp(`name="approverId" value="${APPROVER}"|value="${APPROVER}"[^>]*name="approverId"`));
    expect(text(await page({ notice: "Academic Approver Set.", undo: "drop table", area: "academic" }))).not.toMatch(/Undo/);
    expect(text(await page({ notice: "Set.", undo: "none", area: "nonsense" }))).not.toMatch(/Undo/);
  });

  it("refuses a Viewer, refuses a non-Admin caller, and writes nothing", async () => {
    const { setDocApprover } = await import("@/lib/actions/docApprovers");
    const to = await run(() => setDocApprover(ORG_WITH_MODULES, "financial", form({ approverId: MEMBER_ID })));
    expect(decodeURIComponent(to!)).toMatch(/Only an Admin/);
    currentUser = MEMBER_ID;
    expect(await run(() => setDocApprover(ORG_WITH_MODULES, "financial", form({ approverId: OWNER_ID })))).toBe("/unauthorized");
    expect(writes).toEqual([]);
    expect(data.doc_approvers).toEqual([]);
  });
});

// ── Demotion and removal ─────────────────────────────────────────────
// Verified this law bites: made clearAuthorityOf read no areas (so
// nothing is cleared), watched both fail; emptied the approvals loop in
// logLosses, watched both fail on the log count. Reverted.
describe("LAW: an approver who loses Admin, or leaves, stops approving, on the record", () => {
  it("a demotion clears their area and logs it", async () => {
    nameAcademic();
    data.doc_approvers.push({ org_id: bridge(), area: "financial", user_id: APPROVER });
    const { changeMemberRole } = await import("@/lib/actions/members");
    expect((await changeMemberRole(ORG_WITH_MODULES, APPROVER, "member")).ok).toBe(true);
    expect(data.doc_approvers.filter((r) => r.user_id === APPROVER)).toEqual([]);
    expect(logs("doc_approver_cleared")).toHaveLength(2);
  });

  it("a removal clears their area and logs it", async () => {
    nameAcademic();
    const { removeMember } = await import("@/lib/actions/members");
    expect((await removeMember(ORG_WITH_MODULES, APPROVER)).ok).toBe(true);
    expect(data.doc_approvers).toEqual([]);
    expect(logs("doc_approver_cleared")).toHaveLength(1);
  });

  it("the member page's confirms say they stop approving", async () => {
    nameAcademic();
    const src = readFileSync(join(SRC, "app/org/[slug]/members/[userId]/page.tsx"), "utf8");
    expect(src).toMatch(/They stop being the/);
    expect((src.match(/approverLoss/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

// ── The database agrees ──────────────────────────────────────────────
// Verified this law bites: moved 'recommendation' to the eligibility
// line of private.doc_approval_area in 0067, watched it fail, reverted.
describe("LAW: the database's type-to-area map is the app's", () => {
  it("private.doc_approval_area names the same types for each area", () => {
    const sql = readFileSync(join(ROOT, "migrations/0067_doc_approvers.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function private.doc_approval_area"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    const map: Record<string, string[]> = {};
    for (const m of body.matchAll(/when p_category in \(([^)]*)\) then '(\w+)'/g)) map[m[2]!] = [...m[1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!).sort();
    expect(Object.keys(map).sort()).toEqual([...APPROVER_AREAS].sort());
    for (const area of APPROVER_AREAS) expect(map[area]).toEqual([...AREA_CATEGORIES[area]].sort());
  });
});
