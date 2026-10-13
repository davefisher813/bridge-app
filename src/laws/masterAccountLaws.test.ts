// The master account, and recommendation letters kept from Athlete
// logins (migration 0070; Dave, 2026-10-13: "Keep advisors as Admins,
// and make me the master account to control everyone's access levels").
//
//   - While a master is named, only they invite, change a role, remove
//     someone or resend an invite. Any other Admin is refused, before
//     any write, with a sentence naming the master.
//   - Nobody named: any Admin does, as before.
//   - The master is never demoted or removed, in the app or the database,
//     until they hand it on. Handing it on is logged, one row.
//   - The screens hide the access controls from a non-master Admin and
//     say who sets access.
//   - family_documents never returns a recommendation, and the Athlete
//     login's screens never list or offer one.
//
// Each law was planted and seen to fail before it was kept; the plant is
// named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { buildFixture, FAMILY_ID, IDS, MEMBER_ID, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { FAMILY_SEND_TYPES } from "@/lib/data/familySend";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const REDIRECT = "NEXT_REDIRECT:";
const SECOND = "00000000-0000-0000-0000-0000000000a8";

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

const bridge = () => data.orgs.find((o) => o.slug === ORG_WITH_MODULES)!;
const P = <T>(v: T) => Promise.resolve(v);
const text = (html: string) => html.replace(/<[^>]+>/g, "");
const logs = (action?: string) => writes.filter((w) => w.table === "activity_log" && w.op === "insert").map((w) => w.rows[0] as Record<string, unknown>).filter((r) => !action || r.action === action);
const REFUSAL = "Only Example Owner, the master account, changes who has access.";

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  // A second Admin in the org whose master is the owner.
  data.users.push({ id: SECOND, email: "second@example.test", full_name: "Sam Second", last_sign_in_at: "2026-09-01T12:00:00.000Z" });
  data.org_members.push({ id: "m-second", user_id: SECOND, org_id: bridge().id, role: "owner" });
});

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; value: unknown }> {
  try {
    return { redirect: null, value: await fn() };
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return { redirect: decodeURIComponent(m.slice(REDIRECT.length)), value: null };
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

const memberWrites = () => writes.filter((w) => ["org_members", "athlete_guardians", "athletes", "orgs"].includes(w.table) || w.table === "activity_log");

// ── A non-master Admin is refused, before any write ──────────────────
// Verified this law bites: made managesAccess answer true for anyone;
// all four refusals failed. Reverted.
describe("LAW: while a master is named, no other Admin changes access", () => {
  it("invite, role, remove and resend are each refused with the master's name and write nothing", async () => {
    currentUser = SECOND;
    const m = await import("@/lib/actions/members");
    const invite = await m.inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "new@example.test", role: "member" }));
    expect(invite.errors.form).toBe(REFUSAL);
    expect(await m.changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "owner")).toEqual({ ok: false, error: REFUSAL });
    expect(await m.removeMember(ORG_WITH_MODULES, MEMBER_ID)).toEqual({ ok: false, error: REFUSAL });
    expect(await m.resendInvite(ORG_WITH_MODULES, MEMBER_ID)).toEqual({ ok: false, error: REFUSAL });
    expect(memberWrites()).toEqual([]);
  });

  it("the master is allowed", async () => {
    const m = await import("@/lib/actions/members");
    expect((await m.changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "owner")).ok).toBe(true);
    expect(data.org_members.find((r) => r.user_id === MEMBER_ID && r.org_id === bridge().id)!.role).toBe("owner");
    expect(logs("member_role_changed")).toHaveLength(1);
  });

  it("a non-master Admin may still leave on their own", async () => {
    currentUser = SECOND;
    const { removeMember } = await import("@/lib/actions/members");
    expect((await removeMember(ORG_WITH_MODULES, SECOND)).ok).toBe(true);
  });

  // Verified this law bites: made managesAccess refuse when no master is
  // named; the Elite Admin was refused. Reverted.
  it("with nobody named, any Admin changes access as before", async () => {
    const elite = data.orgs.find((o) => o.slug === ORG_WITHOUT_MODULES)!;
    expect(elite.master_user_id).toBeNull();
    const { changeMemberRole } = await import("@/lib/actions/members");
    expect((await changeMemberRole(ORG_WITHOUT_MODULES, MEMBER_ID, "owner")).ok).toBe(true);
  });
});

// ── The master stays until handed on ─────────────────────────────────
// Verified this law bites: removed the MASTER_PROTECTED checks; the
// demotion and the removal went through. Reverted.
describe("LAW: the master account cannot be demoted or removed", () => {
  it("in the app", async () => {
    const m = await import("@/lib/actions/members");
    expect((await m.changeMemberRole(ORG_WITH_MODULES, OWNER_ID, "member")).error).toMatch(/master account cannot be demoted or removed/);
    expect((await m.removeMember(ORG_WITH_MODULES, OWNER_ID)).error).toMatch(/master account cannot be demoted or removed/);
    expect(memberWrites()).toEqual([]);
  });

  it("in the database, which also holds the master to an Admin of that org", () => {
    const sql = readFileSync(join(ROOT, "migrations/0070_org_master_account.sql"), "utf8");
    expect(sql).toMatch(/add column if not exists master_user_id uuid references users\(id\) on delete set null/);
    expect(sql).toMatch(/before update or delete on org_members/);
    expect(sql).toMatch(/before insert or update of master_user_id on orgs/);
    expect(sql).toMatch(/the master account cannot be demoted or removed; transfer it first/);
    expect((sql.match(/errcode = 'check_violation'/g) ?? []).length).toBe(2);
    const rls = readFileSync(join(ROOT, "scripts/rls_test.sql"), "utf8");
    expect(rls).toMatch(/FAIL: the master account was demoted/);
    expect(rls).toMatch(/FAIL: the master account was removed/);
    expect(rls).toMatch(/FAIL: a Viewer became the master account/);
  });
});

// ── Handing it on ────────────────────────────────────────────────────
// Verified this law bites: logged the transfer as another action; no
// master_transferred row. Reverted.
describe("LAW: transferring the master account is the master's, to an Admin, and logged once", () => {
  it("the master hands it to another Admin; one master_transferred row", async () => {
    const { transferMasterAccount } = await import("@/lib/actions/members");
    expect(await transferMasterAccount(ORG_WITH_MODULES, MEMBER_ID)).toMatchObject({ ok: false });
    expect(await transferMasterAccount(ORG_WITH_MODULES, SECOND)).toEqual({ ok: true });
    expect(bridge().master_user_id).toBe(SECOND);
    expect(logs("master_transferred")).toHaveLength(1);
    expect(logs("master_transferred")[0]).toMatchObject({ subject_type: "org", subject_id: bridge().id, actor_id: OWNER_ID, summary: "Made Sam Second the master account" });
  });

  it("nobody else may hand it on; with nobody named, an Admin takes it for themselves only", async () => {
    currentUser = SECOND;
    const { transferMasterAccount } = await import("@/lib/actions/members");
    expect((await transferMasterAccount(ORG_WITH_MODULES, SECOND)).ok).toBe(false);
    bridge().master_user_id = null;
    expect((await transferMasterAccount(ORG_WITH_MODULES, OWNER_ID)).ok).toBe(false);
    expect(await transferMasterAccount(ORG_WITH_MODULES, SECOND)).toEqual({ ok: true });
    expect(logs("master_transferred")).toHaveLength(1);
  });
});

// ── The screens ──────────────────────────────────────────────────────
// Verified this law bites: made managesAccess answer true for anyone;
// every screen check failed. Reverted.
describe("LAW: the members screens hide the access controls from a non-master Admin", () => {
  it("the list has no Invite or Resend, and says who sets access", async () => {
    currentUser = SECOND;
    const html = await render("@/app/org/[slug]/members/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) });
    expect(text(html)).toContain("Access Levels Are Set by Example Owner");
    expect(text(html)).not.toMatch(/Invite Someone|Resend/);
    currentUser = OWNER_ID;
    const mine = await render("@/app/org/[slug]/members/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) });
    expect(text(mine)).toMatch(/Invite Someone/);
    expect(text(mine)).toMatch(/Resend/);
    expect(text(mine)).toMatch(/Master Account · Head of Recruiting · Admin/);
  });

  it("a member's page has no role change or Remove for a non-master, and the master's own page offers neither", async () => {
    currentUser = SECOND;
    const theirs = await render("@/app/org/[slug]/members/[userId]/page", { params: P({ slug: ORG_WITH_MODULES, userId: MEMBER_ID }), searchParams: P({}) });
    expect(text(theirs)).toContain("Access Levels Are Set by Example Owner");
    expect(text(theirs)).not.toMatch(/Make Them|Remove From|Switch to/);
    currentUser = OWNER_ID;
    const master = await render("@/app/org/[slug]/members/[userId]/page", { params: P({ slug: ORG_WITH_MODULES, userId: OWNER_ID }), searchParams: P({}) });
    expect(text(master)).toContain("Master Account");
    expect(text(master)).not.toMatch(/Make Them|Remove From|Switch to/);
  });

  it("the invite screen refuses a non-master, and settings names the master and offers the master a transfer", async () => {
    currentUser = SECOND;
    const invite = await render("@/app/org/[slug]/members/new/page", { params: P({ slug: ORG_WITH_MODULES }) });
    expect(text(invite)).toContain("Access Levels Are Set by Example Owner");
    expect(invite).not.toMatch(/name="email"/);
    const settings = await render("@/app/org/[slug]/settings/page", { params: P({ slug: ORG_WITH_MODULES }) });
    expect(text(settings)).toContain("Example Owner");
    expect(text(settings)).not.toMatch(/Transfer|Make Me the Master/);
    currentUser = OWNER_ID;
    expect(text(await render("@/app/org/[slug]/settings/page", { params: P({ slug: ORG_WITH_MODULES }) }))).toMatch(/Transfer/);
    const elite = await render("@/app/org/[slug]/settings/page", { params: P({ slug: ORG_WITHOUT_MODULES }) });
    expect(text(elite)).toMatch(/Nobody Set/);
    expect(text(elite)).toMatch(/Make Me the Master Account/);
  });
});

// ── Recommendation letters ───────────────────────────────────────────
// Verified this law bites: removed the recommendation filter from the
// fake; the function and family page checks failed. Reverted. The real
// function is held by scripts/rls_test.sql (0070 section).
describe("LAW: an Athlete login never sees a recommendation letter", () => {
  const plantLetter = () => {
    const base = data.documents.find((d) => d.athlete_id === IDS.athlete && d.org_id === bridge().id)!;
    data.documents.push({ ...base, id: "doc-letter", file_name: "coach-letter-secret.pdf", title: "Coach Letter Secret", category: "recommendation", requested_category: null });
    data.documents.push({ ...base, id: "doc-asked", file_name: "asked-letter-secret.pdf", title: "Asked Letter Secret", category: null, requested_category: "recommendation" });
  };

  it("family_documents returns none, by either category", async () => {
    plantLetter();
    currentUser = FAMILY_ID;
    const client = createFakeClient(data, { userId: FAMILY_ID, recorded: writes });
    const { data: rows } = await client.rpc("family_documents", { p_org: bridge().id, p_athlete: IDS.athlete });
    const list = (rows ?? []) as { id: string; category: string | null }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((r) => r.id)).not.toContain("doc-letter");
    expect(list.map((r) => r.id)).not.toContain("doc-asked");
  });

  it("the SQL function excludes it, signed in only", () => {
    const sql = readFileSync(join(ROOT, "migrations/0070_org_master_account.sql"), "utf8");
    const fn = sql.match(/create or replace function public\.family_documents\([\s\S]*?\$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/coalesce\(d\.category::text, d\.requested_category::text, ''\) <> 'recommendation'/);
    expect(fn).toMatch(/security definer/);
    expect(sql).toMatch(/revoke all on function public\.family_documents\(uuid, uuid\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.family_documents\(uuid, uuid\) to authenticated;/);
  });

  it("the family page never lists one, and the send screen never offers one", async () => {
    plantLetter();
    currentUser = FAMILY_ID;
    const home = await render("@/app/org/[slug]/family/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(home).not.toMatch(/Letter Secret|letter-secret/);
    expect(FAMILY_SEND_TYPES.map((t) => t.id)).not.toContain("recommendation");
    const send = await render("@/app/org/[slug]/family/[id]/documents/new/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(send).not.toMatch(/value="recommendation"/);
  });
});
