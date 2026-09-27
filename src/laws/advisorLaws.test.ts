// The advisor, managed where you see it (Stage 5, Phase 2; Dave
// approved the plan 2026-09-27).
//
// One function decides who may advise (src/lib/org/advisors.ts), and the
// database trigger is its only twin. The athlete page's Advisor section
// sits first, with Assign or Change opening a sheet of the org's Admins
// most recently used first (athletes.advisor_assigned_at, stamped by
// migration 0043's trigger, never by the app), Clear, and Add Admin,
// which is the existing invite with the role preset and a way back to
// the athlete with the new person assigned. Edit no longer writes the
// advisor, so a Save there can never undo the sheet.
//
// Each law was planted and seen to fail before it was kept; the plant is
// named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { buildFixture, FAMILY_ID, IDS, LONG_INVITE_ID, MEMBER_ID, ORG_WITH_MODULES, OUTSIDER_ID, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let failOn: (table: string, op: string) => string | null = () => null;

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn: (t, o) => failOn(t, o) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn: (t, o) => failOn(t, o) }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  failOn = () => null;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
});

const P = <T>(v: T) => Promise.resolve(v);
const BRIDGE_ID = () => data.orgs!.find((o) => o.slug === ORG_WITH_MODULES)!.id as string;
const advisorOf = (id: string) => data.athletes.find((a) => a.id === id)?.advisor_id ?? null;
const of = (table: string, op: string) => writes.filter((w) => w.table === table && w.op === op);
const filterValue = (w: RecordedWrite | undefined, column: string) => w?.filters.find((f) => f.column === column)?.value;

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; state: unknown }> {
  try {
    return { redirect: null, state: await fn() };
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return { redirect: m.slice(REDIRECT.length), state: null };
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
const rel = (f: string) => f.slice(ROOT.length + 1);
const text = (html: string) => html.replace(/<[^>]+>/g, "");

// ── One rule ─────────────────────────────────────────────────────────
// Verified this law bites: added
// `.in("role", ["owner", "staff"])` back onto the advisor check in
// setAthleteAdvisor (src/lib/actions/members.ts), ran
// `npx vitest run advisorLaws`, watched it fail naming the file, reverted.
describe("LAW: who may advise is decided in one place", () => {
  // The three spellings the rule used to be written in.
  const RULE = /\.in\(\s*"role"\s*,\s*(\["owner",\s*"staff"\]|STAFF_ROLES|ADVISOR_ROLES)\s*\)|role\s*===\s*"owner"\s*\|\|\s*role\s*===\s*"staff"/;
  const ONE = join(SRC, "lib/org/advisors.ts");
  // Where the copies lived (src/lib/actions, the roster and member
  // screens) plus everything that names an advisor.
  const SCOPE = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/laws/") && !f.includes("/testing/") && (f.includes("/lib/actions/") || f.includes("/lib/org/") || f.includes("/lib/data/") || /\/app\/.*\/(roster|members|advisors)\//.test(f)));

  it("the rule lives in advisors.ts and is spelled nowhere else in the actions, the org module or the roster and member screens", () => {
    expect(RULE.test(readFileSync(ONE, "utf8"))).toBe(true);
    const offenders = SCOPE.filter((f) => f !== ONE && RULE.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("canAdvise says owner or staff, and isEligibleAdvisor asks this org", async () => {
    const { canAdvise, isEligibleAdvisor } = await import("@/lib/org/advisors");
    expect(canAdvise("owner")).toBe(true);
    expect(canAdvise("staff")).toBe(true);
    expect(canAdvise("member")).toBe(false);
    expect(canAdvise("family")).toBe(false);
    expect(canAdvise(null)).toBe(false);
    const client = (createFakeClient(data, { userId: OWNER_ID }) as never);
    expect(await isEligibleAdvisor(client, BRIDGE_ID(), OWNER_ID)).toBe(true);
    expect(await isEligibleAdvisor(client, BRIDGE_ID(), MEMBER_ID)).toBe(false);
    expect(await isEligibleAdvisor(client, BRIDGE_ID(), FAMILY_ID)).toBe(false);
    // Elite's Admin is nobody at Bridge.
    expect(await isEligibleAdvisor(client, BRIDGE_ID(), OUTSIDER_ID)).toBe(false);
    expect(await isEligibleAdvisor(client, BRIDGE_ID(), null)).toBe(false);
  });
});

// ── The stamp ────────────────────────────────────────────────────────
// Verified this law bites: wrote `advisor_assigned_at: new Date()` into
// setAthleteAdvisor's update, watched the app-never-writes check fail,
// reverted; then commented out the stamp line in the migration and
// watched the trigger check fail, reverted (and the RLS run failed the
// same way, scripts/rls_test.sql, the 0043 block).
describe("LAW: the database stamps when an advisor was assigned, the app never does", () => {
  const MIGRATIONS = join(ROOT, "migrations");
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith("0043_"));

  it("migration 0043 adds the column, and the trigger stamps it on a new advisor only", () => {
    expect(file).toBeTruthy();
    // Comments stripped, so a stamp line commented out does not pass.
    const sql = readFileSync(join(MIGRATIONS, file!), "utf8").replace(/--.*$/gm, "");
    expect(sql).toMatch(/alter table athletes add column if not exists advisor_assigned_at timestamptz/);
    expect(sql).toMatch(/create or replace function private\.advisor_is_staff\(\)/);
    expect(sql).toMatch(/new\.advisor_id is not null and \(tg_op = 'INSERT' or new\.advisor_id is distinct from old\.advisor_id\)[\s\S]*new\.advisor_assigned_at := now\(\)/);
    // The rule itself is unchanged.
    expect(sql).toMatch(/m\.role in \('owner', 'staff'\)/);
  });

  it("the RLS run applies 0043 and asserts on it", () => {
    expect(readFileSync(join(ROOT, "scripts/run_rls_test.sh"), "utf8")).toContain(`migrations/${file}`);
    const rls = readFileSync(join(ROOT, "scripts/rls_test.sql"), "utf8");
    expect(rls).toMatch(/ALL 0043 ASSERTIONS PASSED/);
    expect(rls).toMatch(/advisor_assigned_at/);
  });

  it("no action, page or data loader writes advisor_assigned_at", () => {
    const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/laws/") && !f.includes("/testing/"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // A write is the column inside the object handed to insert,
      // update or upsert; a read is it in a select string or a row type.
      for (const m of src.matchAll(/\.(insert|update|upsert)\(\s*\{[^)]*\badvisor_assigned_at\b/g)) offenders.push(`${rel(f)}: ${m[0].slice(0, 60)}`);
    }
    expect(offenders).toEqual([]);
    // The checker sees a write when there is one.
    expect(/\.(insert|update|upsert)\(\s*\{[^)]*\badvisor_assigned_at\b/.test('supabase.from("athletes").update({ advisor_id: id, advisor_assigned_at: now })')).toBe(true);
  });
});

// ── The form action from the athlete page ────────────────────────────
// Verified this law bites: dropped the eligibility check from
// setAthleteAdvisor; the member was accepted and "refuses a Viewer"
// failed. Separately removed `.eq("org_id", org.id)` from the athletes
// lookup; "refuses another org's athlete" failed. Reverted both.
describe("LAW: the athlete page assigns, changes and clears, for an Admin, on this org's athlete", () => {
  const back = `/org/${ORG_WITH_MODULES}/roster/${IDS.athleteTransfer}`;

  it("assigns an Admin and comes back with a notice", async () => {
    const { setAdvisorFromAthleteForm } = await import("@/lib/actions/advisor");
    const r = await run(() => setAdvisorFromAthleteForm(ORG_WITH_MODULES, IDS.athleteTransfer, form({ advisorId: OWNER_ID })));
    expect(r.redirect).toBe(`${back}?notice=Advisor%20assigned.`);
    expect(advisorOf(IDS.athleteTransfer)).toBe(OWNER_ID);
    const update = of("athletes", "update")[0];
    expect(update?.rows[0]).toEqual({ advisor_id: OWNER_ID });
    expect(filterValue(update, "org_id")).toBe(BRIDGE_ID());
    expect(filterValue(update, "id")).toEqual([IDS.athleteTransfer]);
  });

  it("an empty value clears", async () => {
    const { setAdvisorFromAthleteForm } = await import("@/lib/actions/advisor");
    const r = await run(() => setAdvisorFromAthleteForm(ORG_WITH_MODULES, IDS.athlete, form({ advisorId: "" })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}?notice=Advisor%20cleared.`);
    expect(advisorOf(IDS.athlete)).toBeNull();
    expect(of("athletes", "update")[0]?.rows[0]).toEqual({ advisor_id: null });
  });

  it("refuses a Viewer, an Athlete login and another org's Admin, and writes nothing", async () => {
    const { setAdvisorFromAthleteForm } = await import("@/lib/actions/advisor");
    for (const advisorId of [MEMBER_ID, FAMILY_ID, OUTSIDER_ID]) {
      const r = await run(() => setAdvisorFromAthleteForm(ORG_WITH_MODULES, IDS.athleteTransfer, form({ advisorId })));
      expect(r.redirect).toMatch(new RegExp(`^${back.replace(/[/]/g, "\\/")}\\?error=`));
      expect(decodeURIComponent(r.redirect!)).toMatch(/Only an Admin/);
    }
    expect(writes).toEqual([]);
    expect(advisorOf(IDS.athleteTransfer)).toBeNull();
  });

  it("refuses another org's athlete", async () => {
    const { setAdvisorFromAthleteForm } = await import("@/lib/actions/advisor");
    const r = await run(() => setAdvisorFromAthleteForm(ORG_WITH_MODULES, IDS.athleteElite, form({ advisorId: OWNER_ID })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/roster/);
    expect(writes).toEqual([]);
    expect(advisorOf(IDS.athleteElite)).toBeNull();
  });

  it("a Viewer and an Athlete login are turned away before anything is read", async () => {
    const { setAdvisorFromAthleteForm } = await import("@/lib/actions/advisor");
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      await expect(setAdvisorFromAthleteForm(ORG_WITH_MODULES, IDS.athlete, form({ advisorId: OWNER_ID }))).rejects.toThrow(REDIRECT + "/unauthorized");
    }
    expect(writes).toEqual([]);
  });
});

// ── Edit leaves the advisor alone ────────────────────────────────────
// Verified this law bites: put `advisor_id: parsed.values.advisorId ?? null`
// back into updateAthlete's update, watched it fail, reverted.
describe("LAW: a Save on Edit never touches the advisor", () => {
  it("updateAthlete ignores an advisorId it is sent and keeps the assignment", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "baseball", recruitType: "hs", status: "Active", advisorId: "" })));
    expect(r.redirect).toContain(`/roster/${IDS.athlete}`);
    expect(advisorOf(IDS.athlete)).toBe(OWNER_ID);
    const update = of("athletes", "update")[0];
    expect(update).toBeTruthy();
    expect(Object.keys(update!.rows[0]!)).not.toContain("advisor_id");
  });

  it("the Edit screen has no Advisor picker; Add still has one", async () => {
    const edit = await render("@/app/org/[slug]/roster/[id]/edit/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(edit).not.toMatch(/name="advisorId"/);
    const add = await render("@/app/org/[slug]/roster/new/page", { params: P({ slug: ORG_WITH_MODULES }) });
    expect(add).toMatch(/name="advisorId"/);
  });
});

// ── Most recently used first ─────────────────────────────────────────
// Verified this law bites: sorted by name alone in sortAdvisorChoices,
// watched "the most recently assigned Admin comes first" fail, reverted.
describe("LAW: the sheet lists Admins most recently used first, then by name, never-assigned last", () => {
  const secondAdmin = () => {
    // A second Bridge Admin, assigned after the owner's latest stamp.
    data.org_members.find((m) => m.id === "m5")!.role = "owner";
    data.athletes.find((a) => a.id === IDS.athleteTransfer)!.advisor_id = LONG_INVITE_ID;
    data.athletes.find((a) => a.id === IDS.athleteTransfer)!.advisor_assigned_at = "2026-09-25T09:00:00.000Z";
  };

  it("the most recently assigned Admin comes first", async () => {
    secondAdmin();
    const { loadAdvisorChoices } = await import("@/lib/org/advisors");
    const list = await loadAdvisorChoices((createFakeClient(data, { userId: OWNER_ID }) as never), BRIDGE_ID());
    expect(list.map((c) => c.id)).toEqual([LONG_INVITE_ID, OWNER_ID]);
    expect(list[1]!.lastAssignedAt).toBe("2026-09-20T12:00:00.000Z");
    expect(list[1]!.advising).toBe(2);
    // No Viewer, Athlete login or other org's Admin is offered.
    expect(list.map((c) => c.id)).not.toContain(MEMBER_ID);
    expect(list.map((c) => c.id)).not.toContain(FAMILY_ID);
    expect(list.map((c) => c.id)).not.toContain(OUTSIDER_ID);
  });

  it("an Admin never assigned sorts last, ties go A to Z", async () => {
    const { sortAdvisorChoices } = await import("@/lib/org/advisors");
    const sorted = sortAdvisorChoices([
      { id: "c", name: "Cara", lastAssignedAt: null },
      { id: "b", name: "Bea", lastAssignedAt: "2026-09-01T00:00:00.000Z" },
      { id: "a", name: "Abe", lastAssignedAt: "2026-09-01T00:00:00.000Z" },
      { id: "d", name: "Dev", lastAssignedAt: "2026-09-02T00:00:00.000Z" },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("the open sheet renders them in that order, marks the current one, and offers Clear and Add Admin", async () => {
    secondAdmin();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { AdvisorSheet } = await import("@/components/AdvisorSheet");
    const { loadAdvisorChoices } = await import("@/lib/org/advisors");
    const choices = await loadAdvisorChoices((createFakeClient(data, { userId: OWNER_ID }) as never), BRIDGE_ID());
    const html = renderToStaticMarkup(
      createElement(AdvisorSheet, {
        action: async () => {},
        field: "advisorId",
        title: "Advisor",
        trigger: "Change",
        searchLabel: "Search Admins",
        currentId: OWNER_ID,
        clearLabel: "Clear Advisor",
        choices: choices.map((c) => ({ id: c.id, title: c.name, meta: c.title ?? "Admin", keywords: c.email })),
        add: { href: `/org/${ORG_WITH_MODULES}/members/new?role=owner&assignAthleteId=${IDS.athlete}`, label: "Add Admin" },
        empty: "Nobody yet.",
        defaultOpen: true,
      }),
    );
    expect(html).toMatch(/role="dialog"/);
    expect(html.indexOf("an.unusually.long.invited.address")).toBeLessThan(html.indexOf("Example Owner"));
    expect(html).toMatch(/<button type="submit" value="[^"]+" disabled="" aria-pressed="true"[^>]*name="advisorId"[^>]*>[\s\S]*?Example Owner/);
    expect(html).toMatch(/Assigned Now/);
    expect(html).toMatch(/<button value=""[^>]*name="advisorId"[^>]*>Clear Advisor/);
    expect(html).toContain(`href="/org/${ORG_WITH_MODULES}/members/new?role=owner&amp;assignAthleteId=${IDS.athlete}"`);
    // Closed, only the trigger shows.
    const closed = renderToStaticMarkup(createElement(AdvisorSheet, { action: async () => {}, field: "advisorId", title: "Advisor", trigger: "Change", searchLabel: "Search Admins", choices: [], empty: "Nobody yet." }));
    expect(closed).toContain("Change");
    expect(closed).not.toMatch(/role="dialog"/);
  });
});

// ── Add Admin through the invite ─────────────────────────────────────
// Verified this law bites: moved the assignment above the membership
// insert in inviteMember; "membership first, then the advisor" failed on
// the order. Then made the failed-invite branch fall through to assign;
// "no advisor when the invite fails" failed. Reverted both.
describe("LAW: Add Admin invites, then assigns, and comes back to the athlete", () => {
  const back = `/org/${ORG_WITH_MODULES}/roster/${IDS.athleteTransfer}`;
  const invite = (extra: Record<string, string> = {}) => form({ email: "coach@example.test", role: "owner", fullName: "New Coach", assignAthleteId: IDS.athleteTransfer, returnTo: back, ...extra });

  it("membership first, then the advisor, then back to the athlete with the name in the notice", async () => {
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, invite()));
    expect(r.redirect).toMatch(new RegExp(`^${back.replace(/[/]/g, "\\/")}\\?notice=`));
    expect(decodeURIComponent(r.redirect!)).toMatch(/Fixture Transfer's advisor/);
    const membership = of("org_members", "insert")[0];
    const newId = membership?.rows[0]?.user_id as string;
    expect(membership?.rows[0]).toMatchObject({ org_id: BRIDGE_ID(), role: "owner" });
    const update = of("athletes", "update")[0];
    expect(update?.rows[0]).toEqual({ advisor_id: newId });
    expect(filterValue(update, "org_id")).toBe(BRIDGE_ID());
    expect(filterValue(update, "id")).toBe(IDS.athleteTransfer);
    expect(advisorOf(IDS.athleteTransfer)).toBe(newId);
    const order = writes.map((w) => `${w.table}:${w.op}`);
    expect(order.indexOf("org_members:insert")).toBeLessThan(order.indexOf("athletes:update"));
  });

  it("no advisor when the invite fails", async () => {
    failOn = (table, op) => (table === "org_members" && op === "insert" ? "no room" : null);
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, invite()));
    expect(r.redirect).toBeNull();
    expect((r.state as { errors: Record<string, string> }).errors.form).toMatch(/no room/);
    expect(of("athletes", "update")).toEqual([]);
    expect(advisorOf(IDS.athleteTransfer)).toBeNull();
  });

  it("refuses an Athlete login or a Viewer as advisor, and another org's athlete, before any account is made", async () => {
    const { inviteMember } = await import("@/lib/actions/members");
    for (const role of ["family", "member"]) {
      const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, invite({ role, athleteId: IDS.athlete })));
      expect(r.redirect).toBeNull();
      expect((r.state as { errors: Record<string, string> }).errors.role).toMatch(/Only an Admin/);
    }
    const foreign = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, invite({ assignAthleteId: IDS.athleteElite })));
    expect(foreign.redirect).toBeNull();
    expect((foreign.state as { errors: Record<string, string> }).errors.form).toMatch(/roster/);
    expect(writes).toEqual([]);
  });

  it("somebody already an Admin here is assigned, not invited twice", async () => {
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, invite({ email: "owner@example.test" })));
    expect(decodeURIComponent(r.redirect ?? "")).toMatch(/already an Admin here and is now Fixture Transfer's advisor/);
    expect(of("org_members", "insert")).toEqual([]);
    expect(of("auth:invite", "insert")).toEqual([]);
    expect(advisorOf(IDS.athleteTransfer)).toBe(OWNER_ID);
  });

  it("the invite screen with ?assignAthleteId is Add Admin, pinned to that athlete; otherwise it is the plain invite", async () => {
    const withAthlete = await render("@/app/org/[slug]/members/new/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ role: "owner", assignAthleteId: IDS.athleteTransfer }) });
    expect(withAthlete).toMatch(/Add Admin/);
    expect(text(withAthlete)).toMatch(/assigned as Fixture Transfer(&#x27;|')s advisor/);
    expect(withAthlete).toMatch(/name="role" value="owner"/);
    expect(withAthlete).toContain(`name="assignAthleteId" value="${IDS.athleteTransfer}"`);
    expect(withAthlete).toContain(`name="returnTo" value="${back}"`);
    expect(withAthlete).toMatch(/Send Invite/);
    expect(withAthlete).not.toMatch(/name="role"[^>]*>\s*<option/);

    const plain = await render("@/app/org/[slug]/members/new/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) });
    expect(plain).toMatch(/Invite Someone/);
    expect(plain).not.toMatch(/assignAthleteId/);
    // Another org's athlete, or a role that cannot advise, is the plain invite.
    const foreign = await render("@/app/org/[slug]/members/new/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ assignAthleteId: IDS.athleteElite }) });
    expect(foreign).toMatch(/Invite Someone/);
    const family = await render("@/app/org/[slug]/members/new/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ role: "family", assignAthleteId: IDS.athleteTransfer }) });
    expect(family).toMatch(/Invite Someone/);
    // A Viewer cannot advise either, so ?role=member is not Add Admin.
    const viewer = await render("@/app/org/[slug]/members/new/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ role: "member", assignAthleteId: IDS.athleteTransfer }) });
    expect(viewer).toMatch(/Invite Someone/);
    expect(viewer).not.toMatch(/assignAthleteId/);
  });
});

// ── The screens ──────────────────────────────────────────────────────
// Verified this law bites: moved the Advisor section back under Targets
// on the athlete page; "Advisor comes first" failed on the order.
// Reverted.
describe("LAW: the Advisor section is first on the athlete page, with Assign or Change", () => {
  const page = (id: string) => render("@/app/org/[slug]/roster/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id }), searchParams: P({}) });

  it("Advisor comes first, above the stage and Targets, with Change when somebody is assigned", async () => {
    const html = await page(IDS.athlete);
    const advisor = html.indexOf(">Advisor<");
    expect(advisor).toBeGreaterThan(-1);
    expect(advisor).toBeLessThan(html.indexOf("NCAA Eligibility"));
    expect(advisor).toBeLessThan(html.indexOf(">Targets<"));
    expect(advisor).toBeLessThan(html.indexOf(`/board?athlete=${IDS.athlete}`));
    const section = html.slice(advisor, html.indexOf("NCAA Eligibility"));
    expect(section).toMatch(/Example Owner/);
    expect(section).toMatch(/>Change</);
    expect(section).not.toMatch(/>Assign</);
    // Messages and Check-Ins travel with it.
    expect(section).toContain(`/roster/${IDS.athlete}/messages`);
    expect(section).toContain(`/roster/${IDS.athlete}/checkins`);
    // Nothing else moved: the rest of the page still reads in order.
    expect(html.indexOf("NCAA Eligibility")).toBeLessThan(html.indexOf(">Notes<"));
    expect(html.indexOf(">Notes<")).toBeLessThan(html.indexOf(">Contacts<"));
    expect(html).toMatch(/Remove Athlete/);
  });

  it("with nobody assigned it says so, with Assign inside the empty state", async () => {
    const html = await page(IDS.athleteTransfer);
    const advisor = html.indexOf(">Advisor<");
    const section = html.slice(advisor, html.indexOf("NCAA Eligibility"));
    expect(section).toMatch(/No Advisor Assigned/);
    expect(section).toMatch(/>Assign</);
    expect(section).not.toMatch(/>Change</);
    expect(section).not.toContain("/edit");
  });

  it("an error from the sheet shows on the page", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: P({ error: "Only an Admin can advise athletes." }) });
    expect(text(html)).toContain("Only an Admin can advise athletes.");
  });

  it("the member page offers Assign Athlete for an Admin and not for a Viewer", async () => {
    const owner = await render("@/app/org/[slug]/members/[userId]/page", { params: P({ slug: ORG_WITH_MODULES, userId: OWNER_ID }), searchParams: P({}) });
    expect(owner).toMatch(/Athletes They Advise[\s\S]*Assign Athlete/);
    const viewer = await render("@/app/org/[slug]/members/[userId]/page", { params: P({ slug: ORG_WITH_MODULES, userId: MEMBER_ID }), searchParams: P({}) });
    expect(viewer).not.toMatch(/Assign Athlete/);
    expect(viewer).not.toMatch(/Athletes They Advise/);
  });

  it("a Viewer and an Athlete login never reach the athlete page or the sheet", async () => {
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      await expect(page(IDS.athlete)).rejects.toThrow(REDIRECT + "/unauthorized");
    }
  });
});
