// More as the control center (Stage 5 Phase 3, docs/PLAN_STAGE5.md).
//
// Dave approved the plan whole on 2026-09-27, so its six sections are
// the contract: People, Program, Reference, Matching, Foundation,
// Organization, in that order, with each row in the section the plan
// puts it in. Foundation is Bridge's two modules and disappears when
// neither is on (docs/STYLING_CATALOG.md: modules off are hidden from
// More). Advisors is the one new screen: every Admin with the number of
// athletes they advise, counting only the ones still being recruited,
// the same rule as the check-in reminders.
//
// Each law below was planted and seen to fail, then reverted:
// - grouping: Foundation rendered unconditionally; more-lite failed.
// - owner-only rows: Members shown to every Admin; the leftover staff
//   check failed.
// - every href lands: the Advisors row pointed at /advisers; failed.
// - Advisors counts: every status counted; "2 athletes" read 3 and the
//   Committed athlete stopped showing as unassigned; failed.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID } from "@/testing/fixture";
import { PAGES, p } from "@/testing/pages";
import { createFakeClient, type Dataset } from "@/testing/fakeSupabase";
import { countByAdvisor } from "@/lib/data/staff";

const REDIRECT = "NEXT_REDIRECT:";
const NOT_FOUND = "NEXT_NOT_FOUND";

let currentUser: string | null = OWNER_ID;
let data: Dataset = buildFixture();

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
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
  createClient: async () => createFakeClient(data, { userId: currentUser }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("a page reached for the service-role client");
  },
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  data = buildFixture();
});

type PageFn = (props: Record<string, unknown>) => Promise<unknown>;
async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: PageFn };
  const tree = await mod.default(props);
  return renderToStaticMarkup(tree as never);
}

const MORE = "@/app/org/[slug]/more/page";
const ADVISORS = "@/app/org/[slug]/advisors/page";
const more = (slug = ORG_WITH_MODULES) => render(MORE, { params: p({ slug }) });
const advisors = (slug = ORG_WITH_MODULES) => render(ADVISORS, { params: p({ slug }) });
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);

// The kit's Section writes its label in one caps span. Every label on
// the page, in order.
const sectionLabels = (html: string) => [...html.matchAll(/uppercase tracking-wide text-muted">([^<]+)<\/span>/g)].map((m) => m[1]!);
// The markup of one section, from its label to the next section.
function sectionOf(html: string, label: string): string {
  const start = html.indexOf(`>${label}</span>`);
  expect(start, `a section labelled ${label}`).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const next = rest.indexOf("<section");
  return next === -1 ? rest : rest.slice(0, next);
}
// Rows that are a link, and rows that are not (the clickable baseline
// counts the second kind, and More may only ever go down from one).
const rows = (html: string) => (html.match(/data-kit="row"/g) ?? []).length;
const linkedRows = (html: string) => (html.match(/<a [^>]*>\s*<div data-kit="row"/g) ?? []).length;

// A leftover staff row (migration 0041 moved every staff row to owner,
// but the enum still carries it): an Admin in every way except the
// owner-only rows, which stay in code for it.
const asLeftoverStaff = () => {
  data.org_members.find((m) => m.id === "m2")!.role = "staff";
  currentUser = MEMBER_ID;
};

describe("LAW: More is six sections in the plan's order, each row where the plan puts it", () => {
  it("Bridge: People, Program, Reference, Matching, Foundation, Organization", async () => {
    const html = await more();
    expect(sectionLabels(html)).toEqual(["People", "Program", "Reference", "Matching", "Foundation", "Organization"]);
    const org = `/org/${ORG_WITH_MODULES}`;
    expect(hrefs(sectionOf(html, "People"))).toEqual([`${org}/members`, `${org}/advisors`]);
    expect(hrefs(sectionOf(html, "Program"))).toEqual([`${org}/assignments`, `${org}/documents`]);
    expect(hrefs(sectionOf(html, "Reference"))).toEqual([`${org}/schools`, `${org}/grading-scales`, `${org}/approved-courses`, `${org}/transfer-windows`]);
    expect(sectionOf(html, "Matching")).toMatch(/Recalculate All Matches/);
    expect(hrefs(sectionOf(html, "Foundation"))).toEqual([`${org}/fundraising`, `${org}/board-governance`]);
    const organization = sectionOf(html, "Organization");
    expect(hrefs(organization)).toEqual([`${org}/settings`, `${org}/activity`, `${org}/doc-ai-spending`, "/orgs/new"]);
    expect(organization).toMatch(/Organization Settings[\s\S]*Activity[\s\S]*Doc AI Spending[\s\S]*Start Another Organization[\s\S]*Example Owner[\s\S]*Sign Out/);
    // The old groupings are gone, not renamed alongside.
    expect(html).not.toMatch(/>Work<|>Document Reading<|>This Month</);
  });

  it("an org with neither module has no Foundation section and nothing from it", async () => {
    const html = await more(ORG_WITHOUT_MODULES);
    expect(sectionLabels(html)).toEqual(["People", "Program", "Reference", "Matching", "Organization"]);
    expect(html).not.toMatch(/Foundation|Fundraising|>Board</);
    expect(hrefs(html).filter((l) => /fundraising|board-governance/.test(l))).toEqual([]);
  });

  it("the one row that goes nowhere is the identity row; the baseline may only go down", async () => {
    const html = await more();
    expect(rows(html) - linkedRows(html)).toBe(1);
    expect(html).toMatch(/Example Owner[\s\S]*Head of Recruiting|Admin at Fixture Foundation/);
  });
});

describe("LAW: the owner-only rows stay the owner's; everything else is every Admin's", () => {
  it("an owner sees Members and Organization Settings; a leftover staff row sees neither but keeps the rest", async () => {
    const owner = await more();
    const org = `/org/${ORG_WITH_MODULES}`;
    expect(hrefs(owner)).toContain(`${org}/members`);
    expect(hrefs(owner)).toContain(`${org}/settings`);

    asLeftoverStaff();
    const staff = await more();
    expect(hrefs(staff).filter((l) => l.endsWith("/members") || l.endsWith("/settings"))).toEqual([]);
    expect(staff).not.toMatch(/>Members<|Organization Settings/);
    for (const path of ["advisors", "activity", "assignments", "documents", "schools", "grading-scales", "approved-courses", "transfer-windows", "doc-ai-spending"]) expect(hrefs(staff)).toContain(`${org}/${path}`);
    expect(staff).toMatch(/Doc AI Spending/);
    // Every section still stands, Members or not.
    expect(sectionLabels(staff)).toEqual(["People", "Program", "Reference", "Matching", "Foundation", "Organization"]);
  });

  it("a Viewer and an Athlete login cannot open More or Advisors", async () => {
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      await expect(more(), who).rejects.toThrow(REDIRECT + "/unauthorized");
      await expect(advisors(), who).rejects.toThrow(REDIRECT + "/unauthorized");
    }
  });
});

describe("LAW: every row on More lands on a registered page", () => {
  // The live links check (scripts/live/links.mjs) proves this against
  // the running app; this proves it at test time, so a row for a page
  // that does not exist yet (Assignments, View As, Activity before their
  // phases) fails here first.
  it("each href on More, for both fixture orgs, is a route in PAGES", async () => {
    // The route pattern of each page ("/org/[slug]/members"), so the
    // same law reads for either fixture org.
    const routes = new Set(PAGES.map((page) => page.path.replace(/^@\/app/, "").replace(/\/page$/, "")));
    for (const slug of [ORG_WITH_MODULES, ORG_WITHOUT_MODULES]) {
      const html = await more(slug);
      const links = hrefs(html).map((l) => l.split("?")[0]!.replace(`/org/${slug}/`, "/org/[slug]/"));
      expect(links.length).toBeGreaterThan(8);
      const dead = links.filter((l) => !routes.has(l));
      expect(dead, slug).toEqual([]);
    }
  });
});

describe("LAW: Advisors lists every Admin with the athletes they advise, counting only Active and Transferring", () => {
  it("the pure count follows the reminder rule", () => {
    const counts = countByAdvisor([
      { advisor_id: "a", status: "Active" },
      { advisor_id: "a", status: "Transferring" },
      { advisor_id: "a", status: "Committed" },
      { advisor_id: "a", status: "Enrolled" },
      { advisor_id: "b", status: "Graduated" },
      { advisor_id: null, status: "Active" },
      { advisor_id: null, status: "Drafted" },
    ]);
    expect(counts.byAdvisor.get("a")).toBe(2);
    expect(counts.byAdvisor.has("b")).toBe(false);
    expect(counts.unassigned).toBe(1);
  });

  it("the fixture owner advises 2, two athletes have nobody, and the Viewer is not listed", async () => {
    const html = await advisors();
    expect(html).toMatch(/Active and Transferring athletes each Admin advises\. 2 athletes have no advisor yet\./);
    expect(html).toMatch(/Example Owner[\s\S]*Head of Recruiting<\/span> · 2 athletes/);
    expect(hrefs(html)).toContain(`/org/${ORG_WITH_MODULES}/members/${OWNER_ID}`);
    expect(html).not.toMatch(/Example Member|Fixture Parent/);
    // Every row is a way in; nothing here raises the clickable baseline.
    expect(rows(html) - linkedRows(html)).toBe(0);
  });

  it("a placed or removed athlete leaves the count, and an assignment leaves the unassigned count", async () => {
    const athlete = (id: string) => data.athletes.find((a) => a.id === id) as { status: string; deleted_at: string | null; advisor_id?: string | null };
    athlete(IDS.athleteNoGpa).status = "Committed";
    expect(await advisors()).toMatch(/Head of Recruiting<\/span> · 1 athlete</);

    athlete(IDS.athlete).deleted_at = "2026-09-27T00:00:00.000Z";
    expect(await advisors()).toMatch(/Head of Recruiting<\/span> · 0 athletes/);

    athlete(IDS.athleteTransfer).advisor_id = OWNER_ID;
    const html = await advisors();
    expect(html).toMatch(/1 athlete has no advisor yet\./);
    expect(html).toMatch(/Head of Recruiting<\/span> · 1 athlete</);
  });

  it("a leftover staff row opens it and reads the same list", async () => {
    asLeftoverStaff();
    const html = await advisors();
    expect(html).toMatch(/Example Owner[\s\S]*2 athletes/);
    // The leftover staff row is an Admin, so they are on the list too.
    expect(html).toMatch(/Example Member[\s\S]*Admin<\/span> · 0 athletes/);
  });
});
