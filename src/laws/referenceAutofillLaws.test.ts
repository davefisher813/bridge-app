// Stage 4 on the schools, targets and reference screens: pick instead of
// type, fill what is blank from what is on file, and one row per school.
//
// Dave, 2026-09-27: "more buttons, less typing." Every list here is a
// suggestion (SuggestField): a pick fills, anything typed is kept, and a
// fill only ever lands in a blank field. The data the fills come from is
// the shared directory (schools, college_coaches, high_schools) and this
// org's own rows, never another org's.
//
// Same harness as actionRun.test.ts (vi.mock is per file). Each law was
// planted, watched to fail, and reverted; the plant is named on each.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
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

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}

const p = (o: Record<string, string>) => Promise.resolve(o);
const rows = (table: string) => data[table] as Record<string, unknown>[];

// The <datalist> a SuggestField renders for the field with this id.
function datalist(html: string, fieldId: string): string {
  const start = html.indexOf(`<datalist id="${fieldId}-options"`);
  expect(start, `no suggestion list for ${fieldId}`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</datalist>", start));
}

describe("LAW: one row per school in the shared directory (B3)", () => {
  // Plant: made schoolNamed() compare the exact name instead of the key;
  // the padded, lowercase name was added as a second row.
  it("Add School refuses a name already on file, however it is spaced or cased, and writes nothing", async () => {
    const { createSchool } = await import("@/lib/actions/schools");
    const r = await run(() => createSchool(ORG_WITH_MODULES, { errors: {} }, form({ name: "  fixture state university ", division: "D2" })));
    expect(r.redirect).toBeNull();
    const state = r.state as { errors: Record<string, string>; duplicateOf?: { id: string } };
    expect(state.duplicateOf?.id).toBe(IDS.school);
    expect(state.errors.name).toMatch(/already on file/);
    expect(writes).toEqual([]);
  });

  it("renaming a school onto another school's name is refused the same way", async () => {
    const { updateSchool } = await import("@/lib/actions/schools");
    const r = await run(() => updateSchool(ORG_WITH_MODULES, IDS.schoolD3, { errors: {} }, form({ name: "FIXTURE STATE UNIVERSITY", division: "D3" })));
    expect((r.state as { duplicateOf?: { id: string } }).duplicateOf?.id).toBe(IDS.school);
    expect(writes).toEqual([]);
  });

  // Plant: dropped escapeIlike() and the name-key compare from the
  // lookup; "Fixture%" matched Fixture State University as a wildcard
  // and was refused.
  it("a % or _ in a name is literal, not a wildcard", async () => {
    const { createSchool } = await import("@/lib/actions/schools");
    const r = await run(() => createSchool(ORG_WITH_MODULES, { errors: {} }, form({ name: "Fixture%", division: "D3" })));
    expect(r.redirect).toMatch(/\/schools\//);
    expect(writes.some((w) => w.table === "schools" && w.op === "insert")).toBe(true);
  });

  // Plant: put the exact-name `.in("name", names)` lookup back in the
  // import; the sheet's padded lowercase row became a second school.
  it("the CSV import matches a school on file by name key, updates it in place and keeps its spelling", async () => {
    const s = rows("schools").find((x) => x.id === IDS.school)!;
    s.academics = { ...(s.academics as object), majorAvailability: { Biology: "strong" }, majorsNote: "Kept: the sheet has no column for it." };
    const header = readFileSync("public/templates/schools.csv", "utf8").split("\n")[0];
    const line = " fixture state university,D2,d2_naia,Fixture Conference,CT,baseball,2.7,3.3,1100-1300,22-27,partial,9500,6000,11000,32000,39000,3,competitive,Business;Biology,Fixture Coach,coach@fixture-state.test,MIF 2027,";
    const fd = new FormData();
    fd.append("file", new File([`${header}\n${line}\n`], "schools.csv", { type: "text/csv" }));
    const { importSchools } = await import("@/lib/actions/schools");
    const r = await run(() => importSchools(ORG_WITH_MODULES, { errors: {}, problems: [] }, fd));
    expect(r.redirect, JSON.stringify(r.state)).toContain("/schools?imported=1");
    expect(writes.some((w) => w.table === "schools" && w.op === "insert")).toBe(false);
    expect(rows("schools").filter((x) => String(x.name).trim().toLowerCase() === "fixture state university")).toHaveLength(1);
    expect(s.name).toBe("Fixture State University");
    expect(s.academics).toMatchObject({ gpaMin: 2.7, majorAvailability: { Biology: "strong" }, majorsNote: "Kept: the sheet has no column for it." });
  });

  it("the school form picks a state from the list, suggests the conferences on file, and keeps an unknown code", async () => {
    const add = await render("@/app/org/[slug]/schools/new/page", { params: p({ slug: ORG_WITH_MODULES }) });
    expect(datalist(add, "school-conference")).toMatch(/Fixture Conference[\s\S]*Fixture League/);
    expect(add).toMatch(/<select[^>]*name="state"[\s\S]*Connecticut/);
    rows("schools").find((x) => x.id === IDS.schoolD3)!.state = "ON";
    const edit = await render("@/app/org/[slug]/schools/[id]/edit/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) });
    expect(edit).toMatch(/<option value="ON" selected="">ON<\/option>/);
    expect(edit).toContain("Fixture Town, NY");
  });
});

describe("LAW: a coach picked from the directory fills what is blank, and only that (B1, B4)", () => {
  // Plant: made saveOrgSchoolNote ignore the directory; the email saved
  // as null.
  it("Head Coach picked by name, any case, with Coach Email blank saves the listed email", async () => {
    const { saveOrgSchoolNote } = await import("@/lib/actions/schools");
    await run(() => saveOrgSchoolNote(ORG_WITH_MODULES, IDS.school, { errors: {} }, form({ coachName: "fixture assistant", coachEmail: "" })));
    const row = writes.find((w) => w.table === "org_school_notes" && w.op === "upsert")!.rows[0];
    expect(row).toMatchObject({ coach_name: "fixture assistant", coach_email: "assistant@fixture.example" });
  });

  // Plant: filled the directory email even when one was typed; the
  // typed address was replaced.
  it("a typed email always wins, and a coach with no listed email fills nothing", async () => {
    const { saveOrgSchoolNote } = await import("@/lib/actions/schools");
    await run(() => saveOrgSchoolNote(ORG_WITH_MODULES, IDS.school, { errors: {} }, form({ coachName: "Fixture Assistant", coachEmail: "typed@example.test" })));
    await run(() => saveOrgSchoolNote(ORG_WITH_MODULES, IDS.school, { errors: {} }, form({ coachName: "Fixture Head" })));
    const saved = writes.filter((w) => w.table === "org_school_notes" && w.op === "upsert").map((w) => w.rows[0].coach_email);
    expect(saved).toEqual(["typed@example.test", null]);
  });

  it("the school page's Head Coach suggests that school's staff", async () => {
    const html = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    const list = datalist(html, "note-coach");
    expect(list).toContain('value="Fixture Assistant"');
    expect(list).toContain('value="Fixture Head"');
  });

  // Plant: passed no coaches to TargetForm on the edit page; the list
  // came back empty.
  it("Add Target and Edit Target suggest the picked school's coaches", async () => {
    const edit = await render("@/app/org/[slug]/board/[id]/edit/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) });
    expect(datalist(edit, "target-coach")).toMatch(/Fixture Assistant[\s\S]*Fixture Head/);
    const add = await render("@/app/org/[slug]/board/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(add).toContain('id="target-coach-options"');
  });
});

describe("LAW: high school names come from the directory and the org's own rows (B5, B6)", () => {
  it("the grading scale's School suggests the org's schools, with no spelling instruction", async () => {
    const html = await render("@/app/org/[slug]/grading-scales/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(datalist(html, "scale-school")).toMatch(/Fixture High School|Unscaled High School/);
    expect(html).not.toMatch(/Spell it the way/);
  });

  // Plant: removed the directory lookup from the new list page; the CEEB
  // field rendered empty.
  it("a new approved list defaults its CEEB code to the one on file for the school", async () => {
    const unscaled = await render("@/app/org/[slug]/approved-courses/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ school: "Unscaled High School" }) });
    expect(unscaled).toMatch(/name="ceebCode"[^>]*value="123456"/);
    // No directory code for this one: the portal's list has it.
    const fixture = await render("@/app/org/[slug]/approved-courses/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ school: "Fixture High School" }) });
    expect(fixture).toMatch(/name="ceebCode"[^>]*value="000000"/);
  });

  it("opened for a school this org already has a list for, it opens that list filled in", async () => {
    const html = await render("@/app/org/[slug]/approved-courses/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({ school: "unscaled high school" }) });
    expect(html).toMatch(/Unscaled High School[\s\S]*Algebra II[\s\S]*partial, typed here/);
  });

  // Plant: put the notFound() for a missing school back; the page threw
  // NEXT_NOT_FOUND.
  it("opened with no school, it asks Which School instead of Not Found", async () => {
    const html = await render("@/app/org/[slug]/approved-courses/new/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(html).toMatch(/Which School/);
    expect(datalist(html, "list-school")).toMatch(/Unscaled High School/);
    const { pickApprovedListSchool } = await import("@/lib/actions/approvedCourses");
    const r = await run(() => pickApprovedListSchool(ORG_WITH_MODULES, form({ school: " St. Mary's & Co " })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/approved-courses/new?school=${encodeURIComponent("St. Mary's & Co")}`);
  });

  // Plant: went back to one row linking /approved-courses/new with no
  // school; the ?school= link disappeared.
  it("each missing school on the caveats page opens its own entry screen, named", async () => {
    data.org_approved_course_lists = [];
    data.org_approved_courses = [];
    data.org_grading_scales = [];
    // A number grade at a school with no table anywhere.
    rows("athlete_courses").find((c) => c.id === "ac2")!.grade = "92";
    const html = await render("@/app/org/[slug]/roster/[id]/eligibility/caveats/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(html).toContain(`/approved-courses/new?school=${encodeURIComponent("Unscaled High School")}`);
    expect(html).toContain(`/grading-scales/new?school=${encodeURIComponent("Unscaled High School")}`);
    expect(html).not.toMatch(/href="\/org\/[^"]+\/approved-courses\/new"/);
  });
});

describe("LAW: notes on the log and on a window are multi-line and saved (B2, B7)", () => {
  // Plant: dropped notes from the insert in createTransferWindow; the
  // row saved without it.
  it("adding a window saves its note, and the list shows it", async () => {
    const { createTransferWindow } = await import("@/lib/actions/transferWindows");
    const r = await run(() =>
      createTransferWindow(
        ORG_WITH_MODULES,
        { errors: {} },
        form({ sport: "Soccer", division: "D1", seasonYear: "2026", windowLabel: "Winter", opensOn: "2026-12-01", closesOn: "2026-12-15", sourceUrl: "https://ncaa.org/windows", notes: "  Graduate students only.  " }),
      ),
    );
    expect(r.redirect).toContain("/transfer-windows?notice=");
    expect(writes.find((w) => w.table === "transfer_windows" && w.op === "insert")?.rows[0]).toMatchObject({ notes: "Graduate students only." });
    const list = await render("@/app/org/[slug]/transfer-windows/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(list).toMatch(/Fixture window[\s\S]*Fixture window note\./);
  });

  it("a note over the column's limit is refused on its field", async () => {
    const { createTransferWindow } = await import("@/lib/actions/transferWindows");
    const r = await run(() =>
      createTransferWindow(
        ORG_WITH_MODULES,
        { errors: {} },
        form({ sport: "Soccer", division: "D1", seasonYear: "2026", windowLabel: "Winter", opensOn: "2026-12-01", closesOn: "2026-12-15", sourceUrl: "https://ncaa.org/windows", notes: "x".repeat(4001) }),
      ),
    );
    expect((r.state as { errors: Record<string, string> }).errors.notes).toBeDefined();
    expect(writes).toEqual([]);
  });

  // Plant: turned the visit Impression back into a one-line Field; the
  // textarea for it was gone.
  it("the log's Notes, and a visit's Impression, Next Step and Notes, are multi-line boxes", async () => {
    const html = await render("@/app/org/[slug]/board/[id]/edit/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) });
    for (const name of ["notes", "impression", "nextStep"]) expect(html).toMatch(new RegExp(`<textarea[^>]*name="${name}"`));
    expect(html).not.toMatch(/<input[^>]*name="(impression|nextStep)"/);
  });
});
