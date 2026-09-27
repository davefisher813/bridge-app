// The shared directory (schools, college coaches, transfer windows) is
// read by every organization, so a write to it is a write for all of
// them. Owning an org is not enough to make one: the org must also be a
// directory editor, orgs.edits_shared_directory (migration 0040). Only
// the first org of a fresh install gets it from create_org; any other is
// set by hand. And create_org itself refuses anyone who works inside an
// org as staff, a member or a family login, so nobody reaches an owner's
// doors by starting an org of their own.
//
// Merging two school rows touches every org's private notes and targets
// on them, most of which the merging owner cannot even see. A merge
// never deletes another org's words: notes on both rows are joined under
// "Merged from <name>.", and two targets for one athlete keep the more
// advanced stage and both sets of notes and offers.
//
// Each law runs the real server action against the fixture through the
// fake client, the same harness as referenceCrudLaws.test.ts (vi.mock is
// per file, so it is copied here). The fixture's Bridge org is a
// directory editor and its Elite org is not; OWNER_ID owns both.
//
// Each was proven to bite by planting a violation, watching it fail, and
// reverting: requireOwner in place of requireDirectoryEditor in each of
// the three action files and on the screens; orgEditsSharedDirectory
// answering true for any org, or for any truthy value; the school page
// handing a non-editor owner the owner's profile; the old merge that deleted a second org's
// notes; a merge that kept the kept target's stage whatever the
// duplicate's; dropping the positions dedupe; the fake create_org
// without the non-owner refusal or the first-org flag; the root page
// offering Create to everybody.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture, FAMILY_ID, IDS, MEMBER_ID, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OUTSIDER_ID, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

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
// The service role. Its writes land in the same list, so a law can say
// that no write of any kind happened.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
});

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; state: unknown }> {
  try {
    const state = await fn();
    return { redirect: null, state };
  } catch (e) {
    const message = (e as Error).message;
    if (message.startsWith(REDIRECT)) return { redirect: message.slice(REDIRECT.length), state: null };
    throw e;
  }
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

function csvForm(): FormData {
  const fd = new FormData();
  fd.append("file", new File([readFileSync("public/templates/schools.csv", "utf8")], "schools.csv", { type: "text/csv" }));
  return fd;
}

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}

const p = (o: Record<string, string>) => Promise.resolve(o);
const BRIDGE = () => data.orgs![0].id as string;
const ELITE = () => data.orgs![1].id as string;
const rows = (table: string) => data[table] as Record<string, unknown>[];
const snapshot = () => JSON.stringify({ s: rows("schools"), c: rows("college_coaches"), w: rows("transfer_windows"), n: rows("org_school_notes"), t: rows("recruiting_targets") });

const SCHOOL = { name: "Brand New College", division: "D2", state: "RI" };
const COACH = { name: "New Coach", title: "Pitching Coach", email: "new@fixture.example" };
const WINDOW = { sport: "baseball", division: "D1", seasonYear: "2027", windowLabel: "Spring", opensOn: "2027-04-01", closesOn: "2027-04-15", sourceUrl: "https://example.test/spring" };

// Every service-role write to the shared tables, as (slug) => call.
async function sharedWrites() {
  const schools = await import("@/lib/actions/schools");
  const coaches = await import("@/lib/actions/coaches");
  const windows = await import("@/lib/actions/transferWindows");
  return {
    createSchool: (slug: string) => schools.createSchool(slug, { errors: {} }, form(SCHOOL)),
    updateSchool: (slug: string) => schools.updateSchool(slug, IDS.school, { errors: {} }, form({ name: "Fixture State University", division: "D1", state: "CT" })),
    importSchools: (slug: string) => schools.importSchools(slug, { errors: {}, problems: [] }, csvForm()),
    deleteSchool: (slug: string) => schools.deleteSchool(slug, "unused-school"),
    mergeSchool: (slug: string) => schools.mergeSchool(slug, IDS.schoolD3, form({ mergeInto: IDS.school })),
    createCoach: (slug: string) => coaches.createCoach(slug, IDS.school, { errors: {} }, form(COACH)),
    updateCoach: (slug: string) => coaches.updateCoach(slug, IDS.school, "cc1", { errors: {} }, form({ name: "Fixture Assistant", title: "Associate Head Coach" })),
    deleteCoach: (slug: string) => coaches.deleteCoach(slug, IDS.school, "cc2"),
    createTransferWindow: (slug: string) => windows.createTransferWindow(slug, { errors: {} }, form(WINDOW)),
    updateTransferWindow: (slug: string) => windows.updateTransferWindow(slug, "tw1", { errors: {} }, form({ ...WINDOW, division: "D2", seasonYear: "2026", windowLabel: "Fixture window" })),
    deleteTransferWindow: (slug: string) => windows.deleteTransferWindow(slug, "tw1"),
  };
}

function seedUnusedSchool() {
  rows("schools").push({ id: "unused-school", name: "Unused College", division: "D3", conference: null, sports_sponsored: [], academics: {}, financials: {}, athletics: {}, conflicts: [], profile_date: null, program_tier: null, state: "RI", location: null, majors: [] });
}

describe("LAW: only a directory editor writes the shared directory", () => {
  it("the fixture has one of each: Bridge edits the directory, Elite does not", () => {
    expect(data.orgs![0]).toMatchObject({ slug: ORG_WITH_MODULES, edits_shared_directory: true });
    expect(data.orgs![1]).toMatchObject({ slug: ORG_WITHOUT_MODULES, edits_shared_directory: false });
  });

  it("an owner of an org that is not a directory editor is refused on every shared write, and nothing is written", async () => {
    const calls = await sharedWrites();
    for (const [name, call] of Object.entries(calls)) {
      data = buildFixture();
      seedUnusedSchool();
      writes.length = 0;
      const before = snapshot();
      const r = await run(() => call(ORG_WITHOUT_MODULES));
      expect(r.redirect, name).toBe("/unauthorized");
      expect(writes, name).toEqual([]);
      expect(snapshot(), name).toBe(before);
    }
  });

  it("staff, and a member, are refused the same way", async () => {
    const calls = await sharedWrites();
    for (const [who, slug] of [
      [OUTSIDER_ID, ORG_WITHOUT_MODULES],
      [MEMBER_ID, ORG_WITH_MODULES],
    ] as const) {
      currentUser = who;
      for (const [name, call] of Object.entries(calls)) {
        writes.length = 0;
        expect((await run(() => call(slug))).redirect, `${who} ${name}`).toBe("/unauthorized");
        expect(writes, `${who} ${name}`).toEqual([]);
      }
    }
  });

  it("a directory editor succeeds on every shared write", async () => {
    const calls = await sharedWrites();
    const landed: Record<string, (r: { redirect: string | null }) => void> = {
      createSchool: () => expect(rows("schools").some((s) => s.name === "Brand New College")).toBe(true),
      updateSchool: () => expect(rows("schools").find((s) => s.id === IDS.school)).toMatchObject({ division: "D1" }),
      importSchools: (r) => {
        expect(r.redirect).toMatch(/\/schools\?imported=2$/);
        expect(rows("schools").some((s) => s.name === "Granite State University")).toBe(true);
      },
      deleteSchool: () => expect(rows("schools").some((s) => s.id === "unused-school")).toBe(false),
      mergeSchool: () => expect(rows("schools").some((s) => s.id === IDS.schoolD3)).toBe(false),
      createCoach: () => expect(rows("college_coaches").some((c) => c.name === "New Coach")).toBe(true),
      updateCoach: () => expect(rows("college_coaches").find((c) => c.id === "cc1")).toMatchObject({ title: "Associate Head Coach" }),
      deleteCoach: () => expect(rows("college_coaches").some((c) => c.id === "cc2")).toBe(false),
      createTransferWindow: () => expect(rows("transfer_windows").some((w) => w.window_label === "Spring")).toBe(true),
      updateTransferWindow: () => expect(rows("transfer_windows").find((w) => w.id === "tw1")).toMatchObject({ notes: null }),
      deleteTransferWindow: () => expect(rows("transfer_windows").some((w) => w.id === "tw1")).toBe(false),
    };
    for (const [name, call] of Object.entries(calls)) {
      data = buildFixture();
      seedUnusedSchool();
      writes.length = 0;
      const r = await run(() => call(ORG_WITH_MODULES));
      expect(r.redirect, name).not.toBe("/unauthorized");
      expect(r.redirect, name).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/`));
      expect(writes.length, name).toBeGreaterThan(0);
      landed[name]!(r);
    }
  });

  it("the flag is read for the org in the URL, and a missing flag reads as off", async () => {
    const { orgEditsSharedDirectory } = await import("@/lib/auth/guard");
    expect(await orgEditsSharedDirectory(BRIDGE())).toBe(true);
    expect(await orgEditsSharedDirectory(ELITE())).toBe(false);
    delete data.orgs![0].edits_shared_directory;
    expect(await orgEditsSharedDirectory(BRIDGE())).toBe(false);
    data.orgs![0].edits_shared_directory = "true";
    expect(await orgEditsSharedDirectory(BRIDGE())).toBe(false);
  });
});

describe("LAW: the directory's controls show only to a directory editor; everyone keeps read access", () => {
  const schoolsList = (slug: string) => render("@/app/org/[slug]/schools/page", { params: p({ slug }), searchParams: p({}) });
  const schoolPage = (slug: string) => render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug, id: IDS.school }), searchParams: p({}) });
  const windowsList = (slug: string) => render("@/app/org/[slug]/transfer-windows/page", { params: p({ slug }), searchParams: p({}) });
  const newTarget = (slug: string) => render("@/app/org/[slug]/board/new/page", { params: p({ slug }) });

  it("an editor sees Add, Import, Edit, the coach list and window controls", async () => {
    const list = await schoolsList(ORG_WITH_MODULES);
    expect(list).toContain(`/org/${ORG_WITH_MODULES}/schools/new`);
    expect(list).toContain(`/org/${ORG_WITH_MODULES}/schools/import`);
    const school = await schoolPage(ORG_WITH_MODULES);
    expect(school).toContain(`/schools/${IDS.school}/edit`);
    expect(school).toContain(`/schools/${IDS.school}/coaches`);
    const windows = await windowsList(ORG_WITH_MODULES);
    expect(windows).toContain("/transfer-windows/new");
    expect(windows).toContain("/transfer-windows/tw1/edit");
    expect(await newTarget(ORG_WITH_MODULES)).toContain(`/org/${ORG_WITH_MODULES}/schools/new`);
  });

  it("an owner of a non-editor org reads the same directory with no way to change it", async () => {
    const list = await schoolsList(ORG_WITHOUT_MODULES);
    expect(list).toContain("Fixture State University");
    expect(list).not.toContain("/schools/new");
    expect(list).not.toContain("/schools/import");
    const school = await schoolPage(ORG_WITHOUT_MODULES);
    expect(school).toContain("Fixture Assistant");
    expect(school).not.toContain("/edit");
    expect(school).not.toContain("/coaches");
    const windows = await windowsList(ORG_WITHOUT_MODULES);
    expect(windows).toContain("Fixture window");
    expect(windows).not.toContain("/transfer-windows/new");
    expect(windows).not.toContain("/edit");
    expect(windows).not.toContain("Remove");
    expect(await newTarget(ORG_WITHOUT_MODULES)).not.toContain("/schools/new");
  });

  it("a non-editor owner's school page is exactly what staff in that org see: no tile that opens a form, none that goes nowhere", async () => {
    const asOwner = await schoolPage(ORG_WITHOUT_MODULES);
    currentUser = OUTSIDER_ID;
    const asStaff = await schoolPage(ORG_WITHOUT_MODULES);
    expect(asOwner).toBe(asStaff);
  });

  it("the directory's own edit screens send a non-editor owner to Not Authorized", async () => {
    const slug = ORG_WITHOUT_MODULES;
    for (const [path, props] of [
      ["@/app/org/[slug]/schools/new/page", { params: p({ slug }) }],
      ["@/app/org/[slug]/schools/[id]/edit/page", { params: p({ slug, id: IDS.school }), searchParams: p({}) }],
      ["@/app/org/[slug]/schools/import/page", { params: p({ slug }) }],
      ["@/app/org/[slug]/schools/[id]/coaches/page", { params: p({ slug, id: IDS.school }) }],
      ["@/app/org/[slug]/schools/[id]/coaches/new/page", { params: p({ slug, id: IDS.school }) }],
      ["@/app/org/[slug]/schools/[id]/coaches/[coachId]/page", { params: p({ slug, id: IDS.school, coachId: "cc1" }) }],
      ["@/app/org/[slug]/transfer-windows/new/page", { params: p({ slug }) }],
      ["@/app/org/[slug]/transfer-windows/[id]/edit/page", { params: p({ slug, id: "tw1" }) }],
    ] as const) {
      await expect(render(path, props), path).rejects.toThrow(`${REDIRECT}/unauthorized`);
    }
  });
});

describe("LAW: a merge never deletes another org's notes, and keeps the more advanced stage", () => {
  it("both orgs' notes on both rows end up on the kept row, joined, with positions deduped", async () => {
    rows("org_school_notes").push(
      { id: "osn-bridge-d3", org_id: BRIDGE(), school_id: IDS.schoolD3, coach_name: "Other Coach", coach_email: null, positions_of_need: [{ position: "MIF", gradYear: 2027 }, { position: "C" }], notes: "Bridge's note on the duplicate.", updated_at: "2026-09-01" },
      { id: "osn-elite-kept", org_id: ELITE(), school_id: IDS.school, coach_name: null, coach_email: null, positions_of_need: [{ position: "LHP", gradYear: 2028 }], notes: "Elite's note on the kept school.", updated_at: "2026-09-01" },
      { id: "osn-elite-d3", org_id: ELITE(), school_id: IDS.schoolD3, coach_name: "Elite's Contact", coach_email: "contact@elite.example", positions_of_need: [{ position: "lhp", gradYear: 2028 }, { position: "OF" }], notes: "Elite's note on the duplicate.", updated_at: "2026-09-01" },
    );
    const { mergeSchool } = await import("@/lib/actions/schools");
    const r = await run(() => mergeSchool(ORG_WITH_MODULES, IDS.schoolD3, form({ mergeInto: IDS.school })));
    expect(r.redirect).toContain(`/schools/${IDS.school}?notice=`);

    const notes = rows("org_school_notes");
    expect(notes.some((n) => n.school_id === IDS.schoolD3)).toBe(false);
    const bridge = notes.filter((n) => n.org_id === BRIDGE());
    const elite = notes.filter((n) => n.org_id === ELITE());
    expect(bridge).toHaveLength(1);
    expect(elite).toHaveLength(1);

    expect(bridge[0]).toMatchObject({ id: "osn1", school_id: IDS.school, coach_name: "Fixture Coach" });
    expect(bridge[0]!.notes).toBe("Wants a shortstop for 2027.\n\nMerged from Fixture College.\nBridge's note on the duplicate.");
    expect(bridge[0]!.positions_of_need).toEqual([{ position: "MIF", gradYear: 2027 }, { position: "C" }]);

    // Elite's kept row had no coach, so the duplicate's fills it.
    expect(elite[0]).toMatchObject({ id: "osn-elite-kept", school_id: IDS.school, coach_name: "Elite's Contact", coach_email: "contact@elite.example" });
    expect(elite[0]!.notes).toBe("Elite's note on the kept school.\n\nMerged from Fixture College.\nElite's note on the duplicate.");
    expect(elite[0]!.positions_of_need).toEqual([{ position: "LHP", gradYear: 2028 }, { position: "OF" }]);
  });

  it("two targets for one athlete keep the more advanced stage, and the duplicate's notes and offer", async () => {
    const kept = rows("recruiting_targets").find((t) => t.id === IDS.targetNoCoach)!;
    // targetNoCoach is on the D3 row; move it to the kept school as an
    // early-stage target, and give the same athlete an Offer on the
    // duplicate.
    Object.assign(kept, { school_id: IDS.school, status: "In Contact", notes: "Kept target's own note.", offer_type: "walk_on", offer_scholarship_percent: null });
    rows("recruiting_targets").push({ id: "dup-offer", org_id: BRIDGE(), athlete_id: IDS.athleteNoGpa, school_id: IDS.schoolD3, status: "Offer", closed_from: null, coach_name: "Dup Coach", aid: null, notes: "Offer came after the camp.", offer_type: "scholarship", offer_scholarship_percent: 40, visit_date: null, updated_at: "2026-09-01" });

    const { mergeSchool } = await import("@/lib/actions/schools");
    await run(() => mergeSchool(ORG_WITH_MODULES, IDS.schoolD3, form({ mergeInto: IDS.school })));

    expect(rows("recruiting_targets").some((t) => t.id === "dup-offer")).toBe(false);
    const after = rows("recruiting_targets").find((t) => t.id === IDS.targetNoCoach)!;
    expect(after).toMatchObject({ status: "Offer", coach_name: "Dup Coach", offer_type: "walk_on" });
    expect(after.notes).toBe("Kept target's own note.\n\nMerged from Fixture College.\nOffer: scholarship, 40% scholarship.\nOffer came after the camp.");
  });

  it("Committed wins from either side, and a less advanced duplicate never moves the kept stage back", async () => {
    // targetToClose (In Contact, on the duplicate) meets targetCommitted
    // (Committed, on the kept school): Committed stands.
    const { mergeSchool } = await import("@/lib/actions/schools");
    await run(() => mergeSchool(ORG_WITH_MODULES, IDS.schoolD3, form({ mergeInto: IDS.school })));
    expect(rows("recruiting_targets").find((t) => t.id === IDS.targetCommitted)?.status).toBe("Committed");

    // The other way round: the duplicate is Committed, the kept one is
    // not. The commitment moves onto the kept target, live.
    data = buildFixture();
    const keptOne = rows("recruiting_targets").find((t) => t.id === IDS.targetCommitted)!;
    const dupOne = rows("recruiting_targets").find((t) => t.id === IDS.targetToClose)!;
    Object.assign(keptOne, { status: "Not Interested", closed_from: "Offer" });
    Object.assign(dupOne, { status: "Committed", closed_from: null });
    await run(() => mergeSchool(ORG_WITH_MODULES, IDS.schoolD3, form({ mergeInto: IDS.school })));
    expect(rows("recruiting_targets").find((t) => t.id === IDS.targetCommitted)).toMatchObject({ status: "Committed", closed_from: null });

    // An open stage beats a closed one.
    data = buildFixture();
    Object.assign(rows("recruiting_targets").find((t) => t.id === IDS.targetCommitted)!, { status: "Not Interested", closed_from: "Visit" });
    Object.assign(rows("recruiting_targets").find((t) => t.id === IDS.targetToClose)!, { status: "Target", closed_from: null });
    await run(() => mergeSchool(ORG_WITH_MODULES, IDS.schoolD3, form({ mergeInto: IDS.school })));
    expect(rows("recruiting_targets").find((t) => t.id === IDS.targetCommitted)).toMatchObject({ status: "Target", closed_from: null });
  });
});

describe("LAW: create_org refuses anyone with a membership that is not owner, and flags only the first org", () => {
  it("staff, a member and a family login are refused with 42501 and nothing is written", async () => {
    for (const who of [OUTSIDER_ID, MEMBER_ID, FAMILY_ID]) {
      const recorded: RecordedWrite[] = [];
      const client = createFakeClient(data, { userId: who, recorded });
      const { error } = await client.rpc("create_org", { name: "Refused Org", slug: "refused-org" });
      expect(error, who).toMatchObject({ code: "42501" });
      expect(recorded, who).toEqual([]);
    }
    expect(data.orgs!.some((o) => o.slug === "refused-org")).toBe(false);
  });

  it("an owner of every org they belong to, and someone in no org, may create one, never a directory editor on a populated install", async () => {
    data.users!.push({ id: "fresh-user", email: "fresh@example.test", full_name: "Fresh User", last_sign_in_at: null });
    for (const who of [OWNER_ID, "fresh-user"]) {
      const client = createFakeClient(data, { userId: who, recorded: [] });
      const { data: id, error } = await client.rpc("create_org", { name: `Org for ${who}`, slug: `org-${who.slice(-4)}` });
      expect(error, who).toBeNull();
      expect(data.orgs!.find((o) => o.id === id), who).toMatchObject({ edits_shared_directory: false });
    }
  });

  it("the first org of an empty install edits the shared directory, and the next does not", async () => {
    data.orgs = [];
    data.org_members = [];
    const client = createFakeClient(data, { userId: OWNER_ID, recorded: [] });
    const first = await client.rpc("create_org", { name: "First", slug: "first-org" });
    const second = await client.rpc("create_org", { name: "Second", slug: "second-org" });
    expect(data.orgs.find((o) => o.id === first.data)).toMatchObject({ edits_shared_directory: true });
    expect(data.orgs.find((o) => o.id === second.data)).toMatchObject({ edits_shared_directory: false });
  });

  it("the action says why, rather than sending a signed-in person to sign in", async () => {
    currentUser = OUTSIDER_ID;
    const { createOrg } = await import("@/lib/actions/org");
    const r = await run(() => createOrg({ errors: {} }, form({ name: "Staff Side Project" })));
    expect(r.redirect).toBeNull();
    expect((r.state as { errors: Record<string, string> }).errors.form).toMatch(/Only an owner, or someone not yet in any organization/);
    expect(writes).toEqual([]);
  });

  it("the screens offer Create only to someone create_org would let through", async () => {
    currentUser = MEMBER_ID;
    const picker = await render("@/app/page", {});
    expect(picker).toContain("Choose an Organization");
    expect(picker).not.toContain("/orgs/new");
    const refused = await render("@/app/orgs/new/page", { params: p({}), searchParams: p({}) });
    expect(refused).toMatch(/Only an owner, or someone not yet in any organization/);
    expect(refused).not.toContain("Web Address");

    currentUser = OWNER_ID;
    expect(await render("@/app/page", {})).toContain("/orgs/new");
    expect(await render("@/app/orgs/new/page", { params: p({}), searchParams: p({}) })).toContain("Web Address");
  });

  // Planted: More offered Start Another Organization on user.role alone;
  // an owner who is staff in the other org was offered it. Reverted.
  it("More offers Start Another Organization only to an owner of every org they are in", async () => {
    currentUser = OWNER_ID;
    const more = () => render("@/app/org/[slug]/more/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(await more()).toContain("Start Another Organization");
    const elite = data.orgs.find((o) => o.slug === ORG_WITHOUT_MODULES)!.id;
    data.org_members.find((m) => m.user_id === OWNER_ID && m.org_id === elite)!.role = "staff";
    const html = await more();
    expect(html).toContain("Organization Settings");
    expect(html).not.toContain("Start Another Organization");
    expect(html).not.toContain("/orgs/new");
  });
});
