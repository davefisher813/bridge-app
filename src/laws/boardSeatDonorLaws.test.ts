// Board seats to donor records (Oct 13). Every seat on the board was
// unlinked, so the board read $0 given and 0% of give/get while the
// gifts sat on the donors. A seat whose name is exactly one donor's is
// offered as one confirmed step on the board page; anything ambiguous is
// left for a person to pick on the seat.
//
// Held to: the matcher links only an exact, single match; the action
// writes donor_id under the caller's org and only onto a seat that has
// none, logs one activity row per seat, refuses a Viewer, never reaches
// another org's donor; the page offers it behind a confirm.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { filterColumns, orgIdBySlug, run, writesTo } from "@/testing/actionHarness";
import { matchSeatsToDonors } from "@/lib/governance/seatDonors";

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

const S = ORG_WITH_MODULES;
const BRIDGE = () => orgIdBySlug(data, ORG_WITH_MODULES);
const ELITE = () => orgIdBySlug(data, ORG_WITHOUT_MODULES);

describe("matching seats to donors", () => {
  it("links a seat whose name is exactly one donor's, ignoring case, accents and punctuation", () => {
    const m = matchSeatsToDonors([{ id: "s1", name: "José  O'Neil", donorId: null }], [{ id: "d1", name: "jose oneil" }, { id: "d2", name: "Jose O Neil" }]);
    // "O'Neil" and "O Neil" both read as "o neil"; "oneil" does not.
    expect(m).toEqual([{ seatId: "s1", seatName: "José  O'Neil", donorId: "d2", donorName: "Jose O Neil" }]);
  });

  it("leaves a seat alone when two donors share its name, or none does", () => {
    const donors = [
      { id: "d1", name: "Pat Lee" },
      { id: "d2", name: "Pat Lee" },
      { id: "d3", name: "Sam Roe" },
    ];
    expect(matchSeatsToDonors([{ id: "s1", name: "Pat Lee", donorId: null }], donors)).toEqual([]);
    expect(matchSeatsToDonors([{ id: "s2", name: "Kim Doe", donorId: null }], donors)).toEqual([]);
  });

  it("never touches a seat that already has a donor record", () => {
    expect(matchSeatsToDonors([{ id: "s1", name: "Sam Roe", donorId: "dX" }], [{ id: "d3", name: "Sam Roe" }])).toEqual([]);
  });
});

describe("linkSeatsToDonorsByName", () => {
  const addDonor = (orgId: string, id: string, name: string) => data.donors!.push({ id, org_id: orgId, name, donor_type: "individual", email: null, deleted_at: null });

  it("writes donor_id onto the matched seat, scoped by id, org and an empty donor_id, and logs it", async () => {
    addDonor(BRIDGE(), "dProspect", "Fixture Prospect");
    const { linkSeatsToDonorsByName } = await import("@/lib/actions/governance");
    const r = await run(() => linkSeatsToDonorsByName(S, IDS.board));
    expect(r.redirect).toContain("notice=");
    expect(decodeURIComponent(r.redirect!)).toContain("Linked 1 seat to its donor record.");
    const ups = writesTo(writes, "board_members", "update");
    expect(ups).toHaveLength(1);
    expect(ups[0]!.rows[0]).toMatchObject({ donor_id: "dProspect" });
    expect(filterColumns(ups[0])).toEqual(["donor_id", "id", "org_id"]);
    const logs = writesTo(writes, "activity_log", "insert");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.rows[0]).toMatchObject({ action: "board_seat_donor_linked", subject_type: "seat", subject_id: "bm2", org_id: BRIDGE() });
    expect(data.board_members!.find((b) => b.id === "bm2")!.donor_id).toBe("dProspect");
  });

  it("refuses a Viewer before any write", async () => {
    addDonor(BRIDGE(), "dProspect", "Fixture Prospect");
    currentUser = MEMBER_ID;
    const { linkSeatsToDonorsByName } = await import("@/lib/actions/governance");
    await run(() => linkSeatsToDonorsByName(S, IDS.board)).catch(() => null);
    expect(writesTo(writes, "board_members")).toHaveLength(0);
    expect(writesTo(writes, "activity_log")).toHaveLength(0);
  });

  it("never links to another org's donor of the same name", async () => {
    addDonor(ELITE(), "dElite", "Fixture Prospect");
    const { linkSeatsToDonorsByName } = await import("@/lib/actions/governance");
    const r = await run(() => linkSeatsToDonorsByName(S, IDS.board));
    expect(decodeURIComponent(r.redirect!)).toContain("No seat matches exactly one donor by name.");
    expect(writesTo(writes, "board_members")).toHaveLength(0);
  });
});

describe("the board page offers it behind a confirm", () => {
  const src = readFileSync("src/app/org/[slug]/board-governance/[id]/page.tsx", "utf8");
  it("runs the link through a ConfirmButton labelled Link Them, never a bare button", () => {
    expect(src).toMatch(/<ConfirmButton\b[^\n]*title="Link These Seats to Their Donor Records\?"[^\n]*confirmLabel="Link Them"/);
    expect(src).toContain("linkSeatsToDonorsByName(slug, id)");
  });
});

// Linked seats still read $0 when the gifts are last year's and the
// screen can only show this one (Oct 13: every Bridge gift is 2024 or
// 2025). Every give/get screen and the Fundraising overview can step
// back a year, and the year is the org's, not the server's UTC clock.
describe("give/get screens can show another year", () => {
  const pages = [
    "src/app/org/[slug]/board-governance/page.tsx",
    "src/app/org/[slug]/board-governance/[id]/page.tsx",
    "src/app/org/[slug]/board-governance/members/page.tsx",
    "src/app/org/[slug]/board-governance/[id]/seats/[memberId]/page.tsx",
    "src/app/org/[slug]/fundraising/page.tsx",
  ];
  it.each(pages)("%s renders a YearSwitch and takes the year from the org's day", (p) => {
    const src = readFileSync(p, "utf8");
    expect(src).toContain("<YearSwitch ");
    expect(src).not.toContain("new Date().getFullYear()");
  });
});
