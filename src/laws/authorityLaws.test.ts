// Every authority decision is a setting an Admin can see, change and
// undo in the app, and none happens silently (Dave's standing rule,
// 2026-10-06, enforced again 2026-10-10: "who advises which athlete,
// approver lists, and every other assignment or authority call ... No
// silent assignments, no hardcoded names, no one-click changes without
// confirmation.").
//
// What that means in code, and what these laws hold:
//   - A tap never changes an advisor, a steward, a role or a seat link:
//     each goes through a confirm step first.
//   - Every such change writes an activity_log row, including the side
//     effects of a role change or a removal (each athlete who loses an
//     advisor gets its own row).
//   - An advisor or steward change offers Undo back to whoever it was.
//   - A donor's steward, which the database has always had, is shown
//     and set on the donor page.
//   - No person's name, email or id is written into the app's code.
//
// Each law was planted and seen to fail before it was kept; the plant
// is named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");
const REDIRECT = "NEXT_REDIRECT:";

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

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
});

const P = <T>(v: T) => Promise.resolve(v);
const logs = (action?: string) => writes.filter((w) => w.table === "activity_log" && w.op === "insert").map((w) => w.rows[0] as Record<string, unknown>).filter((r) => !action || r.action === action);
const text = (html: string) => html.replace(/<[^>]+>/g, "");

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

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── No one-tap change ────────────────────────────────────────────────
// Verified this law bites: put the role list back as kit Options (a
// submit per role) on the member page, watched it fail, reverted.
describe("LAW: a role change asks first and says who loses their advisor", () => {
  it("the member page has no submit that changes a role in one tap; each role is a confirm", async () => {
    const html = await render("@/app/org/[slug]/members/[userId]/page", { params: P({ slug: ORG_WITH_MODULES, userId: MEMBER_ID }), searchParams: P({}) });
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*name="role"/);
    expect(html).not.toMatch(/<button[^>]*name="role"[^>]*type="submit"/);
    expect(text(html)).toMatch(/Viewer Now/);
    expect(text(html)).toMatch(/Make Them Admin/);
  });

  // Verified this law bites: dropped the advisees sentence from the role
  // confirm, watched the body check fail, reverted.
  it("demoting an Admin who advises athletes names them in the confirm", async () => {
    const { ConfirmButton } = await import("@/components/kit/ConfirmButton");
    expect(ConfirmButton).toBeTruthy();
    const src = readFileSync(join(SRC, "app/org/[slug]/members/[userId]/page.tsx"), "utf8");
    expect(src).toMatch(/!roleCanAdvise\(r\) && advises\.length > 0/);
    expect(src).toMatch(/lose their advisor/);
  });
});

// ── Side effects are on the record ───────────────────────────────────
// Verified this law bites: removed the logLosses call after the role
// change, watched it fail, reverted.
describe("LAW: a demotion or a removal logs every athlete who lost their advisor", () => {
  it("one advisor_cleared row per advisee", async () => {
    data.org_members.push({ id: "m-second", user_id: "00000000-0000-0000-0000-0000000000d9", org_id: data.orgs[0]!.id, role: "owner" });
    const advised = data.athletes.filter((a) => a.advisor_id === OWNER_ID && a.org_id === data.orgs[0]!.id).length;
    expect(advised).toBeGreaterThan(0);
    const { changeMemberRole } = await import("@/lib/actions/members");
    expect((await changeMemberRole(ORG_WITH_MODULES, OWNER_ID, "member")).ok).toBe(true);
    expect(logs("advisor_cleared")).toHaveLength(advised);
  });
});

// ── Undo ─────────────────────────────────────────────────────────────
// Verified this law bites: dropped the undo parameter from
// setAdvisorFromAthleteForm's redirect, watched it fail, reverted.
describe("LAW: an advisor change offers Undo back to whoever it was", () => {
  it("the redirect carries the previous advisor and the page offers Undo", async () => {
    const { setAdvisorFromAthleteForm } = await import("@/lib/actions/advisor");
    const to = await run(() => setAdvisorFromAthleteForm(ORG_WITH_MODULES, IDS.athlete, form({ advisorId: "" })));
    expect(to).toMatch(new RegExp(`undo=${OWNER_ID}$`));
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: P({ notice: "Advisor cleared.", undo: OWNER_ID }) });
    expect(html).toMatch(/name="advisorId" value="00000000-0000-0000-0000-0000000000b1"|value="00000000-0000-0000-0000-0000000000b1"[^>]*name="advisorId"/);
    expect(text(html)).toMatch(/Undo/);
    // A made-up value in the query offers nothing.
    const junk = await render("@/app/org/[slug]/roster/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: P({ notice: "Advisor cleared.", undo: "drop table" }) });
    expect(text(junk)).not.toMatch(/Undo/);
  });
});

// ── The steward ──────────────────────────────────────────────────────
// Verified this law bites: removed the isEligibleAdvisor check from
// setDonorSteward, watched "refuses a Viewer" fail; removed the
// logActivity call, watched "logs" fail. Reverted both.
describe("LAW: a donor's steward is shown, set by an Admin with a confirm, logged and undoable", () => {
  it("sets an Admin, logs it, and offers Undo", async () => {
    const { setDonorSteward } = await import("@/lib/actions/fundraising");
    const to = await run(() => setDonorSteward(ORG_WITH_MODULES, IDS.donor, form({ stewardId: OWNER_ID })));
    expect(to).toMatch(/notice=Steward%20set\.&undo=none$/);
    expect(data.donors.find((d) => d.id === IDS.donor)!.steward_user_id).toBe(OWNER_ID);
    expect(logs("steward_set")).toHaveLength(1);
    expect(logs("steward_set")[0]).toMatchObject({ subject_type: "donor", subject_id: IDS.donor });
  });

  it("refuses a Viewer as steward and writes nothing", async () => {
    const { setDonorSteward } = await import("@/lib/actions/fundraising");
    const to = await run(() => setDonorSteward(ORG_WITH_MODULES, IDS.donor, form({ stewardId: MEMBER_ID })));
    expect(decodeURIComponent(to!)).toMatch(/Only an Admin/);
    expect(writes).toEqual([]);
  });

  it("the donor page shows the Steward section with its sheet", async () => {
    const html = await render("@/app/org/[slug]/fundraising/donors/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.donor }), searchParams: P({}) });
    expect(text(html)).toMatch(/Steward/);
    expect(text(html)).toMatch(/No Steward/);
    expect(text(html)).toMatch(/Assign/);
  });
});

// ── Every authority write logs ───────────────────────────────────────
// Verified this law bites: removed the logActivity call from
// linkSeatSignIn, watched it fail, reverted.
describe("LAW: seats, titles, settings and the budget are on the record", () => {
  it("linking and unlinking a seat logs", async () => {
    const { linkSeatSignIn } = await import("@/lib/actions/governance");
    await run(() => linkSeatSignIn(ORG_WITH_MODULES, IDS.board, IDS.boardMember, form({ userId: "" })));
    expect(logs("seat_unlinked")).toHaveLength(1);
    await run(() => linkSeatSignIn(ORG_WITH_MODULES, IDS.board, IDS.boardMember, form({ userId: MEMBER_ID })));
    expect(logs("seat_linked")).toHaveLength(1);
  });

  it("a Title change logs", async () => {
    const { setMemberTitle } = await import("@/lib/actions/members");
    expect((await setMemberTitle(ORG_WITH_MODULES, MEMBER_ID, "Board Chair")).ok).toBe(true);
    expect(logs("member_title_changed")).toHaveLength(1);
  });

  it("each action that writes an authority column also writes the log", () => {
    // The files that may change who advises, stewards, holds a role, a
    // Title or a seat, and must log when they do.
    // (A coach's or a contact's job title is not authority; only these
    // tables carry it.)
    const AUTHORITY = /from\("(athletes|donors|org_members|board_members)"\)\s*\.update\(\{[^}]*\b(advisor_id|steward_user_id|role|title|user_id)\b/;
    const files = walk(join(SRC, "lib/actions")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const silent = files.filter((f) => AUTHORITY.test(readFileSync(f, "utf8")) && !/logActivity\(/.test(readFileSync(f, "utf8")));
    expect(silent.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});

// ── No hardcoded people ──────────────────────────────────────────────
// Verified this law bites: wrote `const DAVE = "dave@bffsa.org";` into
// src/lib/org/advisors.ts, watched it fail, reverted.
describe("LAW: no person is written into the app's code", () => {
  it("no email address, and no real person's name, outside comments, tests and the fixture", () => {
    const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/testing/") && !f.includes("/laws/"));
    const offenders: string[] = [];
    for (const f of files) {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      // An example in a hint ("like coach@school.edu") is not a person.
      for (const m of code.matchAll(/["'`][^"'`\n]*\b[\w.+-]+@[\w-]+\.(?:com|org|net|io|edu|co)\b[^"'`\n]*["'`]/g)) if (!/\blike [\w.+-]+@/.test(m[0])) offenders.push(`${f.slice(ROOT.length + 1)}: ${m[0].slice(0, 60)}`);
      if (/\bDave Fisher\b|\bdavefisher\b/i.test(code)) offenders.push(`${f.slice(ROOT.length + 1)}: names Dave`);
    }
    expect(offenders).toEqual([]);
  });
});
