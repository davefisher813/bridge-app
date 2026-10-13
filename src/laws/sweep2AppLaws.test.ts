// The second app sweep (2026-10-13): eleven defects left after the first
// sweep, across scoring, eligibility, matching, the school import, the
// transcript, Today, check-ins, Add Athlete, pledges, the seat card and
// the draft year. Each law below failed against the code as it was and
// passes against the fix; every one was planted back (the pre-fix
// source checked out over the fix) and watched to fail before this was
// committed.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { errorsOf, form, run } from "@/testing/actionHarness";
import { checkinAuthorName, CHECKIN_AUTHOR_GONE } from "@/lib/checkins";
import { titleCase } from "@/lib/copy/titleCase";
import { orgToday } from "@/lib/datetime/today";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let revalidated: string[] = [];
let failOn: (table: string, op: string) => string | null = () => null;

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));
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
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  revalidated = [];
  failOn = () => null;
});

afterEach(() => {
  vi.useRealTimers();
});

const SRC = join(process.cwd(), "src");
const source = (p: string) => readFileSync(join(SRC, p), "utf8");

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}
const params = (v: Record<string, unknown>) => Promise.resolve(v);
const bridgeId = () => data.orgs!.find((o) => o.slug === ORG_WITH_MODULES)!.id as string;
const athlete = (id: string) => data.athletes!.find((a) => a.id === id)!;

// ---------------------------------------------------------------------------
// 1. A placed or Inactive athlete has no score, even by direct URL with
// nothing stored.

describe("LAW: a fit dimension opened by URL never scores a placed or Inactive athlete", () => {
  const dimPage = "@/app/org/[slug]/board/[id]/dimensions/[dim]/page";

  it("a Committed athlete's dimension says No Score While Placed, with no stored fit to fall back on", async () => {
    data.athlete_school_fits = [];
    const html = await render(dimPage, { params: params({ slug: ORG_WITH_MODULES, id: IDS.targetCommitted, dim: "academic" }) });
    expect(html).toContain("No Score While Placed");
    expect(html).not.toMatch(/How Sure/);
  });

  it("an Inactive athlete's says No Score While Inactive", async () => {
    data.athlete_school_fits = [];
    athlete(IDS.athlete).status = "Inactive";
    const html = await render(dimPage, { params: params({ slug: ORG_WITH_MODULES, id: IDS.target, dim: "academic" }) });
    expect(html).toContain("No Score While Inactive");
    expect(html).not.toMatch(/How Sure/);
  });

  it("loadTarget returns no fit for them, and still scores an Active athlete", async () => {
    data.athlete_school_fits = [];
    const { loadTarget } = await import("@/lib/data/loadTarget");
    expect((await loadTarget(bridgeId(), IDS.targetCommitted))?.fit).toBeNull();
    expect((await loadTarget(bridgeId(), IDS.target))?.fit?.score).toEqual(expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// 2. Targets that are all outside the NCAA.

describe("LAW: eligibility with only non-NCAA targets says no NCAA standard applies, not that there are no targets", () => {
  it("every target NAIA", async () => {
    for (const s of data.schools!) s.division = "NAIA";
    const html = await render("@/app/org/[slug]/roster/[id]/eligibility/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(html).toContain("No NCAA Standard Applies");
    expect(html).not.toContain("No Target Schools Yet");
  });

  it("no targets at all still says No Target Schools Yet", async () => {
    data.recruiting_targets = data.recruiting_targets!.filter((t) => t.athlete_id !== IDS.athlete);
    const html = await render("@/app/org/[slug]/roster/[id]/eligibility/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(html).toContain("No Target Schools Yet");
  });
});

// ---------------------------------------------------------------------------
// 3. Add to Board on a pair already on the board.

describe("LAW: Add to Board on a pair that already has a target lands on that target", () => {
  it("lands on the existing target and makes no second one", async () => {
    const { addMatchToBoard } = await import("@/lib/actions/matching");
    const before = data.recruiting_targets!.length;
    const r = await run(() => addMatchToBoard(ORG_WITH_MODULES, IDS.athlete, IDS.school));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/board/${IDS.target}`);
    expect(data.recruiting_targets!.length).toBe(before);
    expect(writes.filter((w) => w.table === "recruiting_targets" && w.op === "insert")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. An import that stops part way.

describe("LAW: a school import stopped by a database error rescores what it wrote and says how many", () => {
  it("one school written, the second refused", async () => {
    const header = readFileSync("public/templates/schools.csv", "utf8").split("\n")[0];
    const existing = "Fixture State University,D2,d2_naia,Fixture Conference,CT,baseball,2.7,3.3,1100-1300,22-27,partial,9500,6000,11000,32000,39000,3,competitive,Business,Fixture Coach,coach@fixture-state.test,MIF 2027,";
    const fresh = "Brand New College,D3,,Fixture League,NY,baseball,3.0,3.4,1150-1350,24-29,none,0,9000,20000,60000,60000,2,competitive,Biology,New Coach,coach@new.test,C 2027,";
    const fd = new FormData();
    fd.append("file", new File([`${header}\n${existing}\n${fresh}\n`], "schools.csv", { type: "text/csv" }));
    failOn = (table, op) => (table === "schools" && op === "insert" ? "fixture: insert refused" : null);
    const { importSchools } = await import("@/lib/actions/schools");
    const r = await run(() => importSchools(ORG_WITH_MODULES, { errors: {}, problems: [] }, fd));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toMatch(/^1 of 2 schools were saved before the import stopped: fixture: insert refused$/);
    const rescored = writes.filter((w) => w.table === "athlete_school_fits" && w.op === "upsert").flatMap((w) => w.rows as { school_id: string }[]);
    expect(rescored.some((u) => u.school_id === IDS.school)).toBe(true);
    expect(revalidated).toContain(`/org/${ORG_WITH_MODULES}/schools`);
  });
});

// ---------------------------------------------------------------------------
// 5. Two courses, one title, one term.

describe("LAW: the transcript shows each course its own result, keyed by the course's id", () => {
  it("two English 11 rows in the same term show their own points", async () => {
    const ac1 = data.athlete_courses!.find((c) => c.id === "ac1")!;
    data.athlete_courses!.push({ ...ac1, id: "ac3", grade: "A" });
    const html = await render("@/app/org/[slug]/roster/[id]/transcript/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    const rowOf = (id: string) => html.slice(html.indexOf(`/transcript/${id}"`), html.indexOf("</a>", html.indexOf(`/transcript/${id}"`)));
    expect(rowOf("ac1")).toMatch(/>B<[\s\S]*3\.0 pts/);
    expect(rowOf("ac3")).toMatch(/>A<[\s\S]*4\.0 pts/);
  });
});

// ---------------------------------------------------------------------------
// 6. Today's Needs Follow-Up count.

describe("LAW: Today counts every follow-up, and shows the first few", () => {
  it("ten open targets count as ten or more, not the eight shown", async () => {
    for (let i = 0; i < 10; i++) {
      data.recruiting_targets!.push({ ...data.recruiting_targets!.find((t) => t.id === IDS.target)!, id: `t-extra-${i}`, school_id: `school-extra-${i}`, updated_at: `2026-08-0${(i % 9) + 1}` });
    }
    const html = await render("@/app/org/[slug]/page", { params: params({ slug: ORG_WITH_MODULES }) });
    const m = html.match(/Needs Follow-Up<\/span><span[^>]*><\/span><span[^>]*>(\d+)<\/span>/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(11);
    expect(source("app/org/[slug]/page.tsx")).toMatch(/count=\{followUpCount\}/);
  });
});

// ---------------------------------------------------------------------------
// 7. Who logged a check-in.

describe("LAW: a check-in's author reads the same on the log, the check-in and the Advisor Hub", () => {
  it("one helper: the staff name, or Someone Who Left", () => {
    expect(checkinAuthorName([{ id: "a", name: "Ann Advisor" }], "a")).toBe("Ann Advisor");
    expect(checkinAuthorName([{ id: "a", name: "Ann Advisor" }], "gone")).toBe(CHECKIN_AUTHOR_GONE);
    expect(checkinAuthorName([], null)).toBe("Someone Who Left");
    for (const f of ["app/org/[slug]/roster/[id]/checkins/page.tsx", "app/org/[slug]/roster/[id]/checkins/[checkinId]/page.tsx", "app/org/[slug]/advisor-hub/page.tsx"]) {
      expect(source(f), f).toMatch(/checkinAuthorName\(/);
      expect(source(f), f).not.toMatch(/someone who left/i);
    }
  });

  it("an author no longer on the staff is Someone Who Left on all three screens, never their name", async () => {
    const today = orgToday();
    athlete(IDS.athlete).advisor_id = OWNER_ID;
    data.athlete_checkins = [{ id: "ck-gone", org_id: bridgeId(), athlete_id: IDS.athlete, advisor_id: MEMBER_ID, kind: "call", occurred_on: today, notes: null, photo_path: null, created_at: `${today}T12:00:00.000Z` }];
    const log = await render("@/app/org/[slug]/roster/[id]/checkins/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    const one = await render("@/app/org/[slug]/roster/[id]/checkins/[checkinId]/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athlete, checkinId: "ck-gone" }) });
    const hub = await render("@/app/org/[slug]/advisor-hub/page", { params: params({ slug: ORG_WITH_MODULES }), searchParams: params({}) });
    for (const [name, html] of [["log", log], ["check-in", one], ["hub", hub]] as const) {
      expect(html, name).toContain("Someone Who Left");
      expect(html, name).not.toContain("Example Member");
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Add Athlete with a measurement that would not save.

describe("LAW: an athlete added without their measurement refreshes the roster and says what was not saved", () => {
  it("revalidates and names the measurement", async () => {
    failOn = (table, op) => (table === "athlete_metrics" && op === "insert" ? "fixture: metric refused" : null);
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() =>
      createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Measured Athlete", sport: "baseball", recruitType: "hs", status: "Active", metric_fbVelo: "86", metricsMeasuredOn: "2026-08-15", metricsSource: "pbr" })),
    );
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toMatch(/^Measured Athlete was added, but the measurement was not saved: fixture: metric refused\./);
    const created = data.athletes!.find((a) => a.name === "Measured Athlete")!;
    expect(revalidated).toContain(`/org/${ORG_WITH_MODULES}/roster`);
    expect(revalidated).toContain(`/org/${ORG_WITH_MODULES}/roster/${created.id}`);
  });
});

// ---------------------------------------------------------------------------
// 9. A pledge brought in by a seat.

describe("LAW: a pledge records the seat that brought it in, and an edit without the field keeps it", () => {
  const pledgeWrite = (op: RecordedWrite["op"]) => writes.find((w) => w.table === "pledges" && w.op === op);

  it("Add Pledge writes solicited_by", async () => {
    const { recordPledge } = await import("@/lib/actions/fundraising");
    await run(() => recordPledge(ORG_WITH_MODULES, { errors: {} }, form({ donorId: IDS.donor, amount: "500", promisedOn: "2026-09-01", solicitedBy: IDS.boardMember })));
    expect(pledgeWrite("insert")?.rows[0]).toMatchObject({ solicited_by: IDS.boardMember });
  });

  it("a seat from outside the org is refused", async () => {
    const { recordPledge } = await import("@/lib/actions/fundraising");
    const r = await run(() => recordPledge(ORG_WITH_MODULES, { errors: {} }, form({ donorId: IDS.donor, amount: "500", promisedOn: "2026-09-01", solicitedBy: "not-a-seat" })));
    expect(errorsOf(r.state).solicitedBy).toMatch(/not in this organization/);
    expect(pledgeWrite("insert")).toBeUndefined();
  });

  it("Edit Pledge sets it when the field is on the form, and leaves it alone when it is not", async () => {
    const { updatePledge } = await import("@/lib/actions/fundraising");
    await run(() => updatePledge(ORG_WITH_MODULES, "pl1", { errors: {} }, form({ donorId: IDS.donor, amount: "10000", promisedOn: "2026-01-15", solicitedBy: IDS.boardMember })));
    expect(pledgeWrite("update")?.rows[0]).toMatchObject({ solicited_by: IDS.boardMember });
    writes.length = 0;
    await run(() => updatePledge(ORG_WITH_MODULES, "pl1", { errors: {} }, form({ donorId: IDS.donor, amount: "10000", promisedOn: "2026-01-15" })));
    expect(pledgeWrite("update")?.rows[0]).not.toHaveProperty("solicited_by");
    expect(data.pledges!.find((p) => p.id === "pl1")!.solicited_by).toBe(IDS.boardMember);
  });

  it("the pledge forms offer Brought in By with the Board module on, the stored seat selected, and not with it off", async () => {
    const add = await render("@/app/org/[slug]/fundraising/pledges/new/page", { params: params({ slug: ORG_WITH_MODULES }) });
    expect(add).toMatch(/name="solicitedBy"[\s\S]*Fixture Chair, Fixture Executive Board/);
    data.pledges!.find((p) => p.id === "pl1")!.solicited_by = IDS.boardMember;
    const edit = await render("@/app/org/[slug]/fundraising/pledges/[id]/edit/page", { params: params({ slug: ORG_WITH_MODULES, id: "pl1" }), searchParams: params({}) });
    expect(edit).toMatch(new RegExp(`<option value="${IDS.boardMember}" selected="">`));
    data.orgs!.find((o) => o.slug === ORG_WITH_MODULES)!.modules = { board_governance: false, donor_fundraising: true };
    const off = await render("@/app/org/[slug]/fundraising/pledges/new/page", { params: params({ slug: ORG_WITH_MODULES }) });
    expect(off).not.toContain('name="solicitedBy"');
  });
});

// ---------------------------------------------------------------------------
// 10. The seat card's line titles.

describe("LAW: the seat card's line titles are Title Case", () => {
  it("every label in its list of lines", () => {
    const src = source("components/SeatCard.tsx");
    const labels = [...src.matchAll(/\[\s*"([^"]+)",\s*formatMoney/g)].map((m) => m[1]!);
    expect(labels.length).toBeGreaterThanOrEqual(5);
    for (const l of labels) expect(l).toBe(titleCase(l));
    expect(src).not.toContain('"Your seat"');
  });
});

// ---------------------------------------------------------------------------
// 11. "This year" is the org's year.

describe("LAW: this year is the org's calendar year, never the server clock's", () => {
  it("Mark Drafted defaults to the org's year on New Year's Eve evening", async () => {
    // 11:30pm Dec 31 in New York is already Jan 1 on a UTC server.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-01T04:30:00.000Z"));
    expect(orgToday()).toBe("2026-12-31");
    const html = await render("@/app/org/[slug]/roster/[id]/draft/page", { params: params({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(html).toMatch(/name="draftYear" value="2026"/);
  });

  it("no screen or library reads the year off the server clock", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const src = readFileSync(p, "utf8");
          if (/new Date\(\)\.getFullYear\(\)|new Date\(\)\.toISOString\(\)\.slice\(0,\s*4\)/.test(src)) offenders.push(p.slice(SRC.length + 1));
        }
      }
    };
    walk(join(SRC, "app"));
    walk(join(SRC, "lib"));
    walk(join(SRC, "components"));
    expect(offenders).toEqual([]);
  });
});

