// Athlete pages and document visibility (Dave, 2026-10-11): an athlete
// page shows the record itself, and no document is ever out of reach.
// Each law was planted and seen to fail; the plant is named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const REDIRECT = "NEXT_REDIRECT:";
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(REDIRECT + url);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }) }));

beforeEach(() => {
  writes = [];
  data = buildFixture();
  delete process.env.ANTHROPIC_API_KEY;
});

const P = <T>(v: T) => Promise.resolve(v);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const doc = (id: string) => data.documents.find((d) => d.id === id)!;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}

async function run(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return decodeURIComponent(m.slice(REDIRECT.length));
    throw e;
  }
}

// Verified this law bites: made athleteInfoRows keep empty fields,
// watched "nothing empty" fail, reverted.
describe("LAW: Athlete Info lists every populated field and nothing empty", () => {
  it("fields with a value show, formatted; empty ones are left out", async () => {
    const { athleteInfoRows } = await import("@/lib/athleteInfo");
    const rows = athleteInfoRows(
      { sport: "Baseball", position: "SS", status: "Prospect", gpa: 3.5, gpa_verified: true, home_state: "", date_of_birth: null, detail: { kind: "hs", gradYear: 2027, highSchool: "Stamford High" } },
      { advisorName: "Pat Coach", recruitTypeLabel: "High School", latestMetrics: new Map([["heightIn", 72], ["weightLb", 180]]), date: (d) => d },
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel).toMatchObject({ Status: "Prospect", "Advised By": "Pat Coach", Sport: "Baseball", Position: "SS", Level: "High School", Class: "Class of 2027", "High School": "Stamford High", Height: "72 in", Weight: "180 lb", "School GPA": "3.50 (verified)" });
    expect(byLabel["Home State"]).toBeUndefined();
    expect(byLabel["Date of Birth"]).toBeUndefined();
    expect(rows.every((r) => r.value.trim() !== "")).toBe(true);
  });

  it("a transfer's college fields show", async () => {
    const { athleteInfoRows } = await import("@/lib/athleteInfo");
    const rows = athleteInfoRows({ detail: { kind: "transfer", currentSchool: "State U", currentDivision: "D1", collegeGpa: 3.1, eligibilityYearsRemaining: 2, transferCount: 1 } }, { date: (d) => d });
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["Current School", "Current Division", "College GPA", "Eligibility Years Left", "Transfers So Far"]));
  });

  it("the athlete page shows Athlete Info first, under the name, with the record's values", async () => {
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: P({}) });
    const info = html.indexOf(">Athlete Info<");
    expect(info).toBeGreaterThan(-1);
    expect(info).toBeLessThan(html.indexOf(">Advisor<"));
    const section = text(html.slice(info, html.indexOf(">Advisor<")));
    expect(section).toMatch(/Sport/);
    expect(section).toMatch(/Status/);
  });
});

// Verified this law bites: put .limit(60) back on the documents list,
// watched the oldest document go missing, reverted.
describe("LAW: every document is reachable from Documents, in its view and by search", () => {
  it("an archived document is in All and in Archived, and search finds it in either", async () => {
    const all = text(await render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }));
    expect(all).toContain("old-notes.txt");
    const archived = text(await render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ view: "archived", q: "old-notes" }) }));
    expect(archived).toContain("old-notes.txt");
    const searchedAll = text(await render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ q: "old-notes" }) }));
    expect(searchedAll).toContain("old-notes.txt");
    expect(searchedAll).not.toContain("team-letter.docx");
  });

  it("the oldest of 150 documents is still listed and found (no cap of a few dozen)", async () => {
    const orgId = data.orgs[0]!.id as string;
    const template = data.documents.find((d) => d.id === "doc-ready")!;
    for (let i = 0; i < 150; i++) data.documents.push({ ...template, id: `doc-bulk-${i}`, file_name: `bulk-${i}.pdf`, org_id: orgId, created_at: new Date(Date.UTC(2026, 9, 10, 0, i)).toISOString() });
    data.documents.push({ ...template, id: "doc-oldest", file_name: "bautista-profile.pdf", lifecycle: "archived", filed_as: "athlete_profile", org_id: orgId, created_at: "2020-01-01T00:00:00.000Z" });
    const all = text(await render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }));
    expect(all).toContain("bautista-profile.pdf");
    const found = text(await render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ q: "bautista" }) }));
    expect(found).toContain("bautista-profile.pdf");
    expect(found).toMatch(/Athlete Profile/);
  });
});

// Verified this law bites: filtered the athlete page's documents to
// Needs Review, watched the Ready and Archived ones go missing, reverted.
describe("LAW: an athlete page lists all of that athlete's documents, whatever their state", () => {
  it("Needs Review, Ready and Archived documents linked to the athlete all show, each opening its page", async () => {
    doc("doc-ready").linked_athlete_id = IDS.athlete;
    doc("doc-archived").linked_athlete_id = IDS.athlete;
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: P({}) });
    for (const id of ["doc-word", "doc-ready", "doc-archived"]) expect(html, id).toMatch(new RegExp(`href="/org/[^"]+/documents/${id}"`));
    const section = text(html.slice(html.indexOf(">Documents<")));
    expect(section).toMatch(/Ready/);
    expect(section).toMatch(/Archived/);
  });
});
