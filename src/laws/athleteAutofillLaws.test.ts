// Stage 4 on the athlete screens: pick instead of type, fill only what is
// blank, notes only for staff, and nothing borrowed from another org.
//
// Dave, 2026-09-27: "more buttons, less typing", and "there shouldn't be
// data like student athlete data wired into the app". These laws run the
// real server actions against the fixture and read what they wrote:
//
//   - Add Athlete warns on a name already on THIS org's roster and never
//     looks anywhere else
//   - a high school or college name that matches exactly one directory
//     row records that row, and fills Home State or Current Division only
//     when blank
//   - every optional note lands in athlete_notes with this org, this
//     author and the step it was typed on, and a blank note writes nothing
//   - a note can never be filed on another org's athlete
//   - every detail key the schema knows is shown on Edit, so a save can
//     never silently erase one
//
// Each was proven to bite by planting the violation named beside it,
// watching it fail, and reverting.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

// The mock harness from src/laws/actionRun.test.ts, copied because
// vi.mock is per file: the Next runtime pieces an action touches, and
// the fake client standing in for Supabase, recording every write.

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let failOn: (table: string, op: string) => string | null = () => null;

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(REDIRECT + url);
  },
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
  failOn = () => null;
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

const inserts = (table: string) => writes.filter((w) => w.op === "insert" && w.table === table);
const updates = (table: string) => writes.filter((w) => w.op === "update" && w.table === table);
const deletes = (table: string) => writes.filter((w) => w.op === "delete" && w.table === table);
const filterCols = (w: RecordedWrite | undefined) => (w?.filters ?? []).map((f) => f.column);
const bridgeId = () => data.orgs[0]!.id as string;

type State = { errors: Record<string, string>; duplicate?: { id: string; href: string } };
const noteRows = () => inserts("athlete_notes").flatMap((w) => w.rows as { org_id: string; athlete_id: string; author_id: string; context: string; body: string }[]);
const athleteInsert = () => inserts("athletes")[0]?.rows[0] as { home_state: string | null; detail: Record<string, unknown> } | undefined;
const athleteUpdate = (id: string) => updates("athletes").find((w) => w.filters.some((f) => f.column === "id" && f.value === id))?.rows[0] as Record<string, unknown> | undefined;

describe("LAW: Add Athlete warns on a name already on this org's roster, and only this org's", () => {
  // Planted: dropped the `.eq("org_id", org.id)` from the duplicate
  // lookup in createAthlete; "Squad Athlete" (Elite's) then warned in
  // Bridge and the other-org case failed. Reverted.
  it("a padded, lower-case copy of a name on file writes nothing and names the record", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "  fixture athlete ", sport: "Baseball", recruitType: "hs", status: "Active" })));
    expect(r.redirect).toBeNull();
    const state = r.state as State;
    expect(state.duplicate?.id).toBe(IDS.athlete);
    expect(state.duplicate?.href).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}`);
    expect(inserts("athletes")).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("Add Anyway (confirmDuplicate=1) adds the second record", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "Baseball", recruitType: "hs", status: "Active", confirmDuplicate: "1" })));
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/`));
    expect(inserts("athletes")).toHaveLength(1);
  });

  it("another org's athlete of the same name is not a duplicate here", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Squad Athlete", sport: "Baseball", recruitType: "hs", status: "Active" })));
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/`));
    expect((athleteInsert() as { org_id?: string } | undefined)?.org_id).toBe(bridgeId());
  });

  it("a removed athlete's name is free again", async () => {
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-01T00:00:00.000Z";
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "Baseball", recruitType: "hs", status: "Active" })));
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/`));
  });
});

describe("LAW: a directory match fills only what is blank, and records the row", () => {
  // Planted: made fillFromDirectory set homeState whenever the school had
  // a state (dropped `!parsed.values.homeState &&`); the NY case failed
  // with CT. Reverted.
  it("picking Fixture High School fills a blank Home State with CT and records the school", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "New Recruit", sport: "Baseball", recruitType: "hs", status: "Active", highSchool: " fixture high school " })));
    const row = athleteInsert();
    expect(row?.home_state).toBe("CT");
    expect(row?.detail).toMatchObject({ kind: "hs", highSchool: "fixture high school", highSchoolId: IDS.highSchool });
  });

  it("an existing Home State is left alone", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "New Recruit", sport: "Baseball", recruitType: "hs", status: "Active", highSchool: "Fixture High School", homeState: "NY" })));
    expect(athleteInsert()?.home_state).toBe("NY");
    expect(athleteInsert()?.detail.highSchoolId).toBe(IDS.highSchool);
  });

  it("a name the directory does not hold stays text, and an id the client sent is not trusted", async () => {
    // Planted: kept a client-sent highSchoolId when resolution failed
    // (removed `delete detail.highSchoolId`); this failed. Reverted.
    const { createAthlete } = await import("@/lib/actions/athletes");
    await run(() =>
      createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "New Recruit", sport: "Baseball", recruitType: "hs", status: "Active", highSchool: "Nowhere Prep", highSchoolId: IDS.highSchool })),
    );
    const row = athleteInsert();
    expect(row?.detail.highSchool).toBe("Nowhere Prep");
    expect(row?.detail).not.toHaveProperty("highSchoolId");
    expect(row?.home_state).toBeNull();
  });

  it("a transfer's Current School fills a blank Current Division and records the college", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    await run(() =>
      createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "New Transfer", sport: "Baseball", recruitType: "transfer_4to4", status: "Active", currentSchool: "fixture state university", eligibilityYearsRemaining: "2" })),
    );
    expect(athleteInsert()?.detail).toMatchObject({ kind: "transfer", currentDivision: "D2", currentSchoolId: IDS.school });
  });

  it("a typed Current Division is kept", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    await run(() =>
      createAthlete(
        ORG_WITH_MODULES,
        { errors: {}, values: {} },
        form({ name: "New Transfer", sport: "Baseball", recruitType: "transfer_4to4", status: "Active", currentSchool: "Fixture State University", currentDivision: "D1", eligibilityYearsRemaining: "2" }),
      ),
    );
    expect(athleteInsert()?.detail).toMatchObject({ currentDivision: "D1", currentSchoolId: IDS.school });
  });

  it("an edit keeps the high school and its row, and a rename to an unknown school drops the row", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const base = { name: "Fixture Athlete", sport: "Baseball", recruitType: "hs", status: "Active", homeState: "CT" };
    await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ ...base, highSchool: "Fixture High School", highSchoolId: IDS.highSchool })));
    expect(athleteUpdate(IDS.athlete)?.detail).toMatchObject({ highSchool: "Fixture High School", highSchoolId: IDS.highSchool });
    writes.length = 0;
    await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ ...base, highSchool: "Another High", highSchoolId: IDS.highSchool })));
    expect(athleteUpdate(IDS.athlete)?.detail).not.toHaveProperty("highSchoolId");
  });

  it("Reopen Recruiting remembers the college they are leaving on the rebuilt transfer record", async () => {
    // Planted: dropped `currentSchoolId` from the parseAthleteDetail call
    // in lib/data/reopen.ts; this failed. Reverted.
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    await run(() =>
      reopenRecruiting(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ transferKind: "transfer_4to4", currentSchool: "fixture state university", eligibilityYearsRemaining: "2", transferCount: "1" })),
    );
    expect(athleteUpdate(IDS.athleteEnrolled)?.detail).toMatchObject({ kind: "transfer", currentSchoolId: IDS.school, currentDivision: "D2" });
  });

  it("a college coach picked by name fills a blank email and phone, and never a typed one", async () => {
    const { createContact } = await import("@/lib/actions/contacts");
    await run(() => createContact(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ name: " fixture head ", role: "college_coach", schoolId: IDS.school })));
    expect(inserts("contacts")[0]?.rows[0]).toMatchObject({ phone: "555-0100", email: null });
    writes.length = 0;
    await run(() => createContact(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ name: "Fixture Assistant", role: "college_coach", schoolId: IDS.school, email: "typed@example.test" })));
    expect(inserts("contacts")[0]?.rows[0]).toMatchObject({ email: "typed@example.test" });
  });
});

describe("LAW: every optional note is a staff note on this org's athlete, filed under its step", () => {
  // Planted: passed context "general" from markGraduated; the graduated
  // case failed. Planted: wrote author_id: null in addAthleteNote's
  // caller for Add; the author check failed. Both reverted.
  const expectOne = (athleteId: string, context: string, body: string) => {
    const rows = noteRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ org_id: bridgeId(), athlete_id: athleteId, author_id: OWNER_ID, context, body });
  };

  it("Add Athlete files its Notes as a general note on the new record", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Noted Recruit", sport: "Baseball", recruitType: "hs", status: "Active", notes: "  Met at the fall showcase.  " })));
    const id = r.redirect!.split("/").pop()!;
    expectOne(id, "general", "Met at the fall showcase.");
  });

  it("Edit's Add a Note files a general note", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "Baseball", recruitType: "hs", status: "Active", notes: "Wants a campus visit." })));
    expectOne(IDS.athlete, "general", "Wants a campus visit.");
  });

  it("Mark Enrolled files its note as enrolled", async () => {
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ enrolledOn: "2026-09-01", note: "Moved in Friday." })));
    expectOne(IDS.athleteCommitted, "enrolled", "Moved in Friday.");
  });

  it("Mark Graduated files its note as graduated", async () => {
    const { markGraduated } = await import("@/lib/actions/enrollment");
    await run(() => markGraduated(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ graduatedOn: "2026-09-15", note: "Cum laude." })));
    expectOne(IDS.athleteEnrolled, "graduated", "Cum laude.");
  });

  it("Mark Drafted files its note as drafted", async () => {
    const { markDrafted } = await import("@/lib/actions/enrollment");
    await run(() => markDrafted(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ draftTeam: "New York Yankees", note: "Signing bonus pending." })));
    expectOne(IDS.athleteCommitted, "drafted", "Signing bonus pending.");
  });

  it("Reopen Recruiting files its note as reopened", async () => {
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    await run(() =>
      reopenRecruiting(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ transferKind: "transfer_4to4", currentSchool: "Fixture State University", eligibilityYearsRemaining: "2", transferCount: "1", note: "Entering the portal." })),
    );
    expectOne(IDS.athleteEnrolled, "reopened", "Entering the portal.");
  });

  it("the athlete page's Add Note files a general note", async () => {
    const { addNote } = await import("@/lib/actions/athletes");
    await run(() => addNote(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ body: "Called the family." })));
    expectOne(IDS.athlete, "general", "Called the family.");
  });

  it("a blank note writes nothing, on every screen that offers one", async () => {
    const { createAthlete, updateAthlete } = await import("@/lib/actions/athletes");
    const { markEnrolled, markDrafted } = await import("@/lib/actions/enrollment");
    await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Quiet Recruit", sport: "Baseball", recruitType: "hs", status: "Active", notes: "   " })));
    await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "Baseball", recruitType: "hs", status: "Active", notes: "" })));
    await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ enrolledOn: "2026-09-01", note: " " })));
    await run(() => markDrafted(ORG_WITH_MODULES, IDS.athleteDrafted, { errors: {} }, form({ draftTeam: "Fixture Pros" })));
    expect(noteRows()).toEqual([]);
  });

  it("an Elite athlete id under the Bridge slug gets no note, from any screen", async () => {
    // Planted: dropped the `.eq("org_id", org.id)` from addNote's athlete
    // check; the Elite note was filed. Reverted.
    const { addNote } = await import("@/lib/actions/athletes");
    const { markEnrolled, markDrafted } = await import("@/lib/actions/enrollment");
    const note = await run(() => addNote(ORG_WITH_MODULES, IDS.athleteElite, { errors: {} }, form({ body: "Cross-org note." })));
    expect((note.state as State).errors.form).toMatch(/roster/);
    const enrolled = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteElite, { errors: {} }, form({ enrolledOn: "2026-09-01", note: "Cross-org note." })));
    expect(enrolled.redirect).toBe("/unauthorized");
    const drafted = await run(() => markDrafted(ORG_WITH_MODULES, IDS.athleteElite, { errors: {} }, form({ draftTeam: "Fixture Pros", note: "Cross-org note." })));
    expect(drafted.redirect).toBe("/unauthorized");
    expect(noteRows()).toEqual([]);
  });

  it("a member or a family login cannot add a note", async () => {
    const { addNote } = await import("@/lib/actions/athletes");
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      const r = await run(() => addNote(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ body: "Not staff." })));
      expect(r.redirect).toBe("/unauthorized");
    }
    expect(noteRows()).toEqual([]);
  });

  it("a staff note is deleted by id, org and athlete together", async () => {
    const { removeNote } = await import("@/lib/actions/athletes");
    await run(() => removeNote(ORG_WITH_MODULES, IDS.athlete, "an1"));
    const del = deletes("athlete_notes")[0];
    expect(filterCols(del)).toEqual(expect.arrayContaining(["id", "org_id", "athlete_id"]));
    expect(data.athlete_notes.some((n) => n.id === "an1")).toBe(false);
    // Elite's note under the Bridge slug: nothing goes.
    writes.length = 0;
    await run(() => removeNote(ORG_WITH_MODULES, IDS.athleteElite, "an2"));
    expect(data.athlete_notes.some((n) => n.id === "an2")).toBe(true);
  });
});

describe("LAW: Edit shows every detail key the schema knows", () => {
  // Zod strips a key it does not know and the form rebuilds detail key
  // by key, so a key the edit page never passes back is erased by the
  // next save (Stage 4 design, correction 2). The form parser is L6 in
  // autofillLaws; this is the other half, the page's initial values.
  // Planted: removed `highSchoolId: detail.highSchoolId` from the edit
  // page; this failed naming hs.highSchoolId. Reverted.
  it("roster/[id]/edit passes every hs and transfer detail key to the form", async () => {
    const { readFileSync } = await import("node:fs");
    const { athleteDetailSchema } = await import("@/lib/fit/schema");
    const page = readFileSync(`${process.cwd()}/src/app/org/[slug]/roster/[id]/edit/page.tsx`, "utf8");
    const missing: string[] = [];
    for (const option of athleteDetailSchema.options) {
      const kind = String(option.shape.kind.value);
      for (const key of Object.keys(option.shape)) {
        if (key === "kind") continue;
        if (!new RegExp(`\\b${key}:\\s*detail\\.${key}\\b`).test(page)) missing.push(`${kind}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
