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

  it("the bar is 56px and a 1px border, and the page reserves all 57px of it", () => {
    expect(readFileSync(join(process.cwd(), "src/components/kit/TabBar.tsx"), "utf8")).toMatch(/border-t[\s\S]*h-14/);
    expect(css).toMatch(/\.pb-bar\s*\{[^}]*calc\(57px \+ env\(safe-area-inset-bottom/);
  });

  it("scrolling to a control (focus, an anchor, a test runner) keeps it clear of the bar, in the browser and installed", () => {
    expect(css).toMatch(/html\s*\{\s*scroll-padding-bottom:\s*calc\(57px \+ env\(safe-area-inset-bottom/);
    expect(css).toMatch(/display-mode: standalone[\s\S]*html\s*\{\s*scroll-padding-bottom:\s*calc\(57px \+ max\(env\(safe-area-inset-bottom/);
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
