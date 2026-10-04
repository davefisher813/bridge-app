// The six findings of the 2026-10-01 production QA that were code, held so
// they cannot come back. (Two more were the second Dave Fisher account,
// which was data, and the date default, which src/laws/dateLaws.test.ts
// holds.)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID, FAMILY_ID, MEMBER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset } from "@/testing/fakeSupabase";

let currentUser: string | null = OWNER_ID;
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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: currentUser }) }));

beforeEach(() => {
  currentUser = OWNER_ID;
  data = buildFixture();
});

async function html(modulePath: string, props: unknown): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = await import(/* @vite-ignore */ modulePath);
  return renderToStaticMarkup(await mod.default(props));
}

const BRIDGE_ORG = "00000000-0000-0000-0000-0000000000a1";
const params = (extra: Record<string, string> = {}) => Promise.resolve({ slug: ORG_WITH_MODULES, ...extra });
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("Invite Athlete is offered once on an athlete's page", () => {
  const ATHLETE_PAGE = "@/app/org/[slug]/roster/[id]/page";
  const link = (id: string) => `/org/${ORG_WITH_MODULES}/roster/${id}/family/new`;

  it("with no athlete login yet: once, in the empty state", async () => {
    const out = await html(ATHLETE_PAGE, { params: params({ id: IDS.athleteTransfer }), searchParams: Promise.resolve({}) });
    expect(out).toMatch(/No Athlete Login Yet/);
    expect(count(out, `href="${link(IDS.athleteTransfer)}"`)).toBe(1);
  });

  it("with one already linked: once, below the list", async () => {
    const out = await html(ATHLETE_PAGE, { params: params({ id: IDS.athlete }), searchParams: Promise.resolve({}) });
    expect(out).not.toMatch(/No Athlete Login Yet/);
    expect(count(out, `href="${link(IDS.athlete)}"`)).toBe(1);
  });
});

describe("Campaigns can be reached, listed and started", () => {
  const LIST = "@/app/org/[slug]/fundraising/campaigns/page";
  const OVERVIEW = "@/app/org/[slug]/fundraising/page";
  const NEW = `/org/${ORG_WITH_MODULES}/fundraising/campaigns/new`;

  it("the list shows each campaign with what it raised, and a way to add another", async () => {
    const out = await html(LIST, { params: params(), searchParams: Promise.resolve({}) });
    expect(out).toMatch(/Fixture Campaign[\s\S]*\$5,000 raised of a \$25,000 goal/);
    expect(out).toContain(`href="${NEW}"`);
  });

  it("with none yet, the list says so and offers the first one", async () => {
    data.campaigns = [];
    const out = await html(LIST, { params: params(), searchParams: Promise.resolve({}) });
    expect(out).toMatch(/No Campaigns Yet/);
    expect(out).toMatch(/Add the First One/);
    expect(out).toContain(`href="${NEW}"`);
  });

  it("Fundraising with no gifts or pledges still links to Campaigns and Pledges, so a new org can start one", async () => {
    data.gifts = [];
    data.pledges = [];
    const out = await html(OVERVIEW, { params: params(), searchParams: Promise.resolve({}) });
    expect(out).toMatch(/Nothing Recorded Yet/);
    expect(out).toContain(`href="/org/${ORG_WITH_MODULES}/fundraising/campaigns"`);
    expect(out).toContain(`href="/org/${ORG_WITH_MODULES}/fundraising/pledges"`);
  });

  it("Fundraising with gifts shows the Campaigns section even when there are no campaigns", async () => {
    data.campaigns = [];
    const out = await html(OVERVIEW, { params: params(), searchParams: Promise.resolve({}) });
    expect(out).toMatch(/Campaigns[\s\S]*No Campaigns Yet/);
    expect(out).toContain(`href="${NEW}"`);
  });

  it("the short address /campaigns is redirected to the screen", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toMatch(/source: "\/org\/:slug\/campaigns", destination: "\/org\/:slug\/fundraising\/campaigns"/);
  });

  it("only an Admin opens it", async () => {
    for (const who of [MEMBER_ID, FAMILY_ID, null]) {
      currentUser = who;
      await expect(html(LIST, { params: params(), searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
    }
  });

  it("an org without the fundraising module has no campaigns screen at all", async () => {
    await expect(html(LIST, { params: Promise.resolve({ slug: "elite-fixture" }), searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_NOT_FOUND/);
  });

  it("the settings copy only promises what exists", () => {
    const copy = readFileSync(join(process.cwd(), "src/lib/validation/org.ts"), "utf8");
    expect(copy).toMatch(/Donors, gifts, pledges, campaigns and grants/);
  });
});

describe("the fixed tab bar never covers what the page scrolls to", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it("the bar is 56px, a 1px border and 12px of air above the home indicator, and the page reserves all 69px of it", () => {
    expect(readFileSync(join(process.cwd(), "src/components/kit/TabBar.tsx"), "utf8")).toMatch(/border-t[\s\S]*h-14/);
    expect(css).toMatch(/\.pb-tabbar\s*\{[^}]*env\(safe-area-inset-bottom[^}]*\+ 12px/);
    expect(readFileSync(join(process.cwd(), "src/components/kit/TabBar.tsx"), "utf8")).toMatch(/pb-tabbar fixed/);
    expect(css).toMatch(/\.pb-bar\s*\{[^}]*calc\(69px \+ env\(safe-area-inset-bottom/);
  });

  it("scrolling to a control (focus, an anchor, a test runner) keeps it clear of the bar, in the browser and installed", () => {
    expect(css).toMatch(/html\s*\{\s*scroll-padding-bottom:\s*calc\(69px \+ env\(safe-area-inset-bottom/);
    expect(css).toMatch(/display-mode: standalone[\s\S]*html\s*\{\s*scroll-padding-bottom:\s*calc\(69px \+ max\(env\(safe-area-inset-bottom/);
  });
});

describe("a refused document delete says why on the screen it lands on", () => {
  const DOC = "@/app/org/[slug]/documents/[id]/page";
  const LIST = "@/app/org/[slug]/documents/page";
  const reason = "Discard this document first. Discarding puts back anything it changed; then it can be deleted.";

  it("the document page shows the reason as a warning at the top", async () => {
    const out = await html(DOC, { params: params({ id: IDS.document }), searchParams: Promise.resolve({ error: reason }) });
    expect(out).toContain("Discard this document first.");
    expect(out).toMatch(/role="alert"/);
  });

  it("the document page without a reason shows no alert", async () => {
    const out = await html(DOC, { params: params({ id: IDS.document }), searchParams: Promise.resolve({}) });
    expect(out).not.toMatch(/role="alert"/);
    const bare = await html(DOC, { params: params({ id: IDS.document }) });
    expect(bare).not.toMatch(/role="alert"/);
  });

  it("the Documents list shows a reason too, for a document that is already gone", async () => {
    const out = await html(LIST, { params: params(), searchParams: Promise.resolve({ error: "That document is already gone." }) });
    expect(out).toContain("That document is already gone.");
    expect(out).toMatch(/role="alert"/);
  });

  it("the reason is text, never markup", async () => {
    const out = await html(LIST, { params: params(), searchParams: Promise.resolve({ error: "<script>alert(1)</script>" }) });
    expect(out).not.toContain("<script>alert(1)</script>");
  });
});

// The 2026-10-03 functional QA (round 3).

describe("one athlete and school show one fit score everywhere", () => {
  const TARGET = "@/app/org/[slug]/board/[id]/page";

  it("the target page headline is the stored score the lists show", async () => {
    const stored = (data.athlete_school_fits ?? []).find((f) => f.athlete_id === IDS.athlete && f.school_id === IDS.school)!;
    const out = await html(TARGET, { params: params({ id: IDS.target }) });
    expect(out).toContain(`>${stored.score}<`);
  });

  it("with nothing stored, the live compute reads the same inputs a recompute stores", async () => {
    const { loadFitForPair, recomputeFitsForAthlete } = await import("@/lib/data/fits");
    const client = createFakeClient(data, { userId: OWNER_ID });
    data.athlete_school_fits = (data.athlete_school_fits ?? []).filter((f) => !(f.athlete_id === IDS.athlete && f.school_id === IDS.school));
    const live = await loadFitForPair(client as never, BRIDGE_ORG, IDS.athlete, IDS.school);
    const re = await recomputeFitsForAthlete(client as never, BRIDGE_ORG, IDS.athlete);
    expect(re.error).toBeNull();
    const stored = (data.athlete_school_fits ?? []).find((f) => f.athlete_id === IDS.athlete && f.school_id === IDS.school)!;
    expect(live).not.toBeNull();
    expect(live!.score).toBe(stored.score);
  });
});

describe("a logged number that does not apply is not reported as nothing on file", () => {
  const school = {
    id: "s",
    name: "Fixture State University",
    division: "D2",
    state: "CT",
    sportsSponsored: ["baseball"],
    academics: { gpaMin: 2.5, gpaAvg: 3.2 },
    financials: { athleticScholarship: "partial", avgAthleticAid: 9000, avgMeritAid: 6000, avgNeedAid: 4000, outstateTotal: 38000, instateTotal: 24000 },
  };
  const athlete = (position: string, measurables: Record<string, number>) => ({ id: "a", orgId: "o", recruitType: "hs", name: "T", sport: "baseball", position, gpa: 3.4, gpaVerified: true, detail: { kind: "hs", gradYear: 2027 }, measurables });

  it("FB velo on a shortstop says it is not scored for that position and names what is", async () => {
    const { scoreAthletic } = await import("@/lib/fit/athletic");
    const r = scoreAthletic(athlete("SS", { fbVelo: 88 }) as never, school as never);
    const text = r.warnings.join(" ");
    expect(text).not.toMatch(/No measurables on file/);
    expect(text).toMatch(/not ones this position is scored on/);
    expect(text).toMatch(/60 time/);
  });

  it("nothing logged still says nothing is on file", async () => {
    const { scoreAthletic } = await import("@/lib/fit/athletic");
    const r = scoreAthletic(athlete("SS", {}) as never, school as never);
    expect(r.warnings.join(" ")).toMatch(/No measurables on file/);
  });

  it("FB velo on a pitcher counts, with no such warning", async () => {
    const { scoreAthletic } = await import("@/lib/fit/athletic");
    const r = scoreAthletic(athlete("RHP", { fbVelo: 88 }) as never, school as never);
    expect(r.warnings.join(" ")).not.toMatch(/No measurables|not ones this position/);
  });
});

describe("a GPA reads back as typed, never with a binary tail", () => {
  it("3.900000095367432 is stored and shown as 3.9", async () => {
    const { parseAthleteForm } = await import("@/lib/validation/athlete");
    const fd = new FormData();
    fd.set("name", "Test Athlete");
    fd.set("sport", "baseball");
    fd.set("recruitType", "hs");
    fd.set("gpa", "3.900000095367432");
    const r = parseAthleteForm(fd);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values.gpa).toBe(3.9);
  });

  it("the Edit form shows a float32 tail to two places", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { AthleteForm } = await import("@/components/AthleteForm");
    const out = renderToStaticMarkup(createElement(AthleteForm, { action: async () => ({ errors: {}, values: {} }), submitLabel: "Save", editing: true, initialValues: { name: "T", sport: "baseball", recruitType: "hs", gpa: 3.900000095367432 }} as never));
    expect(out).toContain('value="3.9"');
    expect(out).not.toContain("3.9000000");
  });
});

describe("how long since a target changed is said like a person would", () => {
  it("today reads updated today, never 0 days", async () => {
    const { noUpdateText } = await import("@/lib/datetime/since");
    expect(noUpdateText(0)).toBe("updated today");
    expect(noUpdateText(1)).toBe("no update in 1 day");
    expect(noUpdateText(9)).toBe("no update in 9 days");
  });
});

describe("two Admins with one name can be told apart in the Advisor picker", () => {
  it("the add-athlete label carries the email, and not twice when the name is the email", async () => {
    const { advisorOptionLabel } = await import("@/lib/data/staff");
    expect(advisorOptionLabel({ name: "Dave Fisher", email: "dave@bffsa.org" })).toBe("Dave Fisher (dave@bffsa.org)");
    expect(advisorOptionLabel({ name: "Dave Fisher", email: "dfisher2424@icloud.com", title: "Director" })).toBe("Dave Fisher, Director (dfisher2424@icloud.com)");
    expect(advisorOptionLabel({ name: "a@b.org", email: "a@b.org" })).toBe("a@b.org");
  });
});

describe("screens do not narrate the obvious (Dave, 2026-10-04)", () => {
  it("the Add Athlete form has no 'For example' hints on Name, Position or Grad Year", async () => {
    const out = await html("@/app/org/[slug]/roster/new/page", { params: params() });
    expect(out).not.toMatch(/For example, Jose Ulloa|For example, 2027|Change it later from the athlete/);
  });

  it("More does not describe its own menu rows back to the person", async () => {
    const out = await html("@/app/org/[slug]/more/page", { params: params() });
    expect(out).not.toMatch(/Who can sign in, and what each person can do|Who did what, across every athlete|Use this after a big import/);
  });

  it("the Activity screen has a title and the list, no sentence about the list", async () => {
    for (const f of ["src/app/org/[slug]/activity/page.tsx", "src/app/org/[slug]/roster/[id]/activity/page.tsx"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8")).not.toMatch(/lede=[^\n]*newest first/);
    }
  });

  it("an empty list says what is empty and gives the action, with no paragraph under it", async () => {
    data.athlete_checkins = [];
    const out = await html("@/app/org/[slug]/roster/[id]/checkins/page", { params: params({ id: IDS.athlete }) });
    expect(out).toMatch(/No Check-Ins Yet/);
    expect(out).not.toMatch(/A call, a meeting or a text all count/);
  });
});
