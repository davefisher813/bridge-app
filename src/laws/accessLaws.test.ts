// Three access levels, fixed names, and a Title per person.
//
// Dave, 2026-09-27: "Admin, athlete, viewer. I control access of all
// that. Within admin I can set board, title, role, whatever." Then: one
// Admin level, board members get whatever access he picks per person,
// and yes to a free-text Title per person.
//
// So: owner shows as Admin, member as Viewer, family as Athlete, in
// every org, whatever orgs.role_labels still holds. staff is retired
// (migration 0041 moved every staff row to owner): nothing offers it and
// the actions refuse it without writing. A Title is set by an Admin on
// the member's page, written by the service role behind the Admin gate,
// and shown next to the person's name where the access level was.
//
// Each law below was planted and seen to fail, then reverted (see the
// note above each describe).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, OUTSIDER_ID, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const REDIRECT = "NEXT_REDIRECT:";
const NOT_FOUND = "NEXT_NOT_FOUND";

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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
});

const P = <T,>(v: T) => Promise.resolve(v);

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; state: unknown }> {
  try {
    return { redirect: null, state: await fn() };
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return { redirect: m.slice(REDIRECT.length), state: null };
    throw e;
  }
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
// What a person reads: the kit sets a meta line's first fact in its own
// span, so a check on "Title · Level" reads the text, not the markup.
const text = (html: string) => unescape(html.replace(/<[^>]+>/g, ""));

// The options of one <select>, by its name, as [value, label] pairs.
function selectOptions(html: string, name: string): [string, string][] {
  const m = html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`));
  expect(m, `a select named ${name}`).not.toBeNull();
  return [...m![1]!.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((o) => [o[1]!, unescape(o[2]!)]);
}

const members = (slug: string) => render("@/app/org/[slug]/members/page", { params: P({ slug }), searchParams: P({}) });
const memberPage = (slug: string, userId: string) => render("@/app/org/[slug]/members/[userId]/page", { params: P({ slug, userId }), searchParams: P({}) });
const invitePage = () => render("@/app/org/[slug]/members/new/page", { params: P({ slug: ORG_WITH_MODULES }) });

// Verified this law bites: put `owner: "Owner"` back in ACCESS_LEVEL;
// separately `staff: "Staff"`; separately printed the raw enum value on
// the members list in place of labelForRole. Ran
// `npx vitest run accessLaws`, watched each fail, reverted.
describe("LAW: the access names are Admin, Viewer and Athlete, whatever orgs.role_labels says", () => {
  it("there are exactly three names, and staff reads as Admin", async () => {
    const { ACCESS_LEVEL, labelForRole } = await import("@/lib/org/roleLabels");
    expect([...new Set(Object.values(ACCESS_LEVEL))].sort()).toEqual(["Admin", "Athlete", "Viewer"]);
    expect(labelForRole("owner")).toBe("Admin");
    expect(labelForRole("member")).toBe("Viewer");
    expect(labelForRole("family")).toBe("Athlete");
    expect(labelForRole("staff")).toBe("Admin");
  });

  it("an org's own role words never reach the members screens", async () => {
    data.orgs[0]!.role_labels = { owner: "Grand Poobah", staff: "Coordinator", member: "Board Member", family: "Parent" };
    const list = text(await members(ORG_WITH_MODULES));
    expect(list).toContain("Viewer · invited");
    expect(list).toContain("Athlete · parent@example.test");
    expect(list).toMatch(/Admin · owner@example\.test/);
    expect(list).not.toMatch(/Grand Poobah|Coordinator|Board Member|Executive Director/);

    const page = text(await memberPage(ORG_WITH_MODULES, MEMBER_ID));
    expect(page).not.toMatch(/Grand Poobah|Coordinator|Board Member|Executive Director/);
  });

  it("a leftover staff row reads as Admin, never as staff", async () => {
    const html = await members(ORG_WITHOUT_MODULES);
    expect(text(html)).toContain("Admin · outsider@example.test");
    expect(html).not.toMatch(/>[^<]*\b[Ss]taff\b[^<]*</);
  });
});

// Verified this law bites: put "staff" back in ASSIGNABLE_ROLES (the
// invite picker and the member page offered it, and the actions
// accepted it), then separately parsed changeMemberRole's role against
// ORG_ROLES, ran `npx vitest run accessLaws`, watched each fail,
// reverted.
describe("LAW: nothing offers staff, and the invite and role change refuse it without writing", () => {
  it("the invite picker offers Admin, Viewer and Athlete, in that order, and nothing else", async () => {
    const html = await invitePage();
    expect(selectOptions(html, "role")).toEqual([
      ["owner", "Admin"],
      ["member", "Viewer"],
      ["family", "Athlete"],
    ]);
  });

  it("no member page offers staff, for any kind of person", async () => {
    data.org_members.push({ id: "m-staff", user_id: OUTSIDER_ID, org_id: data.orgs[0]!.id, role: "staff" });
    for (const who of [MEMBER_ID, FAMILY_ID, OWNER_ID, OUTSIDER_ID]) {
      const html = await memberPage(ORG_WITH_MODULES, who);
      expect(html, who).not.toContain('value="staff"');
    }
    // The leftover staff row is shown as the Admin it is.
    const staffPage = text(await memberPage(ORG_WITH_MODULES, OUTSIDER_ID));
    expect(staffPage).toMatch(/Admin · outsider@example\.test/);
  });

  it("an invite for staff is refused before anything is written", async () => {
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "new@example.test", role: "staff" })));
    expect(r.redirect).toBeNull();
    expect((r.state as { errors: Record<string, string> }).errors.role).toMatch(/Admin, Viewer or Athlete/);
    expect(writes).toEqual([]);
  });

  it("a role change to staff is refused before anything is written, confirmed or not", async () => {
    const { changeMemberRole, changeMemberRoleForm } = await import("@/lib/actions/members");
    expect(await changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "staff")).toEqual({ ok: false, error: "Pick Admin, Viewer or Athlete." });
    expect((await changeMemberRole(ORG_WITH_MODULES, FAMILY_ID, "staff", { confirmed: true })).ok).toBe(false);
    const viaForm = await run(() => changeMemberRoleForm(ORG_WITH_MODULES, MEMBER_ID, form({ role: "staff" })));
    expect(viaForm.redirect).toMatch(/\?error=/);
    expect(writes).toEqual([]);
    expect(data.org_members.find((m) => m.user_id === MEMBER_ID && m.org_id === data.orgs[0]!.id)!.role).toBe("member");
  });
});

// Verified this law bites: (a) swapped requireOwner for
// requireRole(org.id, ["owner", "staff", "member", "family"]) in
// setMemberTitle, and a Viewer's title write went through; (b) showed
// the access name instead of personLabel(advisor) on the Athlete
// screen's Your Advisor row, and the Title vanished; (c) dropped `title`
// from the members list select. Each failed here, and passes again
// reverted.
describe("LAW: an Admin sets a Title, it shows where the person is named, and nobody else can set one", () => {
  it("an Admin's Title is written by org and person, and shows on the members list", async () => {
    const { setMemberTitle } = await import("@/lib/actions/members");
    const r = await setMemberTitle(ORG_WITH_MODULES, MEMBER_ID, "  Board Chair ");
    expect(r).toEqual({ ok: true, title: "Board Chair" });
    const update = writes.find((w) => w.table === "org_members" && w.op === "update");
    expect(update?.rows[0]).toEqual({ title: "Board Chair" });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { column: "org_id", value: data.orgs[0]!.id },
        { column: "user_id", value: MEMBER_ID },
      ]),
    );
    const list = text(await members(ORG_WITH_MODULES));
    expect(list).toContain("Board Chair · Viewer · invited");
    const page = text(await memberPage(ORG_WITH_MODULES, MEMBER_ID));
    expect(page).toContain("Board Chair · Viewer · member@example.test");
  });

  it("the advisor's Title shows on the Athlete screen, the athlete page and the Advisor picker", async () => {
    const { setMemberTitle } = await import("@/lib/actions/members");
    expect((await setMemberTitle(ORG_WITH_MODULES, OWNER_ID, "Director of Advising")).ok).toBe(true);
    const athlete = { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }) };

    currentUser = FAMILY_ID;
    const family = text(await render("@/app/org/[slug]/family/[id]/page", athlete));
    expect(family).toMatch(/Your Advisor[\s\S]*Example Owner[\s\S]*Director of Advising · owner@example\.test/);

    currentUser = OWNER_ID;
    const staff = text(await render("@/app/org/[slug]/roster/[id]/page", athlete));
    expect(staff).toMatch(/Advisor[\s\S]*Example Owner[\s\S]*Director of Advising · owner@example\.test/);

    // The Advisor picker is on Add only (Stage 5, Phase 2); Edit no
    // longer offers it, the athlete page's sheet does.
    const add = await render("@/app/org/[slug]/roster/new/page", { params: P({ slug: ORG_WITH_MODULES }) });
    expect(selectOptions(add, "advisorId")).toContainEqual([OWNER_ID, "Example Owner, Director of Advising"]);
  });

  it("with no Title, the access level shows instead", async () => {
    data.org_members.find((m) => m.id === "m1")!.title = null;
    currentUser = FAMILY_ID;
    const family = text(await render("@/app/org/[slug]/family/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }));
    expect(family).toMatch(/Your Advisor[\s\S]*Example Owner[\s\S]*Admin · owner@example\.test/);
  });

  it("a Viewer, an Athlete login and a leftover staff row cannot set a Title, and nothing is written", async () => {
    data.org_members.push({ id: "m-staff", user_id: OUTSIDER_ID, org_id: data.orgs[0]!.id, role: "staff" });
    const { setMemberTitle, setMemberTitleForm } = await import("@/lib/actions/members");
    for (const who of [MEMBER_ID, FAMILY_ID, OUTSIDER_ID]) {
      currentUser = who;
      await expect(setMemberTitle(ORG_WITH_MODULES, MEMBER_ID, "Self Appointed")).rejects.toThrow(REDIRECT + "/unauthorized");
      await expect(setMemberTitleForm(ORG_WITH_MODULES, who, form({ title: "Self Appointed" }))).rejects.toThrow(REDIRECT + "/unauthorized");
    }
    expect(writes).toEqual([]);
  });

  it("a Title over 80 characters, or for someone outside the org, is refused without writing; a blank one clears", async () => {
    const { setMemberTitle } = await import("@/lib/actions/members");
    expect((await setMemberTitle(ORG_WITH_MODULES, MEMBER_ID, "x".repeat(81))).ok).toBe(false);
    // The outsider belongs to the other org only.
    expect(await setMemberTitle(ORG_WITH_MODULES, OUTSIDER_ID, "Treasurer")).toEqual({ ok: false, error: "That person is not in this organization." });
    expect(writes).toEqual([]);

    expect(await setMemberTitle(ORG_WITH_MODULES, OWNER_ID, "   ")).toEqual({ ok: true, title: null });
    expect(writes.find((w) => w.table === "org_members" && w.op === "update")?.rows[0]).toEqual({ title: null });
  });
});
