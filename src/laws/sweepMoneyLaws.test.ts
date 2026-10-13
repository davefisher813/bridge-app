// The Oct 13 sweep of Fundraising, Board and sign-in: sixteen defects,
// each confirmed in the code, each fixed at its cause, each held here.
//
// Every law below was planted and watched to fail before it was kept:
// the fix reverted (or the old line put back), the law run red, the fix
// restored. The plant is named on each.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { form, orgIdBySlug, run, writesTo } from "@/testing/actionHarness";
import { grantAttention, type GrantDates } from "@/lib/fundraising/grantAttention";
import { safeLocalPath } from "@/lib/auth/safePath";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let failOn: (table: string, op: string) => string | null = () => null;

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
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn, serviceRole: true }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  failOn = () => null;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
});
afterEach(() => {
  vi.useRealTimers();
});

const S = ORG_WITH_MODULES;
const P = <T,>(v: T) => Promise.resolve(v);
const org = () => data.orgs!.find((o) => o.slug === S)! as { modules: Record<string, boolean> };
const donor = (id: string) => data.donors!.find((d) => d.id === id)! as Record<string, unknown>;
const logs = (action?: string) =>
  writesTo(writes, "activity_log", "insert")
    .map((w) => w.rows[0] as Record<string, unknown>)
    .filter((r) => !action || r.action === action);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never).replace(/&amp;/g, "&");
}

const seatPage = (sp: Record<string, string> = {}) =>
  render("@/app/org/[slug]/board-governance/[id]/seats/[memberId]/page", { params: P({ slug: S, id: IDS.board, memberId: IDS.boardMember }), searchParams: P(sp) });
const donorPage = (id: string = IDS.donor) => render("@/app/org/[slug]/fundraising/donors/[id]/page", { params: P({ slug: S, id }), searchParams: P({}) });
const giftsPage = (sp: Record<string, string>) => render("@/app/org/[slug]/fundraising/gifts/page", { params: P({ slug: S }), searchParams: P(sp) });

// ── 1. Grants: Needs Attention ───────────────────────────────────────
// Plant: restored the old filter (any date on or before today, any
// status) and the fallback meta; the declined grant and the "null" line
// came back and both laws failed.
describe("1. a grant needs attention only for the date that applies at its stage", () => {
  const g = (over: Partial<GrantDates>): GrantDates => ({ status: "pending", deadline_on: null, applied_on: null, decision_expected_on: null, report_due_on: null, ...over });
  const T = "2026-10-13";

  it("declined and closed grants never need attention, whatever their dates", () => {
    for (const status of ["declined", "closed"] as const) {
      expect(grantAttention(g({ status, deadline_on: "2026-01-01", decision_expected_on: "2026-02-01", report_due_on: "2026-03-01" }), T)).toBeNull();
    }
  });

  it("an awarded grant needs attention only for a report that is due", () => {
    expect(grantAttention(g({ status: "awarded", deadline_on: "2026-01-01", decision_expected_on: "2026-02-01", report_due_on: "2027-01-31" }), T)).toBeNull();
    expect(grantAttention(g({ status: "awarded", report_due_on: "2026-09-30" }), T)).toEqual({ kind: "report", on: "2026-09-30" });
  });

  it("before a decision: the deadline while unsubmitted, then the decision date; never a future or missing one", () => {
    expect(grantAttention(g({ status: "researching", deadline_on: "2026-10-01" }), T)).toEqual({ kind: "deadline", on: "2026-10-01" });
    expect(grantAttention(g({ status: "applied", applied_on: "2026-09-01", deadline_on: "2026-10-01" }), T)).toBeNull();
    expect(grantAttention(g({ status: "pending", applied_on: "2026-09-01", decision_expected_on: null }), T)).toBeNull();
    expect(grantAttention(g({ status: "pending", applied_on: "2026-09-01", decision_expected_on: "2026-12-01" }), T)).toBeNull();
    expect(grantAttention(g({ status: "pending", applied_on: "2026-09-01", decision_expected_on: "2026-10-01" }), T)).toEqual({ kind: "decision", on: "2026-10-01" });
  });

  it("the Grants screen lists only those, and never prints a missing date", async () => {
    const BRIDGE = orgIdBySlug(data, S);
    const row = (id: string, funder: string, over: Record<string, unknown>) => ({ id, org_id: BRIDGE, funder_name: funder, status: "pending", amount_requested: 1000, amount_awarded: null, deadline_on: null, applied_on: null, decision_expected_on: null, report_due_on: null, created_at: "2026-01-01", ...over });
    data.grants = [
      row("g1", "Declined Trust", { status: "declined", deadline_on: "2026-01-01", decision_expected_on: "2026-02-01" }),
      row("g2", "Submitted Fund", { status: "pending", deadline_on: "2026-01-01", applied_on: "2025-12-01", decision_expected_on: null }),
      row("g3", "Awarded Foundation", { status: "awarded", decision_expected_on: "2026-02-01", report_due_on: "2099-01-31" }),
    ];
    const html = await render("@/app/org/[slug]/fundraising/grants/page", { params: P({ slug: S }) });
    expect(html).not.toContain("Needs Attention");
    expect(html).not.toMatch(/null|undefined/);

    data.grants.push(row("g4", "Late Report Trust", { status: "awarded", report_due_on: "2026-01-31" }));
    const late = text(await render("@/app/org/[slug]/fundraising/grants/page", { params: P({ slug: S }) }));
    expect(late).toMatch(/Needs Attention[\s\S]*Late Report Trust Report was due Jan 31/);
    expect(late.split("All Grants")[0]).not.toContain("Declined Trust");
  });
});

// ── 2. A written-off pledge is not Paid ──────────────────────────────
// Plant: dropped the written_off check on each screen; "Paid" came back.
describe("2. a written-off pledge reads Written Off, never Paid", () => {
  it("on Pledges and on the donor", async () => {
    data.pledges![0].status = "written_off";
    const pledges = text(await render("@/app/org/[slug]/fundraising/pledges/page", { params: P({ slug: S }) }));
    expect(pledges).toContain("Written Off");
    expect(pledges).not.toMatch(/\bPaid\b/);
    const d = text(await donorPage());
    expect(d).toContain("Written Off");
    expect(d).not.toMatch(/\bPaid\b/);
  });
});

// ── 3. A year's total opens that year's gifts ────────────────────────
// Plant: put the bare /fundraising/gifts hrefs back; every link law
// failed. Dropped the year filter in the ledger; the 2025 law failed.
describe("3. year-scoped totals link to a ledger narrowed the same way", () => {
  it("the ledger takes year, donor and by, and says so in the lede", async () => {
    const BRIDGE = orgIdBySlug(data, S);
    data.gifts!.push(
      { id: "gf-2025", org_id: BRIDGE, donor_id: IDS.donor, campaign_id: null, pledge_id: null, amount: 900, received_on: "2025-06-01", category: "board", method: "check", solicited_by: null },
      { id: "gf-brought", org_id: BRIDGE, donor_id: IDS.donorNoSeat, campaign_id: null, pledge_id: null, amount: 300, received_on: "2026-07-01", category: "corporate", method: "check", solicited_by: IDS.boardMember },
    );
    const y2025 = text(await giftsPage({ year: "2025" }));
    expect(y2025).toMatch(/2025 · 1 gift · \$900 cash/);
    const theirs = text(await giftsPage({ donor: IDS.donor, year: "2026" }));
    expect(theirs).toMatch(/Fixture Donor · 2026 · 2 gifts · \$5(,000|K) cash/);
    // Brought In leaves out the seat's own gifts (gf1 is the chair's own
    // and also credited to them), the same way give/get counts it.
    const by = text(await giftsPage({ by: IDS.boardMember, year: "2026" }));
    expect(by).toMatch(/brought in by Fixture Chair · 2026 · 1 gift · \$300 cash/);
  });

  it("the overview, the donor and the seat link with the year (and the donor or seat)", async () => {
    const overview = await render("@/app/org/[slug]/fundraising/page", { params: P({ slug: S }), searchParams: P({}) });
    expect(overview).toContain(`/fundraising/gifts?year=2026"`);
    expect(overview).toContain(`/fundraising/gifts?category=board&year=2026"`);
    const last = await render("@/app/org/[slug]/fundraising/page", { params: P({ slug: S }), searchParams: P({ year: "2025" }) });
    expect(last).toContain(`/fundraising/gifts?year=2025"`);

    const d = await donorPage();
    expect(d).toContain(`/fundraising/gifts?donor=${IDS.donor}&year=2026"`);
    expect(d).toContain(`/fundraising/gifts?donor=${IDS.donor}"`);
    expect(d).not.toContain(`/fundraising/gifts"`);

    const seat = await seatPage({ year: "2025" });
    expect(seat).toContain(`/fundraising/gifts?donor=${IDS.donor}&year=2025"`);
    expect(seat).toContain(`/fundraising/gifts?by=${IDS.boardMember}&year=2025"`);
    expect(seat).not.toContain(`/fundraising/gifts"`);
  });
});

// ── 4. No link into a module that is off ─────────────────────────────
// Plant: removed the module checks; the seat linked into /fundraising
// and the donor into /board-governance.
describe("4. links into another module only when it is on", () => {
  it("a seat with Fundraising off links nowhere in /fundraising", async () => {
    org().modules.donor_fundraising = false;
    const seat = await seatPage();
    expect(seat).toContain("Fixture Chair");
    expect(seat).not.toContain("/fundraising/");
  });

  it("a donor with the Board module off does not link to a seat", async () => {
    org().modules.board_governance = false;
    const d = await donorPage();
    expect(d).toContain("Fixture Donor");
    expect(d).not.toContain("/board-governance/");
  });
});

// ── 5. Editing a seat keeps a removed donor ──────────────────────────
// Plant: put back `.is("deleted_at", null)` on the edit page's donor
// list and on readSeatForm's lookup; the option vanished and the save
// was refused.
describe("5. a seat linked to a removed donor keeps the link through an edit", () => {
  it("the edit screen still offers the seat's donor, and only that removed one", async () => {
    donor(IDS.donor).deleted_at = "2026-09-01T00:00:00Z";
    const BRIDGE = orgIdBySlug(data, S);
    data.donors!.push({ id: "d-gone", org_id: BRIDGE, name: "Someone Else Removed", donor_type: "individual", email: null, deleted_at: "2026-09-01T00:00:00Z" });
    const html = await render("@/app/org/[slug]/board-governance/[id]/seats/[memberId]/edit/page", { params: P({ slug: S, id: IDS.board, memberId: IDS.boardMember }) });
    expect(html).toMatch(new RegExp(`<option[^>]*value="${IDS.donor}"`));
    expect(html).not.toContain("Someone Else Removed");
  });

  it("saving it keeps donor_id; a removed donor still cannot be newly picked", async () => {
    donor(IDS.donor).deleted_at = "2026-09-01T00:00:00Z";
    const { updateBoardSeat, addBoardSeat } = await import("@/lib/actions/governance");
    const r = await run(() => updateBoardSeat(S, IDS.board, IDS.boardMember, { errors: {} }, form({ name: "Fixture Chair", status: "active", donorId: IDS.donor })));
    expect(r.redirect).toMatch(/notice=/);
    expect(writesTo(writes, "board_members", "update")[0]?.rows[0]).toMatchObject({ donor_id: IDS.donor });

    const add = await run(() => addBoardSeat(S, IDS.board, { errors: {} }, form({ name: "New", status: "prospect", donorId: IDS.donor })));
    expect((add.state as { errors: Record<string, string> }).errors.donorId).toMatch(/not in this organization/);
    const other = await run(() => updateBoardSeat(S, IDS.board, "bm2", { errors: {} }, form({ name: "Fixture Prospect", status: "prospect", donorId: IDS.donor })));
    expect((other.state as { errors: Record<string, string> }).errors.donorId).toMatch(/not in this organization/);
  });
});

// ── 6. No link to a removed donor ────────────────────────────────────
// Plant: dropped the removed-donor checks; the campaign and seat rows
// linked to a donor page that is Not Found.
describe("6. a removed donor shows by name and links nowhere", () => {
  it("on the campaign, the seat and the ledger", async () => {
    donor(IDS.donor).deleted_at = "2026-09-01T00:00:00Z";
    const campaign = await render("@/app/org/[slug]/fundraising/campaigns/[id]/page", { params: P({ slug: S, id: IDS.campaign }) });
    expect(campaign).toContain("Fixture Donor");
    expect(campaign).not.toContain(`/fundraising/donors/${IDS.donor}`);

    const seat = await seatPage();
    expect(seat).not.toContain(`/fundraising/donors/${IDS.donor}`);
    expect(seat).not.toContain("Their Donor Record");

    const ledger = await giftsPage({});
    expect(ledger).toContain("Fixture Donor");
    expect(ledger).not.toContain(`/fundraising/donors/${IDS.donor}`);
  });
});

// ── 7. No open redirect ──────────────────────────────────────────────
// Plant: put back `startsWith("/") && !startsWith("//")`; "/\evil.com"
// passed and the callback redirected to https://evil.com.
describe("7. a next or return path stays on this site", () => {
  const evil = ["/\\evil.com", "//evil.com", "/%5Cevil.com", "/%5C%5Cevil.com", "/\t/evil.com", "/%2F/evil.com", "https://evil.com", "evil.com", "/\\/evil.com"];

  it.each(evil)("refuses %j", (v) => {
    expect(safeLocalPath(v)).toBe("/");
  });

  it("keeps an ordinary path, query and all", () => {
    expect(safeLocalPath("/org/bridge/fundraising?year=2025")).toBe("/org/bridge/fundraising?year=2025");
    expect(safeLocalPath(null)).toBe("/");
  });

  it.each(evil)("the sign-in callback lands on this site for %j", async (v) => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/auth/callback/route");
    const req = new NextRequest(`https://app.example.test/auth/callback?token_hash=ok&type=magiclink&next=${encodeURIComponent(v)}`);
    const res = await GET(req);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://app.example.test");
    expect(to.pathname).toBe("/");
  });

  it("set-password returns only to a path on this site", async () => {
    const { setPasswordForm } = await import("@/lib/auth/actions");
    const r = await run(() => setPasswordForm("/\\evil.com", form({ password: "short", confirm: "short" })));
    expect(r.redirect).toMatch(/^\/\?error=/);
  });
});

// ── 8. One label for a gift method ───────────────────────────────────
// Plant: put back g.method on the donor page; "stripe" printed raw. Put
// back the form's own table; "Stripe" and "Card" disagreed.
describe("8. a gift's method reads the same on every screen and the form", () => {
  it("the form's table is the ledger's", async () => {
    const rollup = await import("@/lib/fundraising/rollup");
    const validation = await import("@/lib/validation/gift");
    expect(validation.METHOD_LABEL).toEqual(rollup.METHOD_LABEL);
    expect(rollup.METHOD_LABEL.stripe).toBe("Card");
  });

  it("the donor page prints the label, not the stored value", async () => {
    data.gifts!.find((g) => g.id === "gf1")!.method = "stripe";
    const d = text(await donorPage());
    expect(d).toContain("Card");
    expect(d).not.toMatch(/\bstripe\b/);
  });
});

// ── 9. Title Case ────────────────────────────────────────────────────
// Plant: put back each lower-case title; each check failed.
describe("9. titles are Title Case", () => {
  it("the seat's unlink confirm and its Brought In rows", async () => {
    const src = readFileSync("src/app/org/[slug]/board-governance/[id]/seats/[memberId]/page.tsx", "utf8");
    expect(src).toContain('title="Unlink This Sign-In?"');
    expect(src).not.toContain('"Brought in"');
    const BRIDGE = orgIdBySlug(data, S);
    data.gifts!.push({ id: "gf-brought", org_id: BRIDGE, donor_id: IDS.donorNoSeat, campaign_id: null, pledge_id: null, amount: 300, received_on: "2026-07-01", category: "corporate", method: "check", solicited_by: IDS.boardMember });
    const seat = await seatPage();
    expect(seat).toMatch(/>Brought In</);
    expect(seat).not.toMatch(/>Brought in</);
  });

  it("Awaiting Decision, on the grants chip and the grant form", async () => {
    expect(await render("@/app/org/[slug]/fundraising/grants/page", { params: P({ slug: S }) })).toContain("Awaiting Decision");
    for (const f of ["src/app/org/[slug]/fundraising/grants/page.tsx", "src/components/FundraisingForms.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toContain("Awaiting decision");
    }
  });
});

// ── 10. No goal, no "of $0" ──────────────────────────────────────────
// Plant: put back `{raised} of {goal}`; the campaign read "of $0".
describe("10. a campaign with no goal does not read 'of $0'", () => {
  it("on the campaign screen", async () => {
    data.campaigns![0].goal_amount = null;
    const html = text(await render("@/app/org/[slug]/fundraising/campaigns/[id]/page", { params: P({ slug: S, id: IDS.campaign }) }));
    expect(html).not.toMatch(/of \$0\b/);
    expect(html).toContain("raised");
  });
});

// ── 11. Budget save returns to its year ──────────────────────────────
// Plant: put back the bare /fundraising redirect.
describe("11. saving a year's budget returns to that year", () => {
  it("redirects with ?year=", async () => {
    const { setBudget } = await import("@/lib/actions/fundraising");
    const r = await run(() => setBudget(S, 2027, { errors: {} }, form({ budget_board: "1000" })));
    expect(r.redirect).toBe(`/org/${S}/fundraising?year=2027`);
  });
});

// ── 12. Edit Gift keeps Brought In By when the field is not shown ────
// Plant: wrote giftRow(v) whole again; solicited_by went out as null.
describe("12. an edit without the Brought In By field keeps the stored credit", () => {
  const giftForm = (over: Record<string, string> = {}) => form({ amount: "50", receivedOn: "2026-03-01", category: "board", method: "check", donorId: IDS.donor, ...over });

  it("absent: the column is not written", async () => {
    const { updateGift } = await import("@/lib/actions/fundraising");
    await run(() => updateGift(S, "gf1", { errors: {} }, giftForm()));
    const row = writesTo(writes, "gifts", "update")[0]?.rows[0] as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("solicited_by");
    expect(data.gifts!.find((g) => g.id === "gf1")!.solicited_by).toBe(IDS.boardMember);
  });

  it("present and blank: cleared, because somebody chose that", async () => {
    const { updateGift } = await import("@/lib/actions/fundraising");
    await run(() => updateGift(S, "gf1", { errors: {} }, giftForm({ solicitedBy: "" })));
    expect(writesTo(writes, "gifts", "update")[0]?.rows[0]).toMatchObject({ solicited_by: null });
  });
});

// ── 13. Meeting materials are read by id ─────────────────────────────
// Plant: put back the lookup through the newest-200 list; both attached
// documents vanished once 200 newer ones existed.
describe("13. a meeting shows every attached document, however old", () => {
  it("with 200 newer documents in the vault", async () => {
    const base = data.documents!.find((d) => d.id === "doc-word")!;
    for (let i = 0; i < 205; i++) data.documents!.push({ ...base, id: `bulk-${i}`, file_name: `bulk-${i}.pdf`, created_at: "2099-01-01T00:00:00Z" });
    const html = await render("@/app/org/[slug]/board-governance/meetings/[meetingId]/page", { params: P({ slug: S, meetingId: IDS.meetingUpcoming }), searchParams: P({}) });
    expect(html).toMatch(/Materials[\s\S]*team-letter\.docx[\s\S]*roster-export\.csv/);
  });
});

// ── 14. The year is the org's, not UTC's ─────────────────────────────
// Plant: put back new Date().toISOString()/getFullYear(); at 9pm on New
// Year's Eve in New York the screens jumped to next year.
describe("14. on New Year's Eve evening the year is still this one", () => {
  it("the donor's This Year and the budget screen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T02:00:00Z"));
    const d = await donorPage();
    expect(d).toContain(`&year=2026"`);
    const budget = text(await render("@/app/org/[slug]/fundraising/budget/page", { params: P({ slug: S }), searchParams: P({}) }));
    expect(budget).toContain("2026 Budget");
  });
});

// ── 15. A full board can still take a prospect ───────────────────────
// Plant: put back `!summary.atCapacity` on both Add controls.
describe("15. a full board keeps Add, for a prospect", () => {
  it("the screen offers it and the server takes it", async () => {
    data.boards!.find((b) => b.id === IDS.board)!.max_seats = 1;
    const html = await render("@/app/org/[slug]/board-governance/[id]/page", { params: P({ slug: S, id: IDS.board }), searchParams: P({}) });
    expect(html).toContain(`/board-governance/${IDS.board}/seats/new"`);
    expect(text(html)).toContain("Only a Prospect can be added while it is full");
    const { addBoardSeat } = await import("@/lib/actions/governance");
    const r = await run(() => addBoardSeat(S, IDS.board, { errors: {} }, form({ name: "New Prospect", status: "prospect" })));
    expect(r.redirect).toBe(`/org/${S}/board-governance/${IDS.board}`);
  });
});

// ── 16. Authority side effects: after the change, and on the record ──
// Plants: moved the clears back above the role update (the failed-link
// law failed); dropped the seat clear from removeMember (the seat law
// failed); dropped the steward clear (both steward laws failed).
describe("16. what a demotion or removal takes away goes only once it happens, each loss logged", () => {
  const athlete = () => data.athletes!.find((a) => a.id === IDS.athlete)!;
  const seat = () => data.board_members!.find((m) => m.id === IDS.boardMember)!;

  beforeEach(() => {
    // The fixture member, given everything a person can lose here: an
    // athlete they advise, the chair's seat (already theirs), a donor
    // they steward.
    athlete().advisor_id = MEMBER_ID;
    donor(IDS.donor).steward_user_id = MEMBER_ID;
  });

  it("a failed athlete link takes nothing away and logs nothing", async () => {
    failOn = (table, op) => (table === "athlete_guardians" && op === "insert" ? "link refused" : null);
    const { changeMemberRole } = await import("@/lib/actions/members");
    const r = await changeMemberRole(S, MEMBER_ID, "family", { athleteId: IDS.athlete });
    expect(r.ok).toBe(false);
    expect(athlete().advisor_id).toBe(MEMBER_ID);
    expect(seat().user_id).toBe(MEMBER_ID);
    expect(donor(IDS.donor).steward_user_id).toBe(MEMBER_ID);
    expect(writesTo(writes, "athletes", "update")).toEqual([]);
    expect(writesTo(writes, "board_members", "update")).toEqual([]);
    expect(writesTo(writes, "donors", "update")).toEqual([]);
    expect(logs()).toEqual([]);
  });

  it("becoming an Athlete clears advising, the seat and stewarding, one row each", async () => {
    const { changeMemberRole } = await import("@/lib/actions/members");
    expect((await changeMemberRole(S, MEMBER_ID, "family", { athleteId: IDS.athlete })).ok).toBe(true);
    expect(athlete().advisor_id).toBeNull();
    expect(seat().user_id).toBeNull();
    expect(donor(IDS.donor).steward_user_id).toBeNull();
    expect(logs("advisor_cleared").map((r) => r.subject_id)).toEqual([IDS.athlete]);
    expect(logs("seat_unlinked").map((r) => r.subject_id)).toEqual([IDS.boardMember]);
    expect(logs("steward_cleared").map((r) => r.subject_id)).toEqual([IDS.donor]);
  });

  it("an Admin made a Viewer stops stewarding, logged", async () => {
    const { changeMemberRole } = await import("@/lib/actions/members");
    expect((await changeMemberRole(S, MEMBER_ID, "owner")).ok).toBe(true);
    writes.length = 0;
    expect((await changeMemberRole(S, MEMBER_ID, "member")).ok).toBe(true);
    expect(donor(IDS.donor).steward_user_id).toBeNull();
    expect(logs("steward_cleared").map((r) => r.subject_id)).toEqual([IDS.donor]);
  });

  it("removal clears the seat's sign-in and the stewardship, each logged", async () => {
    const { removeMember } = await import("@/lib/actions/members");
    expect((await removeMember(S, MEMBER_ID)).ok).toBe(true);
    expect(seat().user_id).toBeNull();
    expect(donor(IDS.donor).steward_user_id).toBeNull();
    expect(athlete().advisor_id).toBeNull();
    expect(logs("seat_unlinked").map((r) => r.subject_id)).toEqual([IDS.boardMember]);
    expect(logs("steward_cleared").map((r) => r.subject_id)).toEqual([IDS.donor]);
    expect(logs("advisor_cleared").map((r) => r.subject_id)).toEqual([IDS.athlete]);
  });
});
