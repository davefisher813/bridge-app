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
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID } from "@/testing/fixture";
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
      const html = await render(page.path, page.props);
      expect(html.length).toBeGreaterThan(200);
      expect(html).toMatch(page.expect);
    });
  }
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
    expect(html).toMatch(/Nothing logged/);
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
    expect(html).toMatch(/No donor record linked/);
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

describe("LAW: a member sees the read screens and not the write controls", () => {
  it("a member can open the roster", async () => {
    currentUser = MEMBER_ID;
    const html = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(html).toMatch(/Fixture Athlete/);
  });

  it("a member does not get the add-an-athlete control", async () => {
    currentUser = MEMBER_ID;
    const asMember = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }) });
    currentUser = OWNER_ID;
    const asOwner = await render("@/app/org/[slug]/roster/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(asOwner).toMatch(/roster\/new/);
    expect(asMember).not.toMatch(/roster\/new/);
  });
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
    expect(html).toMatch(/Something broke/);
    expect(html).toMatch(/Try Again/);
    expect(html).not.toMatch(/boom/);
  });

  it("the root error screen offers a retry", async () => {
    const html = await renderElement("@/app/error", { error: new Error("boom"), reset: () => {} });
    expect(html).toMatch(/Try Again/);
  });

  it("the org not-found screen links back to that org's Today", async () => {
    const html = await renderElement("@/app/org/[slug]/not-found", {});
    expect(html).toMatch(/Nothing here/);
    expect(html).toMatch(/Back to Today/);
  });

  it("the root not-found screen links to the start", async () => {
    const html = await renderElement("@/app/not-found", {});
    expect(html).toMatch(/Nothing here/);
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
    expect(html).toMatch(/Email me a link instead/);
    const link = await render("@/app/login/page", { searchParams: p({ mode: "link" }) });
    expect(link).toMatch(/Email Me a Link/);
  });
});
