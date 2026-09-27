// Laws for the org, its people, its board and its money: everything
// that can be added can be fixed and removed (Dave, 2026-09-27: "very
// easy for anyone to edit anything... add and delete and all that good
// stuff"), and the fix never reaches past the org it belongs to.
//
// Audit items: wired F4 (create an org, org settings), crud F10
// (donors, gifts, pledges, campaigns, grants), F11 (boards and seats),
// F17 (names), F18 (advisors from the advisor's side), F23 and the
// member-page side of F7 (family links and role switches in place), and
// Stage 4 B8 (autofill on the seat and grant forms).
//
// Each law was planted and seen to fail before it was kept; the plant is
// named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { buildFixture, FAMILY_ID, IDS, MEMBER_ID, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OUTSIDER_ID, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { isValidSlug, mergeModules, parseCreateOrgForm, parseOrgSettingsForm, slugify } from "@/lib/validation/org";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");

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
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));
// The service role, as a fake whose writes land in the same list: the
// member, name and settings actions use it on purpose, after their own
// checks, and every write it makes is asserted on below.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

const BRIDGE_ID = () => data.orgs!.find((o) => o.slug === ORG_WITH_MODULES)!.id as string;
const ELITE_ID = () => data.orgs!.find((o) => o.slug === ORG_WITHOUT_MODULES)!.id as string;

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
});

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; state: unknown }> {
  try {
    const state = await fn();
    return { redirect: null, state };
  } catch (e) {
    const message = (e as Error).message;
    if (message.startsWith(REDIRECT)) return { redirect: message.slice(REDIRECT.length), state: null };
    throw e;
  }
}

function form(values: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
}

const of = (table: string, op: RecordedWrite["op"]) => writes.filter((w) => w.table === table && w.op === op);
const filterValue = (w: RecordedWrite | undefined, column: string) => w?.filters.find((f) => f.column === column)?.value;
const errorsOf = (state: unknown) => (state as { errors: Record<string, string> }).errors;

// ── Source walks ─────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const APP_ORG = join(SRC, "app", "org", "[slug]");
const GROUP_D_PAGES = [
  ...walk(join(APP_ORG, "members")),
  ...walk(join(APP_ORG, "board-governance")),
  ...walk(join(APP_ORG, "fundraising")),
  ...walk(join(APP_ORG, "settings")),
  ...walk(join(APP_ORG, "more")),
  ...walk(join(SRC, "app", "orgs")),
].filter((f) => f.endsWith("page.tsx"));

describe("LAW: every remove on the org, member, board and money screens asks first", () => {
  // Plant: replaced the ConfirmButton on Edit Gift with a plain
  // <Button variant="destructive">Remove Gift</Button>; this failed
  // naming fundraising/gifts/[id]/edit/page.tsx.
  it("found the screens", () => {
    expect(GROUP_D_PAGES.length).toBeGreaterThanOrEqual(25);
  });

  it("a form posting to a remove, unlink or unassign action carries a ConfirmButton", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const f of GROUP_D_PAGES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<Form action=\{(\w+)[^}]*\}>([\s\S]*?)<\/Form>/g)) {
        if (!/^(remove|unlink|unassign|delete)/i.test(m[1]!)) continue;
        seen++;
        if (!m[2]!.includes("<ConfirmButton")) offenders.push(`${f.slice(ROOT.length + 1)}: ${m[1]}`);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(10);
    expect(offenders).toEqual([]);
  });
});

describe("LAW: every record the org adds can be edited and removed", () => {
  // Plant: renamed removeGrant to dropGrant in fundraising.ts (and its
  // one caller); this failed naming "removeGrant".
  const fundraising = readFileSync(join(SRC, "lib", "actions", "fundraising.ts"), "utf8");
  const governance = readFileSync(join(SRC, "lib", "actions", "governance.ts"), "utf8");
  const pages = GROUP_D_PAGES.map((f) => readFileSync(f, "utf8")).join("\n");

  const expected: Array<[string, string]> = [
    ["fundraising", "Donor"],
    ["fundraising", "Gift"],
    ["fundraising", "Pledge"],
    ["fundraising", "Campaign"],
    ["fundraising", "Grant"],
    ["governance", "Board"],
    ["governance", "BoardSeat"],
  ];

  for (const [file, record] of expected) {
    it(`${record}: an update and a remove action exist, and a screen posts to each`, () => {
      const src = file === "fundraising" ? fundraising : governance;
      for (const verb of ["update", "remove"]) {
        const name = `${verb}${record}`;
        expect(src, name).toMatch(new RegExp(`export async function ${name}\\(`));
        expect(pages, `${name} is posted from a screen`).toMatch(new RegExp(`\\b${name}\\.bind\\(`));
      }
    });
  }
});

// ── Fundraising ──────────────────────────────────────────────────────

describe("LAW: a money edit stays in its org and keeps the pledge arithmetic true", () => {
  const giftForm = (over: Record<string, string> = {}) => form({ amount: "100", receivedOn: "2026-06-01", category: "individual", method: "check", ...over });

  it("an edit to another org's gift is refused and writes nothing", async () => {
    // Plant: dropped the org-scoped before-read from updateGift; the
    // action went on to write and redirect.
    data.gifts!.push({ id: "gf-elite", org_id: ELITE_ID(), donor_id: null, campaign_id: null, pledge_id: null, amount: 50, received_on: "2026-01-01", category: "individual", method: "cash", solicited_by: null });
    const { updateGift } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateGift(ORG_WITH_MODULES, "gf-elite", { errors: {} }, giftForm()));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toMatch(/not in this organization/);
    expect(writes).toEqual([]);
  });

  it("an edit cannot point a gift at another org's pledge", async () => {
    data.pledges!.push({ id: "pl-elite", org_id: ELITE_ID(), donor_id: "x", campaign_id: null, amount: 10, promised_on: "2026-01-01", due_on: null, status: "open", solicited_by: null });
    const { updateGift } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateGift(ORG_WITH_MODULES, "gf1", { errors: {} }, giftForm({ donorId: IDS.donor, pledgeId: "pl-elite" })));
    expect(errorsOf(r.state).form).toMatch(/pledge is not in this organization/);
    expect(of("gifts", "update")).toEqual([]);
  });

  it("an edited gift is written by id and org, and the pledges it moved between settle again", async () => {
    // Plant: resettlePledge only ever closed a pledge (the old
    // settlePledgeIfPaid); the old pledge stayed fulfilled.
    data.pledges!.push({ id: "pl2", org_id: BRIDGE_ID(), donor_id: IDS.donor, campaign_id: null, amount: 100, promised_on: "2026-01-01", due_on: null, status: "fulfilled", solicited_by: null });
    data.gifts!.push({ id: "gf-pay", org_id: BRIDGE_ID(), donor_id: IDS.donor, campaign_id: null, pledge_id: "pl2", amount: 100, received_on: "2026-02-01", category: "individual", method: "check", solicited_by: null });
    const { updateGift } = await import("@/lib/actions/fundraising");
    // Move the payment from pl2 to pl1 (10,000 owed): pl2 is owed again,
    // pl1 is still short.
    const r = await run(() => updateGift(ORG_WITH_MODULES, "gf-pay", { errors: {} }, giftForm({ donorId: IDS.donor, pledgeId: "pl1" })));
    expect(r.redirect).toMatch(/\/fundraising\/gifts\?notice=/);
    const update = of("gifts", "update")[0];
    expect(filterValue(update, "id")).toBe("gf-pay");
    expect(filterValue(update, "org_id")).toBe(BRIDGE_ID());
    expect(data.pledges!.find((p) => p.id === "pl2")!.status).toBe("open");
    expect(data.pledges!.find((p) => p.id === "pl1")!.status).toBe("open");
  });

  it("removing the payment that settled a pledge opens it again", async () => {
    data.pledges!.push({ id: "pl3", org_id: BRIDGE_ID(), donor_id: IDS.donor, campaign_id: null, amount: 100, promised_on: "2026-01-01", due_on: null, status: "fulfilled", solicited_by: null });
    data.gifts!.push({ id: "gf-settle", org_id: BRIDGE_ID(), donor_id: IDS.donor, campaign_id: null, pledge_id: "pl3", amount: 100, received_on: "2026-02-01", category: "individual", method: "check", solicited_by: null });
    const { removeGift } = await import("@/lib/actions/fundraising");
    const r = await run(() => removeGift(ORG_WITH_MODULES, "gf-settle"));
    expect(r.redirect).toMatch(/notice=/);
    const del = of("gifts", "delete")[0];
    expect(filterValue(del, "org_id")).toBe(BRIDGE_ID());
    expect(data.pledges!.find((p) => p.id === "pl3")!.status).toBe("open");
  });

  it("a written-off pledge stays written off, and paid in full is never picked by hand", async () => {
    // Plant: saved the status straight from the form and skipped the
    // re-settle; "fulfilled" stuck on a pledge with nothing paid.
    const { updatePledge } = await import("@/lib/actions/fundraising");
    const pledge = (status: string) => form({ donorId: IDS.donor, amount: "100", promisedOn: "2026-01-15", status });
    await run(() => updatePledge(ORG_WITH_MODULES, "pl1", { errors: {} }, pledge("written_off")));
    expect(data.pledges!.find((p) => p.id === "pl1")!.status).toBe("written_off");
    // "fulfilled" from the form is not a choice: it saves as open and the
    // payments decide. None are linked to pl1, so it stays open.
    await run(() => updatePledge(ORG_WITH_MODULES, "pl1", { errors: {} }, pledge("fulfilled")));
    expect(data.pledges!.find((p) => p.id === "pl1")!.status).toBe("open");
  });

  it("removing a donor is a soft delete in this org, and their gifts stay", async () => {
    // Plant: removeDonor as .delete(); this failed on the delete op.
    const giftsBefore = data.gifts!.length;
    const { removeDonor } = await import("@/lib/actions/fundraising");
    const r = await run(() => removeDonor(ORG_WITH_MODULES, IDS.donor));
    expect(r.redirect).toMatch(/\/fundraising\/donors\?notice=/);
    expect(of("donors", "delete")).toEqual([]);
    const soft = of("donors", "update")[0];
    expect(soft?.rows[0]).toHaveProperty("deleted_at");
    expect(filterValue(soft, "org_id")).toBe(BRIDGE_ID());
    expect(data.gifts!.length).toBe(giftsBefore);
  });

  it("a removed donor's page is gone, and their edit screen with it", async () => {
    // Plant: dropped .is("deleted_at", null) from the donor page's read.
    data.donors!.find((d) => d.id === IDS.donor)!.deleted_at = "2026-09-27T00:00:00Z";
    const { renderToStaticMarkup } = await import("react-dom/server");
    for (const path of ["@/app/org/[slug]/fundraising/donors/[id]/page", "@/app/org/[slug]/fundraising/donors/[id]/edit/page"]) {
      const mod = (await import(/* @vite-ignore */ path)) as { default: (p: unknown) => Promise<unknown> };
      await expect(mod.default({ params: Promise.resolve({ slug: ORG_WITH_MODULES, id: IDS.donor }), searchParams: Promise.resolve({}) }).then((t) => renderToStaticMarkup(t as never))).rejects.toThrow(NOT_FOUND);
    }
  });

  it("a grant whose funder is exactly one donor's name is linked to that donor", async () => {
    // Plant: donor_id always null.
    const { trackGrant } = await import("@/lib/actions/fundraising");
    await run(() => trackGrant(ORG_WITH_MODULES, { errors: {} }, form({ funderName: "  fixture donor ", status: "applied" })));
    expect(of("grants", "insert")[0]?.rows[0]).toMatchObject({ funder_name: "fixture donor", donor_id: IDS.donor, status: "applied" });
  });

  it("a grant status moves forward on edit, scoped to the org", async () => {
    // Plant: amount_awarded always null.
    const { updateGrant } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateGrant(ORG_WITH_MODULES, "gr1", { errors: {} }, form({ funderName: "Fixture Trust", status: "awarded", amountAwarded: "12000" })));
    expect(r.redirect).toMatch(/\/fundraising\/grants\?notice=/);
    const update = of("grants", "update")[0];
    expect(update?.rows[0]).toMatchObject({ status: "awarded", amount_awarded: "12000.00" });
    expect(filterValue(update, "org_id")).toBe(BRIDGE_ID());
  });
});

// ── Governance ───────────────────────────────────────────────────────

describe("LAW: a seat edit keeps every check the add makes", () => {
  const seatForm = (over: Record<string, string> = {}) => form({ name: "Fixture Chair", status: "active", ...over });

  it("the active-seat cap does not count the seat being edited", async () => {
    // Plant: counted every active seat including the one being edited;
    // a board full at one seat refused to save its own chair.
    data.boards!.find((b) => b.id === IDS.board)!.max_seats = 1;
    const { updateBoardSeat, addBoardSeat } = await import("@/lib/actions/governance");
    const edit = await run(() => updateBoardSeat(ORG_WITH_MODULES, IDS.board, IDS.boardMember, { errors: {} }, seatForm({ roleTitle: "Chair" })));
    expect(edit.redirect).toMatch(/notice=/);
    const add = await run(() => addBoardSeat(ORG_WITH_MODULES, IDS.board, { errors: {} }, seatForm({ name: "Second Active" })));
    expect(errorsOf(add.state).form).toMatch(/full at 1/);
  });

  it("an edit to a seat on another org's board is refused", async () => {
    // Plant: dropped .eq("org_id") from the board read in readSeatForm.
    data.boards!.push({ id: "board-elite", org_id: ELITE_ID(), name: "Elite Board", kind: "general", sport: null, give_get_amount: 0, min_seats: 1, max_seats: 5 });
    const { updateBoardSeat } = await import("@/lib/actions/governance");
    const r = await run(() => updateBoardSeat(ORG_WITH_MODULES, "board-elite", IDS.boardMember, { errors: {} }, seatForm()));
    expect(errorsOf(r.state).form).toMatch(/not in this organization/);
    expect(of("board_members", "update")).toEqual([]);
  });

  it("picking a donor fills a blank name, email and phone on the server, and never overwrites what was typed", async () => {
    // Plant: removed the `?? donor?.email` fallback; the email saved blank.
    Object.assign(data.donors!.find((d) => d.id === IDS.donorNoSeat)!, { email: "lapsed@example.test", phone: "555-0101" });
    const { addBoardSeat } = await import("@/lib/actions/governance");
    await run(() => addBoardSeat(ORG_WITH_MODULES, IDS.board, { errors: {} }, form({ status: "prospect", donorId: IDS.donorNoSeat, phone: "555-0199" })));
    expect(of("board_members", "insert")[0]?.rows[0]).toMatchObject({ name: "Fixture Lapsed Donor", email: "lapsed@example.test", phone: "555-0199" });
  });

  it("a board with seats cannot be removed; an empty one can, in its org only", async () => {
    // Plant: inverted the seat count check; the board with two seats was deleted.
    const { removeBoard } = await import("@/lib/actions/governance");
    const full = await run(() => removeBoard(ORG_WITH_MODULES, IDS.board));
    expect(full.redirect).toMatch(/error=.*seats/);
    expect(of("boards", "delete")).toEqual([]);

    data.boards!.push({ id: "board-empty", org_id: BRIDGE_ID(), name: "Empty Board", kind: "general", sport: null, give_get_amount: 0, min_seats: 0, max_seats: 5 });
    const empty = await run(() => removeBoard(ORG_WITH_MODULES, "board-empty"));
    expect(empty.redirect).toMatch(/\/board-governance\?notice=/);
    expect(filterValue(of("boards", "delete")[0], "org_id")).toBe(BRIDGE_ID());
  });

  it("removing a seat is scoped to its board and org", async () => {
    // Plant: the delete filtered on id alone.
    const { removeBoardSeat } = await import("@/lib/actions/governance");
    await run(() => removeBoardSeat(ORG_WITH_MODULES, IDS.board, "bm2"));
    const del = of("board_members", "delete")[0];
    expect(filterValue(del, "id")).toBe("bm2");
    expect(filterValue(del, "board_id")).toBe(IDS.board);
    expect(filterValue(del, "org_id")).toBe(BRIDGE_ID());
  });
});

// ── Members ──────────────────────────────────────────────────────────

describe("LAW: a role switch to or from family keeps the links straight", () => {
  it("leaving family needs a confirm, then drops that person's links in this org before the role changes", async () => {
    // Plant: skipped the guardian delete on a switch away from family;
    // the staff account kept three links to athletes.
    const { changeMemberRole } = await import("@/lib/actions/members");
    const unconfirmed = await changeMemberRole(ORG_WITH_MODULES, FAMILY_ID, "staff");
    expect(unconfirmed.ok).toBe(false);
    expect(writes).toEqual([]);

    const r = await changeMemberRole(ORG_WITH_MODULES, FAMILY_ID, "staff", { confirmed: true });
    expect(r.ok).toBe(true);
    const unlink = of("athlete_guardians", "delete")[0];
    expect(filterValue(unlink, "user_id")).toBe(FAMILY_ID);
    expect(filterValue(unlink, "org_id")).toBe(BRIDGE_ID());
    const order = writes.map((w) => `${w.table}:${w.op}`);
    expect(order.indexOf("athlete_guardians:delete")).toBeLessThan(order.indexOf("org_members:update"));
  });

  it("becoming family needs this org's athlete, clears advising and any seat, and links after the role", async () => {
    // Plant: inserted the guardian link before the role update; the
    // order assertion failed.
    const { changeMemberRole } = await import("@/lib/actions/members");
    expect((await changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "family")).ok).toBe(false);
    expect((await changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "family", { athleteId: IDS.athleteElite })).error).toMatch(/not on this organization's roster/);
    expect(writes).toEqual([]);

    const r = await changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "family", { athleteId: IDS.athlete, relationship: "guardian" });
    expect(r.ok).toBe(true);
    expect(filterValue(of("athletes", "update")[0], "advisor_id")).toBe(MEMBER_ID);
    expect(of("board_members", "update")[0]?.rows[0]).toEqual({ user_id: null });
    expect(of("athlete_guardians", "insert")[0]?.rows[0]).toMatchObject({ org_id: BRIDGE_ID(), athlete_id: IDS.athlete, user_id: MEMBER_ID, relationship: "guardian" });
    expect(of("org_members", "update")[0]?.rows[0]).toEqual({ role: "family" });
    const order = writes.map((w) => `${w.table}:${w.op}`);
    expect(order.indexOf("org_members:update")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("org_members:update")).toBeLessThan(order.indexOf("athlete_guardians:insert"));
  });

  it("the only owner still cannot be switched to family", async () => {
    // Plant: skipped the only-owner check.
    const { changeMemberRole } = await import("@/lib/actions/members");
    const r = await changeMemberRole(ORG_WITH_MODULES, OWNER_ID, "family", { athleteId: IDS.athlete });
    expect(r.error).toMatch(/only owner/);
    expect(writes).toEqual([]);
  });
});

describe("LAW: advisors are assigned only to staff, only on this org's athletes", () => {
  it("a member cannot be made an advisor", async () => {
    // Plant: dropped the role filter on the advisor check; the member
    // was accepted.
    const { setAthleteAdvisor } = await import("@/lib/actions/members");
    const r = await setAthleteAdvisor(ORG_WITH_MODULES, [IDS.athlete], MEMBER_ID);
    expect(r.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("another org's athlete in the list refuses the whole assignment", async () => {
    // Plant: accepted the list when any athlete was found.
    const { setAthleteAdvisor } = await import("@/lib/actions/members");
    const r = await setAthleteAdvisor(ORG_WITH_MODULES, [IDS.athlete, IDS.athleteElite], OWNER_ID);
    expect(r.error).toMatch(/roster/);
    expect(writes).toEqual([]);
  });

  it("an assignment writes by org and id list; taking one off touches only rows that advisor holds", async () => {
    // Plant: removed the onlyFrom filter; the unassign had no advisor_id
    // filter.
    const { assignAdvisorForm, unassignAdvisorForm } = await import("@/lib/actions/members");
    const assigned = await run(() => assignAdvisorForm(ORG_WITH_MODULES, OWNER_ID, form({ athleteId: [IDS.athleteNoGpa, IDS.athleteTransfer] })));
    expect(assigned.redirect).toMatch(/notice=/);
    const update = of("athletes", "update")[0];
    expect(update?.rows[0]).toEqual({ advisor_id: OWNER_ID });
    expect(filterValue(update, "org_id")).toBe(BRIDGE_ID());
    expect(filterValue(update, "id")).toEqual([IDS.athleteNoGpa, IDS.athleteTransfer]);

    writes.length = 0;
    await run(() => unassignAdvisorForm(ORG_WITH_MODULES, OWNER_ID, IDS.athleteNoGpa));
    const off = of("athletes", "update")[0];
    expect(off?.rows[0]).toEqual({ advisor_id: null });
    expect(filterValue(off, "advisor_id")).toBe(OWNER_ID);
    expect(filterValue(off, "org_id")).toBe(BRIDGE_ID());
  });

  it("a family login cannot assign advisors", async () => {
    // Plant: removed the role check from setAthleteAdvisor.
    currentUser = FAMILY_ID;
    const { setAthleteAdvisor } = await import("@/lib/actions/members");
    await expect(setAthleteAdvisor(ORG_WITH_MODULES, [IDS.athlete], OWNER_ID)).rejects.toThrow(REDIRECT + "/unauthorized");
    expect(writes).toEqual([]);
  });
});

describe("LAW: a name is changed by its owner or by an org owner, for someone in that org", () => {
  it("an owner renames a member of their org, by id", async () => {
    // Covered by the plants below; this is the shape of a good write.
    const { renameMemberForm } = await import("@/lib/actions/members");
    const r = await run(() => renameMemberForm(ORG_WITH_MODULES, MEMBER_ID, form({ fullName: "  Renamed   Member " })));
    expect(r.redirect).toMatch(/notice=/);
    const update = of("users", "update")[0];
    expect(update?.rows[0]).toEqual({ full_name: "Renamed Member" });
    expect(filterValue(update, "id")).toBe(MEMBER_ID);
  });

  it("an owner cannot rename somebody outside their org", async () => {
    // Plant: dropped the membership read in renameMemberForm; the
    // outsider (Elite staff only) was renamed from Bridge.
    const { renameMemberForm } = await import("@/lib/actions/members");
    const r = await run(() => renameMemberForm(ORG_WITH_MODULES, OUTSIDER_ID, form({ fullName: "Hijacked" })));
    expect(r.redirect).toMatch(/error=/);
    expect(writes).toEqual([]);
  });

  it("an owner cannot rename somebody who also belongs to an org they do not own", async () => {
    // Plant: dropped the other-orgs check in renameMemberForm; the
    // Elite staffer, added to Bridge, was renamed from Bridge while
    // Bridge's owner does not own Elite.
    data.org_members = (data.org_members ?? []).filter((m) => !(m.user_id === OWNER_ID && m.org_id === ELITE_ID()));
    data.org_members.push({ id: "m-probe", user_id: OUTSIDER_ID, org_id: BRIDGE_ID(), role: "member" });
    const { renameMemberForm } = await import("@/lib/actions/members");
    const r = await run(() => renameMemberForm(ORG_WITH_MODULES, OUTSIDER_ID, form({ fullName: "Hijacked" })));
    expect(r.redirect).toMatch(/error=.*another%20organization/);
    expect(writes).toEqual([]);
  });

  it("a member cannot rename anyone, and anyone renames only themselves", async () => {
    currentUser = MEMBER_ID;
    const { renameMemberForm, renameSelfForm } = await import("@/lib/actions/members");
    const r = await run(() => renameMemberForm(ORG_WITH_MODULES, OWNER_ID, form({ fullName: "Nope" })));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);

    // A forged userId on the form is ignored: the row is always the
    // caller's. Plant: read the id from the form; the owner was renamed.
    await run(() => renameSelfForm(ORG_WITH_MODULES, form({ fullName: "Me Myself", userId: OWNER_ID, returnTo: "https://evil.test/" })));
    const update = of("users", "update")[0];
    expect(filterValue(update, "id")).toBe(MEMBER_ID);
  });
});

// ── The org itself ───────────────────────────────────────────────────

describe("LAW: an org is created through create_org and set up by its owner only", () => {
  it("the address is built from the name, and the next free one is taken on a clash", async () => {
    // Plant: tried only the first candidate; the second create with the
    // same name failed instead of landing on -2.
    // The fixture owner owns both fixture orgs and nothing else, so
    // create_org admits them (staff anywhere would be refused).
    const { createOrg } = await import("@/lib/actions/org");
    currentUser = OWNER_ID;
    const before = (data.org_members ?? []).filter((m) => m.user_id === OWNER_ID && m.role === "owner").length;
    const first = await run(() => createOrg({ errors: {} }, form({ name: "New Squad NY" })));
    expect(first.redirect).toMatch(/^\/org\/new-squad-ny\/settings\?notice=/);
    const second = await run(() => createOrg({ errors: {} }, form({ name: "New Squad NY" })));
    expect(second.redirect).toMatch(/^\/org\/new-squad-ny-2\/settings/);
    const owners = (data.org_members ?? []).filter((m) => m.user_id === OWNER_ID && m.role === "owner");
    expect(owners.length).toBe(before + 2);
  });

  it("a typed address that is taken is reported, never renamed", async () => {
    // Plant: ran a typed address through the -2 candidates too and
    // dropped the clash message; the org landed on bridge-fixture-2.
    const { createOrg } = await import("@/lib/actions/org");
    const r = await run(() => createOrg({ errors: {} }, form({ name: "Anything", slug: ORG_WITH_MODULES })));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).slug).toMatch(/taken/);
    expect(of("orgs", "insert")).toEqual([]);
  });

  it("signed out goes to sign in and creates nothing", async () => {
    currentUser = null;
    const { createOrg } = await import("@/lib/actions/org");
    const r = await run(() => createOrg({ errors: {} }, form({ name: "Ghost Org" })));
    expect(r.redirect).toBe("/login");
    expect(writes).toEqual([]);
  });

  it("settings are owner only, written by org id, and keep the core modules as they were", async () => {
    // Plants: requireRole(owner, staff) in place of requireOwner, and
    // the raw switches written without mergeModules. Each failed.
    const { updateOrgSettings } = await import("@/lib/actions/org");
    currentUser = OUTSIDER_ID;
    const staff = await run(() => updateOrgSettings(ORG_WITHOUT_MODULES, { errors: {} }, form({ name: "Taken Over" })));
    expect(staff.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);

    currentUser = OWNER_ID;
    const r = await run(() => updateOrgSettings(ORG_WITH_MODULES, { errors: {} }, form({ name: " Renamed Foundation ", label_owner: "Director", label_staff: "Staff", module_board_governance: "on" })));
    expect(r.redirect).toMatch(/\/more\?notice=/);
    const update = of("orgs", "update")[0];
    expect(filterValue(update, "id")).toBe(BRIDGE_ID());
    expect(update?.rows[0]).toEqual({
      name: "Renamed Foundation",
      role_labels: { owner: "Director" },
      modules: { recruiting: true, doc_ai: true, board_governance: true, donor_fundraising: false },
    });
  });

  it("the rules the screens and the database share", () => {
    // Plant: dropped the accent strip from slugify.
    expect(slugify("Élite Squad & Co., NY")).toBe("elite-squad-and-co-ny");
    expect(slugify("!!")).toBe("");
    expect(isValidSlug("a")).toBe(false);
    expect(isValidSlug("ok-2")).toBe(true);
    expect(isValidSlug("double--hyphen")).toBe(false);
    expect(parseCreateOrgForm(form({ name: "  " })).errors.name).toBeTruthy();
    expect(parseCreateOrgForm(form({ name: "Fine", slug: "Bad Slug" })).errors.slug).toBeTruthy();
    expect(parseOrgSettingsForm(form({ name: "x".repeat(121) })).errors.name).toBeTruthy();
    expect(mergeModules({ recruiting: false, doc_ai: true, board_governance: true, donor_fundraising: true }, { board_governance: false, donor_fundraising: true })).toEqual({
      recruiting: false,
      doc_ai: true,
      board_governance: false,
      donor_fundraising: true,
    });
  });
});

// ── The new screens render ───────────────────────────────────────────

describe("LAW: the new org, member, board and money screens render on the fixture", () => {
  // Also listed for src/testing/pages.ts; asserted here so the group's
  // own screens are proven the moment they exist.
  const P = (o: Record<string, string>) => Promise.resolve(o);
  const screens: Array<{ path: string; props: Record<string, unknown>; expect: RegExp; as?: string }> = [
    { path: "@/app/orgs/new/page", props: {}, expect: /Create an Organization[\s\S]*Web Address/ },
    { path: "@/app/org/[slug]/settings/page", props: { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }, expect: /Organization Settings[\s\S]*Executive Director[\s\S]*Fundraising/ },
    { path: "@/app/org/[slug]/board-governance/[id]/edit/page", props: { params: P({ slug: ORG_WITH_MODULES, id: IDS.board }) }, expect: /Edit Board[\s\S]*Fixture Executive Board[\s\S]*Remove them first/ },
    { path: "@/app/org/[slug]/board-governance/[id]/seats/[memberId]/edit/page", props: { params: P({ slug: ORG_WITH_MODULES, id: IDS.board, memberId: IDS.boardMember }) }, expect: /Edit Seat[\s\S]*Fixture Chair[\s\S]*Remove Seat/ },
    { path: "@/app/org/[slug]/fundraising/donors/[id]/edit/page", props: { params: P({ slug: ORG_WITH_MODULES, id: IDS.donor }), searchParams: P({}) }, expect: /Edit Donor[\s\S]*Fixture Donor[\s\S]*Remove Donor/ },
    { path: "@/app/org/[slug]/fundraising/campaigns/[id]/edit/page", props: { params: P({ slug: ORG_WITH_MODULES, id: IDS.campaign }), searchParams: P({}) }, expect: /Edit Campaign[\s\S]*25000\.00[\s\S]*Remove Campaign/ },
    { path: "@/app/org/[slug]/fundraising/gifts/[id]/edit/page", props: { params: P({ slug: ORG_WITH_MODULES, id: "gf1" }), searchParams: P({}) }, expect: /Edit Gift[\s\S]*5000\.00[\s\S]*Remove Gift/ },
    { path: "@/app/org/[slug]/fundraising/pledges/[id]/edit/page", props: { params: P({ slug: ORG_WITH_MODULES, id: "pl1" }), searchParams: P({}) }, expect: /Edit Pledge[\s\S]*10000\.00[\s\S]*Remove Pledge/ },
    { path: "@/app/org/[slug]/fundraising/grants/[id]/edit/page", props: { params: P({ slug: ORG_WITH_MODULES, id: "gr1" }), searchParams: P({}) }, expect: /Edit Grant[\s\S]*Fixture Trust[\s\S]*Remove Grant/ },
    // The member page's new sections: a staff-side person (the owner,
    // who advises the fixture athletes) and a family login's links.
    { path: "@/app/org/[slug]/members/[userId]/page", props: { params: P({ slug: ORG_WITH_MODULES, userId: OWNER_ID }), searchParams: P({}) }, expect: /Save Name[\s\S]*Athletes They Advise[\s\S]*Fixture Athlete[\s\S]*Assign Ticked Athletes/ },
    { path: "@/app/org/[slug]/members/[userId]/page", props: { params: P({ slug: ORG_WITH_MODULES, userId: FAMILY_ID }), searchParams: P({}) }, expect: /Sees[\s\S]*Fixture Athlete[\s\S]*Save Relationship[\s\S]*Unlink[\s\S]*Change Role/ },
    { path: "@/app/org/[slug]/more/page", props: { params: P({ slug: ORG_WITH_MODULES }) }, expect: /Organization Settings[\s\S]*Your Name/ },
  ];

  for (const s of screens) {
    it(`${s.path.replace("@/app/", "")} renders`, async () => {
      currentUser = s.as ?? OWNER_ID;
      const { renderToStaticMarkup } = await import("react-dom/server");
      const mod = (await import(/* @vite-ignore */ s.path)) as { default: (p: unknown) => Promise<unknown> };
      const html = renderToStaticMarkup((await mod.default(s.props)) as never);
      expect(html).toMatch(s.expect);
    });
  }

  it("a staff member cannot open Organization Settings, and a module left off keeps its edit screens shut", async () => {
    // Plants: the settings page on requireRole(owner, staff); and the
    // module line removed from Edit Gift and from Edit Seat. Each failed.
    currentUser = OUTSIDER_ID;
    const settings = (await import("@/app/org/[slug]/settings/page")) as { default: (p: unknown) => Promise<unknown> };
    await expect(settings.default({ params: P({ slug: ORG_WITHOUT_MODULES }) })).rejects.toThrow(REDIRECT + "/unauthorized");

    // Rows that exist in the org with the modules off, so only the
    // module gate stands between the owner and the edit screen.
    currentUser = OWNER_ID;
    data.gifts!.push({ id: "gf-elite", org_id: ELITE_ID(), donor_id: null, campaign_id: null, pledge_id: null, amount: 50, received_on: "2026-01-01", category: "individual", method: "cash", solicited_by: null });
    data.boards!.push({ id: "board-elite", org_id: ELITE_ID(), name: "Elite Board", kind: "general", sport: null, give_get_amount: 0, min_seats: 1, max_seats: 5 });
    data.board_members!.push({ id: "seat-elite", org_id: ELITE_ID(), board_id: "board-elite", name: "Elite Seat", donor_id: null, user_id: null, role_title: null, status: "prospect", term_start: null, term_end: null, commitment_amount: 0 });
    const gift = (await import("@/app/org/[slug]/fundraising/gifts/[id]/edit/page")) as { default: (p: unknown) => Promise<unknown> };
    await expect(gift.default({ params: P({ slug: ORG_WITHOUT_MODULES, id: "gf-elite" }) })).rejects.toThrow(NOT_FOUND);
    const seat = (await import("@/app/org/[slug]/board-governance/[id]/seats/[memberId]/edit/page")) as { default: (p: unknown) => Promise<unknown> };
    await expect(seat.default({ params: P({ slug: ORG_WITHOUT_MODULES, id: "board-elite", memberId: "seat-elite" }) })).rejects.toThrow(NOT_FOUND);
  });

  it("another org's gift does not open on this org's edit screen", async () => {
    // Plant: dropped .eq("org_id") from the page's gift read.
    const gift = (await import("@/app/org/[slug]/fundraising/gifts/[id]/edit/page")) as { default: (p: unknown) => Promise<unknown> };
    data.gifts!.push({ id: "gf-elite", org_id: ELITE_ID(), donor_id: null, campaign_id: null, pledge_id: null, amount: 50, received_on: "2026-01-01", category: "individual", method: "cash", solicited_by: null });
    await expect(gift.default({ params: P({ slug: ORG_WITH_MODULES, id: "gf-elite" }) })).rejects.toThrow(NOT_FOUND);
  });
});
