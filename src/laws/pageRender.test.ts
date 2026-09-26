// Every page actually runs.
//
// Until this file, nothing in the repo had ever executed a page. They are
// all `force-dynamic` server components, so `npm run build` type-checks
// them and stops there, and the click-through prototype is a second
// implementation of the same screens that shares the engine modules and
// none of the page code.
//
// That left a whole class of bug with no check anywhere: reading a field
// off a null row, mapping over an embed that arrived as an object rather
// than an array, a `!` on something genuinely absent. None of it is
// visible to tsc through an `as` cast, and every one of them is a blank
// screen with a stack trace in a log nobody is reading.
//
// Each page is called directly and the element tree it returns is
// rendered to a string. The pages are async functions returning ordinary
// JSX, so awaiting the function is enough; React never has to resolve an
// async component. `notFound()` and `redirect()` throw sentinels, which
// is what Next does, so a page that bails is asserted on rather than
// counted as a pass.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID } from "@/testing/fixture";
import { PAGES, p } from "@/testing/pages";
import { createFakeClient } from "@/testing/fakeSupabase";

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

let currentUser: string | null = OWNER_ID;

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(REDIRECT + url);
  },
  // A client component on the page imports this. It is never called
  // during a render, but the module has to export it.
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(buildFixture(), { userId: currentUser }),
}));

// The admin client is the service role. A page never uses it, so reaching
// for one here is a finding rather than something to stub quietly.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("a page reached for the service-role client");
  },
}));

type PageFn = (props: Record<string, unknown>) => Promise<unknown>;

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: PageFn };
  const tree = await mod.default(props);
  return renderToStaticMarkup(tree as never);
}


beforeEach(() => {
  currentUser = OWNER_ID;
});

describe("LAW: every page renders", () => {
  for (const page of PAGES) {
    it(`${page.name} renders without throwing`, async () => {
      currentUser = page.as ?? OWNER_ID;
      const html = await render(page.path, page.props);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toMatch(page.expect);
    });
  }
});

// The family role reads one athlete and nothing else (migrations 0022
// to 0024). The database enforces it; this proves the screens do too,
// so a fixture render, which has no row level security, cannot show a
// family something the real app would not.
describe("LAW: a family login opens family screens and nothing else, and staff cannot open them", () => {
  // The athlete screens served under both /roster and /family (see
  // athleteHome in src/lib/auth/guard.ts). A family may open these; what
  // the law checks is that every link on them stays on the family side.
  const SHARED = /\/roster\/\[id\]\/(eligibility|eligibility\/approvals|eligibility\/caveats|transcript|metrics)\/page$/;
  const family = PAGES.filter((x) => x.as === FAMILY_ID);
  const shared = PAGES.filter((x) => !x.as && SHARED.test(x.path));
  const orgWide = PAGES.filter((x) => !x.as && x.path.startsWith("@/app/org/") && !SHARED.test(x.path));
  const familyShared = family.filter((x) => /\/family\/\[id\]\/(eligibility|eligibility\/approvals|eligibility\/caveats|transcript|metrics)\/page$/.test(x.path));

  it("there are family screens and org screens to check", () => {
    expect(family.length).toBeGreaterThan(5);
    expect(orgWide.length).toBeGreaterThan(20);
    expect(shared.length).toBeGreaterThanOrEqual(6);
  });

  for (const page of shared) {
    it(`a family login opening ${page.name} sees only family links, or nothing if the athlete is not theirs`, async () => {
      currentUser = FAMILY_ID;
      const linked = ((await (page.props.params as Promise<{ id: string }>)).id) !== IDS.athleteTransfer;
      if (!linked) {
        await expect(render(page.path, page.props)).rejects.toThrow(NOT_FOUND);
        return;
      }
      const html = await render(page.path, page.props);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(links.length).toBeGreaterThan(0);
      expect(links.filter((l) => l.startsWith("/org/") && !l.includes("/family/"))).toEqual([]);
      // Nothing to submit: a family changes nothing.
      expect(html).not.toMatch(/<form/);
    });
  }

  for (const page of familyShared) {
    it(`an owner opening ${page.name} is on the roster side`, async () => {
      currentUser = OWNER_ID;
      const html = await render(page.path, page.props);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(links.filter((l) => l.includes("/family/"))).toEqual([]);
    });
  }

  for (const page of orgWide) {
    it(`a family login cannot open ${page.name}`, async () => {
      currentUser = FAMILY_ID;
      const outcome = await render(page.path, page.props).then(
        () => "rendered",
        (e: Error) => e.message,
      );
      // Not Authorized for the org-wide screens; Not Found for the
      // records the org page shows (a second org's page, say). Never a
      // render.
      expect(outcome === "rendered" ? "rendered" : outcome.startsWith(REDIRECT) ? outcome : NOT_FOUND).not.toBe("rendered");
      if (outcome.startsWith(REDIRECT)) expect(outcome).toMatch(/\/unauthorized$|\/family$/);
    });
  }

  for (const page of family.filter((x) => !familyShared.includes(x))) {
    it(`an owner cannot open ${page.name}`, async () => {
      currentUser = OWNER_ID;
      await expect(render(page.path, page.props)).rejects.toThrow(REDIRECT + "/unauthorized");
    });
  }

  it("a family login cannot open an athlete it is not linked to", async () => {
    currentUser = FAMILY_ID;
    await expect(render("@/app/org/[slug]/family/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) })).rejects.toThrow(NOT_FOUND);
    await expect(render("@/app/org/[slug]/family/[id]/eligibility/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) })).rejects.toThrow(NOT_FOUND);
  });
});

describe("LAW: the list above covers every page in the app", () => {
  // The render list is written out by hand, which is right (a glob would
  // let a new page join without anybody deciding what its arguments are)
  // and which rots the moment somebody adds a route and forgets. So the
  // list is checked against the filesystem rather than trusted.
  it("no page.tsx is missing from PAGES", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const { posix } = await import("node:path");
    const appDir = posix.join(process.cwd().replace(/\\/g, "/"), "src/app");

    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = posix.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "page.tsx") {
          const rel = full.slice(appDir.length + 1);
          // The root page is "page.tsx" with no directory, which slices
          // to itself rather than to "".
          found.push(rel === "page.tsx" ? "" : rel.replace(/\/page\.tsx$/, ""));
        }
      }
    };
    walk(appDir);

    const covered = new Set(PAGES.map((x) => x.path.replace(/^@\/app\//, "").replace(/\/page$/, "")));
    // Nothing is exempt any more. The forms used to be, on the grounds
    // that a render proves nothing about a post, which was true of the
    // post and false of the rest of the screen.
    const missing = found.filter((f) => !covered.has(f) && f !== "" && !f.startsWith("unauthorized") && !f.startsWith("login") && !f.startsWith("auth"));

    expect(missing).toEqual([]);
  });
});

describe("LAW: recruiting closes for an Enrolled athlete, on the staff side and the family side", () => {
  // Dave, 2026-09-26: once an athlete enrolls, the high school
  // recruiting apparatus should stop looking outstanding. The stepper
  // and the Matches section are what "still recruiting" looks like on
  // screen, so they are what has to disappear.
  it("the athlete page drops the stepper and Matches for the Mark Enrolled row, and keeps Colleges as history", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(html).toMatch(/Enrolled[\s\S]*Fixture State University/);
    expect(html).not.toMatch(/>Profile</);
    expect(html).not.toMatch(/Mark Enrolled/);
    expect(html).not.toMatch(/>Matches</);
    // The closed target's real status still renders, honestly, in Colleges.
    expect(html).toMatch(/Not Interested/);
  });

  it("a Committed athlete not yet enrolled sees the stepper, the Mark Enrolled button, and Matches", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) });
    expect(html).toMatch(/Mark Enrolled/);
    expect(html).toMatch(/>Matches</);
  });

  it("the full Matches page shows an Enrolled state instead of a ranked list", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/matches/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }), searchParams: p({}) });
    expect(html).toMatch(/Enrolled/);
    expect(html).not.toMatch(/Add to Board/);
  });

  it("the family mirror also drops the stepper and Matches once enrolled", async () => {
    currentUser = FAMILY_ID;
    const html = await render("@/app/org/[slug]/family/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) });
    expect(html).toMatch(/Enrolled[\s\S]*Fixture State University/);
    expect(html).not.toMatch(/>Profile</);
    expect(html).not.toMatch(/>Matches</);
  });

  it("the enroll screen previews exactly what will close, and requires a Committed target", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/enroll/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteCommitted }) });
    expect(html).toMatch(/Fixture State University/);
    expect(html).toMatch(/Will Close/);

    await expect(render("@/app/org/[slug]/roster/[id]/enroll/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) })).resolves.toMatch(/No Committed School Yet/);
    await expect(render("@/app/org/[slug]/roster/[id]/enroll/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteEnrolled }) })).rejects.toThrow(NOT_FOUND);
  });
});

describe("LAW: the awkward rows render too", () => {
  // Every one of these is a row the fixture made deliberately incomplete.
  // A page that only ever sees a complete row is a page nobody has tested.
  it("an athlete with no GPA, no position and no detail", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa }),
    });
    expect(html).toMatch(/Fixture Unknown/);
  });

  it("a target with no coach and no offer", async () => {
    const html = await render("@/app/org/[slug]/board/[id]/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.targetNoCoach }),
    });
    expect(html).toMatch(/Fixture College/);
  });

  it("a contact log on a target with nothing logged", async () => {
    const html = await render("@/app/org/[slug]/board/[id]/communications/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.targetNoCoach }),
    });
    expect(html).toMatch(/Nothing logged/i);
  });

  it("a donor who sits on no board", async () => {
    const html = await render("@/app/org/[slug]/fundraising/donors/[id]/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.donorNoSeat }),
    });
    expect(html).toMatch(/Fixture Lapsed Donor/);
    expect(html).not.toMatch(/Sits on a board/);
  });

  it("the approved-list form 404s with no school named", async () => {
    // Not a workaround for the test: a list belongs to one school, and a
    // form with no school is a form that cannot be saved. Pinned because
    // the alternative (rendering an empty form) is the kind of thing that
    // gets "fixed" by somebody who does not know why the check is there.
    await expect(
      render("@/app/org/[slug]/approved-courses/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) }),
    ).rejects.toThrow(NOT_FOUND);
  });

  it("a board seat with no donor record says so rather than reporting zero", async () => {
    const html = await render("@/app/org/[slug]/board-governance/[id]/seats/[memberId]/page", {
      params: p({ slug: ORG_WITH_MODULES, id: IDS.board, memberId: "bm2" }),
      searchParams: p({}),
    });
    expect(html).toMatch(/No donor record linked/i);
  });
});

describe("LAW: the module gate is a 404, not an empty screen", () => {
  // orgs.modules is the multi-tenant boundary. A gated page that renders
  // an empty shell instead of 404ing is a page that tells Elite Squad the
  // feature exists and is broken.
  const GATED = [
    { name: "fundraising", path: "@/app/org/[slug]/fundraising/page", extra: { searchParams: p({}) } },
    { name: "gifts", path: "@/app/org/[slug]/fundraising/gifts/page", extra: { searchParams: p({}) } },
    { name: "donors", path: "@/app/org/[slug]/fundraising/donors/page", extra: {} },
    { name: "governance", path: "@/app/org/[slug]/board-governance/page", extra: { searchParams: p({}) } },
    { name: "all-seats", path: "@/app/org/[slug]/board-governance/members/page", extra: { searchParams: p({}) } },
  ];

  for (const g of GATED) {
    it(`${g.name} 404s for an org without the module`, async () => {
      await expect(render(g.path, { params: p({ slug: ORG_WITHOUT_MODULES }), ...g.extra })).rejects.toThrow(NOT_FOUND);
    });
  }
});

describe("LAW: a page with no signed-in user does not render", () => {
  // requireRole redirects rather than returning null, so a page cannot
  // accidentally render for a signed-out visitor. Checked on the screen
  // holding the most sensitive rows in the database.
  it("the donor list redirects when nobody is signed in", async () => {
    currentUser = null;
    await expect(
      render("@/app/org/[slug]/fundraising/donors/page", { params: p({ slug: ORG_WITH_MODULES }) }),
    ).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
  });
});

describe("LAW: a member reads the program as stages, never the roster", () => {
  // Until 2026-09-21 a member opened the roster read-only. A board
  // member now has their own Program screen (migration 0031, the Board
  // Access catalog) and the roster is staff's.
  it("a member is sent away from the roster", async () => {
    currentUser = MEMBER_ID;
    await expect(render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }) })).rejects.toThrow(REDIRECT + "/unauthorized");
  });

  it("a member's Program names the athletes with a stage and no grades", async () => {
    currentUser = MEMBER_ID;
    const html = await render("@/app/org/[slug]/member/program/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(html).toMatch(/Fixture Athlete/);
    expect(html).toMatch(/Offer|Targeting|Committed/);
    expect(html).not.toMatch(/GPA|3\.4/);
  });
});

describe("LAW: an org without the fundraising module has no money on the member screens", () => {
  // orgs.modules gates board_governance and donor_fundraising off by
  // default, so Elite Squad's board sees the program and nothing else.
  // The tab bar drops Giving (src/components/kit/TabBar.tsx); these are
  // the screens themselves.
  it("the member home shows the program and no seat, budget or giving link", async () => {
    currentUser = MEMBER_ID;
    const html = await render("@/app/org/[slug]/member/page", { params: p({ slug: ORG_WITHOUT_MODULES }) });
    expect(html).toMatch(/The Program/);
    expect(html).not.toMatch(/Your Seat|Of Budget|Give\/Get|raised/i);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((l) => l.includes("/giving"))).toEqual([]);
  });

  it("the Giving screen itself is a 404 for that org", async () => {
    currentUser = MEMBER_ID;
    await expect(render("@/app/org/[slug]/member/giving/page", { params: p({ slug: ORG_WITHOUT_MODULES }) })).rejects.toThrow(NOT_FOUND);
  });

  it("the member tab bar drops Giving without the module", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { TabBar } = await import("@/components/kit/TabBar");
    const lite = renderToStaticMarkup(createElement(TabBar, { slug: ORG_WITHOUT_MODULES, variant: "member-lite" }));
    expect(lite).not.toMatch(/Giving/);
    const full = renderToStaticMarkup(createElement(TabBar, { slug: ORG_WITH_MODULES, variant: "member" }));
    expect(full).toMatch(/Giving/);
  });
});

describe("LAW: a searched list keeps the box that searched it", () => {
  // A term that narrows a list to one row, or to none, must leave the
  // field on screen: otherwise the only way back is the browser's own
  // address bar, which on a phone is the way nobody takes.
  const searched = PAGES.filter((x) => x.name.endsWith("-search") || x.name.endsWith("-search-empty"));

  it("there are searched screens to check", () => {
    expect(searched.length).toBeGreaterThanOrEqual(6);
  });

  for (const page of searched) {
    it(`${page.name} still shows the search field`, async () => {
      currentUser = page.as ?? OWNER_ID;
      const html = await render(page.path, page.props);
      expect(html).toMatch(/name="q"/);
      expect(html).toMatch(/Search/);
    });
  }
});

describe("LAW: the screens around the pages render too", () => {
  // error.tsx, not-found.tsx and loading.tsx are not pages, so the
  // coverage law above never sees them, and until 2026-09-19 none
  // existed: a thrown error was Next's white default and a slow query
  // was a blank screen. Each is rendered here the way Next would call it.
  // These are client components with hooks, so unlike the async pages
  // above they are mounted as elements and rendered by React itself.
  async function renderElement(modulePath: string, props: Record<string, unknown>): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const mod = (await import(/* @vite-ignore */ modulePath)) as { default: React.ComponentType<Record<string, unknown>> };
    return renderToStaticMarkup(createElement(mod.default, props));
  }

  it("the org error screen offers a retry and keeps its tone", async () => {
    const html = await renderElement("@/app/org/[slug]/error", { error: new Error("boom"), reset: () => {} });
    expect(html).toMatch(/Something broke/i);
    expect(html).toMatch(/Try Again/);
    expect(html).not.toMatch(/boom/);
  });

  it("the root error screen offers a retry", async () => {
    const html = await renderElement("@/app/error", { error: new Error("boom"), reset: () => {} });
    expect(html).toMatch(/Try Again/);
  });

  it("the org not-found screen links back to that org's Today", async () => {
    const html = await renderElement("@/app/org/[slug]/not-found", {});
    expect(html).toMatch(/Nothing here/i);
    expect(html).toMatch(/Back to Today/);
  });

  it("the root not-found screen links to the start", async () => {
    const html = await renderElement("@/app/not-found", {});
    expect(html).toMatch(/Nothing here/i);
  });

  it("the org loading screen is paper, not empty", async () => {
    const html = await renderElement("@/app/org/[slug]/loading", {});
    expect(html).toMatch(/bg-paper/);
    expect(html).toMatch(/aria-busy/);
  });
});

describe("LAW: the members screens are the owner's alone", () => {
  it("a member is turned away from the list", async () => {
    currentUser = MEMBER_ID;
    await expect(render("@/app/org/[slug]/members/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) })).rejects.toThrow(REDIRECT + "/unauthorized");
  });

  it("the only owner is told why they cannot be removed", async () => {
    const html = await render("@/app/org/[slug]/members/[userId]/page", { params: p({ slug: ORG_WITH_MODULES, userId: OWNER_ID }), searchParams: p({}) });
    expect(html).toMatch(/only Executive Director/);
    expect(html).not.toMatch(/Remove From/);
  });

  it("the sign-in screen leads with the password and keeps the magic link one tap away", async () => {
    const html = await render("@/app/login/page", { searchParams: p({}) });
    expect(html).toMatch(/type="password"/);
    expect(html).toMatch(/Email Me a Link Instead/);
    const link = await render("@/app/login/page", { searchParams: p({ mode: "link" }) });
    expect(link).toMatch(/Email Me a Link/);
  });
});

// The member role (Bridge: Board) reads summaries, never rows
// (migration 0031), and has its own screens under /member (Dave's picks
// in the Board Access catalog, 2026-09-21). The database enforces the
// reads; this proves the screens do too: a member login opens the
// member screens and nothing else, every link on them stays on the
// member side, and staff cannot open them.
describe("LAW: a member login opens member screens and nothing else, and staff cannot open them", () => {
  const member = PAGES.filter((x) => x.as === MEMBER_ID);
  const everythingElse = PAGES.filter((x) => x.as !== MEMBER_ID && x.path.startsWith("@/app/org/"));

  it("there are member screens to check", () => {
    expect(member.length).toBeGreaterThanOrEqual(5);
  });

  for (const page of member) {
    it(`a member opening ${page.name} sees only member links, and a form only to sign out`, async () => {
      currentUser = MEMBER_ID;
      const html = await render(page.path, page.props);
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
      expect(links.filter((l) => l.startsWith("/org/") && !l.includes("/member"))).toEqual([]);
      const forms = (html.match(/<form/g) ?? []).length;
      expect(forms).toBe(page.name.startsWith("member-more") ? 1 : 0);
      // Nothing a board member must not see: a GPA, a test score, a
      // metric, a call note, a donor's name.
      expect(html).not.toMatch(/GPA|SAT|ACT|FB Velo|Fixture Donor|coach@/);
    });

    it(`an owner cannot open ${page.name}`, async () => {
      currentUser = OWNER_ID;
      await expect(render(page.path, page.props)).rejects.toThrow(REDIRECT + "/unauthorized");
    });
  }

  for (const page of everythingElse) {
    it(`a member login cannot open ${page.name}`, async () => {
      currentUser = MEMBER_ID;
      const outcome = await render(page.path, page.props).then(
        () => "rendered",
        (e: Error) => e.message,
      );
      expect(outcome).not.toBe("rendered");
      if (outcome.startsWith(REDIRECT)) expect(outcome).toMatch(/\/unauthorized$|\/member$/);
    });
  }

  it("a member cannot open an athlete that is not in the program", async () => {
    currentUser = MEMBER_ID;
    await expect(render("@/app/org/[slug]/member/program/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: "00000000-0000-0000-0000-00000000dead" }) })).rejects.toThrow(NOT_FOUND);
  });
});
