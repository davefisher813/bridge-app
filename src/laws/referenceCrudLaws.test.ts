// Everything on the schools, targets and reference screens that can be
// added can also be corrected and removed, and every removal is scoped
// and confirmed (Dave, 2026-09-27: "everything should be very easy for
// anyone to edit anything... add and delete and all that good stuff").
//
// The audit this answers (crud F2, F3, F4, F6, F12, F13, F14, F15, F22)
// found rows that could only be added: a contact log entry on the wrong
// target, a duplicate school, a coach who left, a misread award, a
// transfer window with a wrong date. Each law below runs the real server
// action against the fixture through the fake client, the same harness
// as actionRun.test.ts (vi.mock is per file, so it is copied here), and
// asserts on what was written and what was scoped.
//
// Each was proven to bite by planting a violation, watching it fail, and
// reverting: dropping each org, target or school filter from an update
// or delete; skipping syncCommitment on a removed target; losing the
// award's documentId; saving a school without the row's jsonb; lifting
// the reference check on deleteSchool; skipping the notes move and the
// log move in mergeSchool; taking school_name from the form; lifting
// requireOwner from deleteCoach; dropping the self-exclusion from the
// window duplicate check; replacing a ConfirmButton with a bare submit;
// and unlinking the contact log rows.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, OUTSIDER_ID } from "@/testing/fixture";
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
// The service role, used on purpose by the shared-directory writes
// (schools, coaches, windows). Its writes land in the same list, so a
// law can say no admin write happened.
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
const BRIDGE = () => data.orgs[0].id as string;
const ELITE = () => data.orgs[1].id as string;
const rows = (table: string) => data[table] as Record<string, unknown>[];
const writesTo = (table: string, op?: string) => writes.filter((w) => w.table === table && (!op || w.op === op));
const filterOf = (w: RecordedWrite, column: string) => w.filters?.find((f) => f.column === column)?.value;

// An Elite entry on an Elite target, for the cross-org cases.
function seedEliteTarget() {
  rows("recruiting_targets").push({ id: "elite-target", org_id: ELITE(), athlete_id: IDS.athleteElite, school_id: IDS.school, status: "Target", coach_name: null, offer_type: null, offer_scholarship_percent: null, closed_from: null, updated_at: "2026-09-01" });
  rows("target_communications").push({ id: "elite-comm", org_id: ELITE(), target_id: "elite-target", kind: "call", notes: "Elite's own call.", occurred_on: "2026-09-02" });
  rows("target_visits").push({ id: "elite-visit", org_id: ELITE(), target_id: "elite-target", visit_type: "camp", impression: "Elite's own visit.", visit_date: "2026-09-03", next_step: null, notes: null });
}

describe("LAW: a logged contact or visit can be corrected and removed, on its own target and org only (crud F6)", () => {
  it("updateCommunication rewrites the entry, scoped by entry, target and org", async () => {
    const { updateCommunication } = await import("@/lib/actions/communications");
    const r = await run(() => updateCommunication(ORG_WITH_MODULES, IDS.target, "tc1", { errors: {} }, form({ kind: "call", occurredOn: "2026-08-21", notes: "Corrected." })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/board/${IDS.target}/communications`);
    const [w] = writesTo("target_communications", "update");
    expect(filterOf(w!, "id")).toBe("tc1");
    expect(filterOf(w!, "target_id")).toBe(IDS.target);
    expect(filterOf(w!, "org_id")).toBe(BRIDGE());
    expect(rows("target_communications").find((c) => c.id === "tc1")).toMatchObject({ kind: "call", occurred_on: "2026-08-21", notes: "Corrected." });
  });

  it("another org's entry, or one on another target, is never touched", async () => {
    seedEliteTarget();
    const { updateCommunication, removeCommunication } = await import("@/lib/actions/communications");
    const r = await run(() => updateCommunication(ORG_WITH_MODULES, "elite-target", "elite-comm", { errors: {} }, form({ kind: "email", notes: "Hijacked." })));
    // Another org's target is refused before the entry is looked up.
    expect((r.state as { errors: Record<string, string> }).errors.form).toMatch(/isn't on this org's board/);
    await run(() => removeCommunication(ORG_WITH_MODULES, "elite-target", "elite-comm"));
    await run(() => removeCommunication(ORG_WITH_MODULES, IDS.targetNoCoach, "tc1"));
    expect(rows("target_communications").find((c) => c.id === "elite-comm")).toMatchObject({ notes: "Elite's own call." });
    expect(rows("target_communications").some((c) => c.id === "tc1")).toBe(true);
  });

  it("removeCommunication deletes the one entry", async () => {
    const { removeCommunication } = await import("@/lib/actions/communications");
    const r = await run(() => removeCommunication(ORG_WITH_MODULES, IDS.target, "tc2"));
    expect(r.redirect).toContain(`/board/${IDS.target}/communications`);
    expect(rows("target_communications").map((c) => c.id)).toEqual(["tc1"]);
  });

  it("updateVisit and removeVisit are scoped the same way", async () => {
    seedEliteTarget();
    const { updateVisit, removeVisit } = await import("@/lib/actions/visits");
    await run(() => updateVisit(ORG_WITH_MODULES, IDS.target, "tv1", { errors: {} }, form({ visitType: "official", visitDate: "2026-07-05", impression: "Better than it looked." })));
    expect(rows("target_visits").find((v) => v.id === "tv1")).toMatchObject({ visit_type: "official", visit_date: "2026-07-05", impression: "Better than it looked." });
    await run(() => removeVisit(ORG_WITH_MODULES, "elite-target", "elite-visit"));
    expect(rows("target_visits").some((v) => v.id === "elite-visit")).toBe(true);
    await run(() => removeVisit(ORG_WITH_MODULES, IDS.target, "tv1"));
    expect(rows("target_visits").some((v) => v.id === "tv1")).toBe(false);
  });

  it("a member cannot correct or remove anything on the log", async () => {
    currentUser = MEMBER_ID;
    const { updateCommunication, removeCommunication } = await import("@/lib/actions/communications");
    const { updateVisit, removeVisit } = await import("@/lib/actions/visits");
    for (const call of [
      () => updateCommunication(ORG_WITH_MODULES, IDS.target, "tc1", { errors: {} }, form({ kind: "call" })),
      () => removeCommunication(ORG_WITH_MODULES, IDS.target, "tc1"),
      () => updateVisit(ORG_WITH_MODULES, IDS.target, "tv1", { errors: {} }, form({ visitType: "camp" })),
      () => removeVisit(ORG_WITH_MODULES, IDS.target, "tv1"),
    ]) {
      expect((await run(call)).redirect).toBe("/unauthorized");
    }
    expect(writes).toEqual([]);
  });

  it("each entry on the contact log opens its own edit screen, which offers a confirmed Remove", async () => {
    const log = await render("@/app/org/[slug]/board/[id]/communications/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) });
    expect(log).toContain(`/board/${IDS.target}/communications/tc1`);
    expect(log).toContain(`/board/${IDS.target}/visits/tv1`);
    const comm = await render("@/app/org/[slug]/board/[id]/communications/[entryId]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target, entryId: "tc1" }) });
    expect(comm).toMatch(/Edit Communication[\s\S]*Fixture note\.[\s\S]*Remove Entry/);
    const visit = await render("@/app/org/[slug]/board/[id]/visits/[visitId]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target, visitId: "tv1" }) });
    expect(visit).toMatch(/Edit Visit[\s\S]*Fixture impression\.[\s\S]*Remove Visit/);
    await expect(render("@/app/org/[slug]/board/[id]/visits/[visitId]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.targetNoCoach, visitId: "tv1" }) })).rejects.toThrow(NOT_FOUND);
  });
});

describe("LAW: a target can be removed, with its log, and a removed commitment reopens the athlete (crud F15)", () => {
  it("deleteTarget removes the target, its contacts and visits, scoped by org", async () => {
    const { deleteTarget } = await import("@/lib/actions/targets");
    const r = await run(() => deleteTarget(ORG_WITH_MODULES, IDS.target));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}`);
    expect(rows("recruiting_targets").some((t) => t.id === IDS.target)).toBe(false);
    expect(rows("target_communications").some((c) => c.target_id === IDS.target)).toBe(false);
    expect(rows("target_visits").some((v) => v.target_id === IDS.target)).toBe(false);
    for (const w of writesTo("recruiting_targets", "delete")) expect(filterOf(w, "org_id")).toBe(BRIDGE());
  });

  it("removing the Committed target puts the athlete back to recruiting", async () => {
    const { deleteTarget } = await import("@/lib/actions/targets");
    await run(() => deleteTarget(ORG_WITH_MODULES, IDS.targetCommitted));
    expect(rows("athletes").find((a) => a.id === IDS.athleteCommitted)?.status).toBe("Active");
  });

  it("another org's target and a member's attempt both delete nothing", async () => {
    seedEliteTarget();
    const { deleteTarget } = await import("@/lib/actions/targets");
    await run(() => deleteTarget(ORG_WITH_MODULES, "elite-target"));
    expect(rows("recruiting_targets").some((t) => t.id === "elite-target")).toBe(true);
    expect(writesTo("recruiting_targets", "delete")).toEqual([]);
    currentUser = MEMBER_ID;
    expect((await run(() => deleteTarget(ORG_WITH_MODULES, IDS.target))).redirect).toBe("/unauthorized");
    expect(rows("recruiting_targets").some((t) => t.id === IDS.target)).toBe(true);
  });
});

describe("LAW: the award on a target is editable, and a correction keeps its document (crud F14)", () => {
  it("saveTargetAid writes the award, works out a blank net cost from gift aid, and recomputes", async () => {
    const { saveTargetAid } = await import("@/lib/actions/targets");
    const r = await run(() =>
      saveTargetAid(
        ORG_WITH_MODULES,
        IDS.target,
        { errors: {} },
        form({
          academicYear: "2026-27",
          totalCostOfAttendance: "$40,000",
          netCost: "",
          award_type_0: "scholarship",
          award_name_0: "Athletic",
          award_amount_0: "12000",
          award_renewable_0: "yes",
          award_type_1: "subsidized_loan",
          award_name_1: "Direct loan",
          award_amount_1: "3500",
          award_renewable_1: "",
          award_type_2: "grant",
          award_name_2: "",
          award_amount_2: "",
        }),
      ),
    );
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/board/${IDS.target}`);
    const aid = rows("recruiting_targets").find((t) => t.id === IDS.target)?.aid as Record<string, unknown>;
    expect(aid).toMatchObject({ academicYear: "2026-27", totalCostOfAttendance: 40000, netCost: 28000, documentId: null });
    expect(aid.awards).toEqual([
      { type: "scholarship", name: "Athletic", amount: 12000, renewable: true },
      { type: "subsidized_loan", name: "Direct loan", amount: 3500, renewable: null },
    ]);
    expect(writesTo("athlete_school_fits", "upsert").length).toBeGreaterThan(0);
  });

  it("a correction to an applied award keeps the document it came from", async () => {
    const t = rows("recruiting_targets").find((x) => x.id === IDS.target)!;
    t.aid = { academicYear: "2026-27", totalCostOfAttendance: 40000, netCost: 30000, awards: [], documentId: IDS.document };
    const { saveTargetAid } = await import("@/lib/actions/targets");
    await run(() => saveTargetAid(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ totalCostOfAttendance: "40000", netCost: "26000" })));
    expect(t.aid).toMatchObject({ netCost: 26000, documentId: IDS.document });
  });

  it("a bad number is refused on its field and nothing is written", async () => {
    const { saveTargetAid } = await import("@/lib/actions/targets");
    const r = await run(() => saveTargetAid(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ totalCostOfAttendance: "lots", award_type_0: "grant", award_name_0: "Pell", award_amount_0: "-5" })));
    const errors = (r.state as { errors: Record<string, string> }).errors;
    expect(errors.totalCostOfAttendance).toBeDefined();
    expect(errors.award_amount_0).toBeDefined();
    expect(writesTo("recruiting_targets")).toEqual([]);
  });

  it("Clear Award empties it, and another org's target is out of reach", async () => {
    const t = rows("recruiting_targets").find((x) => x.id === IDS.target)!;
    t.aid = { netCost: 1 };
    const { clearTargetAid, saveTargetAid } = await import("@/lib/actions/targets");
    await run(() => clearTargetAid(ORG_WITH_MODULES, IDS.target));
    expect(t.aid).toBeNull();
    seedEliteTarget();
    const r = await run(() => saveTargetAid(ORG_WITH_MODULES, "elite-target", { errors: {} }, form({ netCost: "1" })));
    expect((r.state as { errors: Record<string, string> }).errors.form).toMatch(/isn't on this org's board/);
    expect(rows("recruiting_targets").find((x) => x.id === "elite-target")?.aid).toBeUndefined();
  });

  it("the edit screen shows the award to correct, with Clear Award and Remove Target", async () => {
    rows("recruiting_targets").find((x) => x.id === IDS.target)!.aid = { academicYear: "2026-27", totalCostOfAttendance: 41000, netCost: 29000, awards: [{ type: "grant", name: "Fixture Grant", amount: 12000, renewable: true }], documentId: null };
    const html = await render("@/app/org/[slug]/board/[id]/edit/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.target }) });
    expect(html).toMatch(/Award[\s\S]*41000[\s\S]*Fixture Grant[\s\S]*Clear Award[\s\S]*Remove Target/);
  });
});

describe("LAW: a shared school can be merged or removed, and a save never loses what the form does not show (crud F3, F4)", () => {
  it("updateSchool keeps jsonb keys the form does not own, clears the ones it does, and saves the town", async () => {
    const s = rows("schools").find((x) => x.id === IDS.school)!;
    s.academics = { ...(s.academics as object), majorAvailability: { Biology: "strong" } };
    const { updateSchool } = await import("@/lib/actions/schools");
    const r = await run(() =>
      updateSchool(ORG_WITH_MODULES, IDS.school, { errors: {} }, form({ name: "Fixture State University", division: "D2", gpaMin: "2.6", satRange: "", location: "New Town, CT", state: "CT" })),
    );
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/schools/${IDS.school}`);
    expect(s.academics).toEqual({ gpaMin: 2.6, majorAvailability: { Biology: "strong" } });
    expect(s.location).toBe("New Town, CT");
  });

  it("deleteSchool is refused while anything in any org points at the school, and deletes nothing", async () => {
    const { deleteSchool } = await import("@/lib/actions/schools");
    const r = await run(() => deleteSchool(ORG_WITH_MODULES, IDS.school));
    expect(decodeURIComponent(r.redirect!)).toMatch(/still in use: .*target.*Merge it/);
    expect(writes.filter((w) => w.op === "delete")).toEqual([]);
    expect(rows("schools").some((x) => x.id === IDS.school)).toBe(true);
  });

  it("deleteSchool removes a school nobody uses, and only an owner may", async () => {
    rows("schools").push({ id: "unused-school", name: "Unused College", division: "D3", conference: null, sports_sponsored: [], academics: {}, financials: {}, athletics: {}, conflicts: [], profile_date: null, program_tier: null, state: "RI", location: null, majors: [] });
    currentUser = OUTSIDER_ID;
    expect((await run(() => (async () => (await import("@/lib/actions/schools")).deleteSchool(ORG_WITHOUT_MODULES, "unused-school"))())).redirect).toBe("/unauthorized");
    currentUser = OWNER_ID;
    const transfer = rows("athletes").find((a) => a.id === IDS.athleteGraduated)!;
    transfer.detail = { ...(transfer.detail as object), currentSchoolId: "unused-school" };
    const { deleteSchool } = await import("@/lib/actions/schools");
    const r = await run(() => deleteSchool(ORG_WITH_MODULES, "unused-school"));
    expect(r.redirect).toContain(`/org/${ORG_WITH_MODULES}/schools`);
    expect(rows("schools").some((x) => x.id === "unused-school")).toBe(false);
    // The transfer's Current School stays as typed, pointing at nothing.
    expect(rows("athletes").find((a) => a.id === IDS.athleteGraduated)?.detail).toMatchObject({ currentSchool: "Fixture Tech" });
    expect((rows("athletes").find((a) => a.id === IDS.athleteGraduated)?.detail as Record<string, unknown>).currentSchoolId).toBeUndefined();
  });

  it("mergeSchool moves every target, note, coach and contact to the kept school, in every org, then deletes the duplicate", async () => {
    rows("org_school_notes").push({ id: "osn-elite-d3", org_id: ELITE(), school_id: IDS.schoolD3, coach_name: "Elite's Contact", coach_email: null, positions_of_need: [], notes: "Elite's own note.", updated_at: "2026-09-01" });
    rows("org_school_notes").push({ id: "osn-bridge-d3", org_id: BRIDGE(), school_id: IDS.schoolD3, coach_name: null, coach_email: null, positions_of_need: [], notes: "Joins the kept school's note.", updated_at: "2026-09-01" });
    rows("college_coaches").push({ id: "cc-d3", school_id: IDS.schoolD3, school_name: "Fixture College", name: "D3 Coach", title: "Head Coach", email: "d3@fixture.example", phone: null, is_recruiting_coordinator: false, email_verified: false, source_url: null, notes: null });
    rows("college_coaches").push({ id: "cc-d3-dup", school_id: IDS.schoolD3, school_name: "Fixture College", name: "fixture head", title: "Head Coach", email: "head@fixture.example", phone: "555-0199", is_recruiting_coordinator: false, email_verified: false, source_url: null, notes: null });
    rows("contacts").push({ id: "ct-d3", org_id: BRIDGE(), athlete_id: IDS.athlete, name: "D3 Contact", role: "college_coach", email: null, phone: null, school_id: IDS.schoolD3, notes: null });
    rows("target_communications").push({ id: "tc-close", org_id: BRIDGE(), target_id: IDS.targetToClose, kind: "email", notes: "Moves to the kept target.", occurred_on: "2026-08-11" });
    const transfer = rows("athletes").find((a) => a.id === IDS.athleteGraduated)!;
    transfer.detail = { ...(transfer.detail as object), currentSchool: "Fixture Tech (dup)", currentSchoolId: IDS.schoolD3 };
    rows("recruiting_targets").find((t) => t.id === IDS.targetToClose)!.notes = "Met the coach at the showcase.";

    const { mergeSchool } = await import("@/lib/actions/schools");
    const r = await run(() => mergeSchool(ORG_WITH_MODULES, IDS.schoolD3, form({ mergeInto: IDS.school })));
    expect(r.redirect).toContain(`/org/${ORG_WITH_MODULES}/schools/${IDS.school}?notice=`);

    expect(rows("schools").some((x) => x.id === IDS.schoolD3)).toBe(false);
    expect(rows("recruiting_targets").some((t) => t.school_id === IDS.schoolD3)).toBe(false);
    // No clash: the target moves.
    expect(rows("recruiting_targets").find((t) => t.id === IDS.targetNoCoach)?.school_id).toBe(IDS.school);
    // A clash (the athlete already had a target at the kept school): the
    // kept target stays, takes the log, and the duplicate target goes.
    expect(rows("recruiting_targets").some((t) => t.id === IDS.targetToClose)).toBe(false);
    expect(rows("target_communications").find((c) => c.id === "tc-close")?.target_id).toBe(IDS.targetCommitted);
    // Notes: Elite had none on the kept school, so theirs moves; Bridge
    // had one, so the duplicate's text is added under it and the
    // duplicate row goes.
    expect(rows("org_school_notes").find((n) => n.id === "osn-elite-d3")?.school_id).toBe(IDS.school);
    expect(rows("org_school_notes").some((n) => n.id === "osn-bridge-d3")).toBe(false);
    expect(rows("org_school_notes").find((n) => n.id === "osn1")?.notes).toBe("Wants a shortstop for 2027.\n\nMerged from Fixture College.\nJoins the kept school's note.");
    // Coaches move with the kept school's name, unless already listed there.
    expect(rows("college_coaches").find((c) => c.id === "cc-d3")).toMatchObject({ school_id: IDS.school, school_name: "Fixture State University" });
    expect(rows("college_coaches").some((c) => c.id === "cc-d3-dup")).toBe(false);
    // The kept listing takes the duplicate's email where it had none,
    // and keeps its own phone.
    expect(rows("college_coaches").find((c) => c.id === "cc2")).toMatchObject({ email: "head@fixture.example", phone: "555-0100" });
    expect(rows("contacts").find((c) => c.id === "ct-d3")?.school_id).toBe(IDS.school);
    // A transfer's Current School follows, name and id (recruit_type is
    // never the bare word "transfer").
    expect(rows("athletes").find((a) => a.id === IDS.athleteGraduated)?.detail).toMatchObject({ currentSchool: "Fixture State University", currentSchoolId: IDS.school });
    // The duplicate target's notes are kept on the target that stays.
    expect(String(rows("recruiting_targets").find((t) => t.id === IDS.targetCommitted)?.notes ?? "")).toContain("Met the coach at the showcase.");
    expect(writesTo("athlete_school_fits", "upsert").length).toBeGreaterThan(0);
  });

  it("mergeSchool refuses a school merged into itself, and a staff login", async () => {
    const { mergeSchool } = await import("@/lib/actions/schools");
    const r = await run(() => mergeSchool(ORG_WITH_MODULES, IDS.school, form({ mergeInto: IDS.school })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/cannot be merged into itself/);
    currentUser = OUTSIDER_ID;
    expect((await run(() => mergeSchool(ORG_WITHOUT_MODULES, IDS.schoolD3, form({ mergeInto: IDS.school })))).redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("the edit screen offers Merge Into and Remove School, each behind a confirm", async () => {
    const html = await render("@/app/org/[slug]/schools/[id]/edit/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    expect(html).toMatch(/Merge Into[\s\S]*Fixture College[\s\S]*Remove School/);
  });
});

describe("LAW: the coach directory has an add, an edit and a remove, owner only (crud F2)", () => {
  it("createCoach takes the school's name from the school row, never the form", async () => {
    const { createCoach } = await import("@/lib/actions/coaches");
    const r = await run(() => createCoach(ORG_WITH_MODULES, IDS.schoolD3, { errors: {} }, form({ name: "New Coach", title: "Pitching Coach", email: "new@fixture.example", school_name: "Somewhere Else", isRecruitingCoordinator: "on" })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/schools/${IDS.schoolD3}/coaches`);
    expect(writesTo("college_coaches", "insert")[0]?.rows[0]).toMatchObject({ school_id: IDS.schoolD3, school_name: "Fixture College", name: "New Coach", is_recruiting_coordinator: true });
  });

  it("updateCoach and deleteCoach are scoped to the school, and a bad email is refused", async () => {
    const { updateCoach, deleteCoach } = await import("@/lib/actions/coaches");
    const bad = await run(() => updateCoach(ORG_WITH_MODULES, IDS.school, "cc1", { errors: {} }, form({ name: "Fixture Assistant", email: "not an email" })));
    expect((bad.state as { errors: Record<string, string> }).errors.email).toBeDefined();
    const wrongSchool = await run(() => updateCoach(ORG_WITH_MODULES, IDS.schoolD3, "cc1", { errors: {} }, form({ name: "Moved" })));
    expect((wrongSchool.state as { errors: Record<string, string> }).errors.form).toMatch(/isn't listed at this school/);
    await run(() => updateCoach(ORG_WITH_MODULES, IDS.school, "cc1", { errors: {} }, form({ name: "Fixture Assistant", title: "Associate Head Coach", email: "fixed@fixture.example" })));
    expect(rows("college_coaches").find((c) => c.id === "cc1")).toMatchObject({ title: "Associate Head Coach", email: "fixed@fixture.example", is_recruiting_coordinator: false });
    await run(() => deleteCoach(ORG_WITH_MODULES, IDS.schoolD3, "cc2"));
    expect(rows("college_coaches").some((c) => c.id === "cc2")).toBe(true);
    await run(() => deleteCoach(ORG_WITH_MODULES, IDS.school, "cc2"));
    expect(rows("college_coaches").some((c) => c.id === "cc2")).toBe(false);
  });

  it("staff cannot write the shared directory", async () => {
    currentUser = OUTSIDER_ID;
    const { createCoach, updateCoach, deleteCoach } = await import("@/lib/actions/coaches");
    for (const call of [
      () => createCoach(ORG_WITHOUT_MODULES, IDS.school, { errors: {} }, form({ name: "Sneaky" })),
      () => updateCoach(ORG_WITHOUT_MODULES, IDS.school, "cc1", { errors: {} }, form({ name: "Sneaky" })),
      () => deleteCoach(ORG_WITHOUT_MODULES, IDS.school, "cc1"),
    ]) {
      expect((await run(call)).redirect).toBe("/unauthorized");
    }
    expect(writes).toEqual([]);
  });

  it("an owner reaches the coach list from the school page, even with nobody listed, and each coach opens", async () => {
    const school = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    expect(school).toContain(`href="/org/${ORG_WITH_MODULES}/schools/${IDS.school}/coaches"`);
    const empty = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.schoolD3 }) });
    expect(empty).toMatch(new RegExp(`href="/org/${ORG_WITH_MODULES}/schools/${IDS.schoolD3}/coaches/new"[\\s\\S]*Add a Coach`));
    const list = await render("@/app/org/[slug]/schools/[id]/coaches/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    expect(list).toContain(`/schools/${IDS.school}/coaches/cc1`);
    expect(list).toContain(`/schools/${IDS.school}/coaches/new`);
    const add = await render("@/app/org/[slug]/schools/[id]/coaches/new/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school }) });
    expect(add).toMatch(/Add a Coach[\s\S]*Add Coach/);
    const edit = await render("@/app/org/[slug]/schools/[id]/coaches/[coachId]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.school, coachId: "cc1" }) });
    expect(edit).toMatch(/Fixture Assistant[\s\S]*assistant@fixture\.example[\s\S]*Remove Coach/);
  });

  it("staff see the coaches to email and no way to edit the shared list", async () => {
    currentUser = OUTSIDER_ID;
    const school = await render("@/app/org/[slug]/schools/[id]/page", { params: p({ slug: ORG_WITHOUT_MODULES, id: IDS.school }) });
    expect(school).toMatch(/Fixture Assistant/);
    expect(school).not.toContain("/coaches");
    await expect(render("@/app/org/[slug]/schools/[id]/coaches/page", { params: p({ slug: ORG_WITHOUT_MODULES, id: IDS.school }) })).rejects.toThrow(`${REDIRECT}/unauthorized`);
  });
});

describe("LAW: grading scales, approved lists and windows can be corrected and removed (crud F12, F13, F22)", () => {
  it("deleteGradingScale removes this org's scale and redirects, and another org's id is a no-op", async () => {
    rows("org_grading_scales").push({ id: "elite-scale", org_id: ELITE(), school_name: "Elite High", bands: [], reports_weighted_grades: false, weighting_is_class_rank_only: false, weight_bonus: 0, source_note: "elite", entered_by: OWNER_ID, updated_at: "2026-02-01" });
    const { deleteGradingScale } = await import("@/lib/actions/gradingScales");
    await run(() => deleteGradingScale(ORG_WITH_MODULES, "elite-scale"));
    expect(rows("org_grading_scales").some((s) => s.id === "elite-scale")).toBe(true);
    const r = await run(() => deleteGradingScale(ORG_WITH_MODULES, IDS.orgScale));
    expect(decodeURIComponent(r.redirect!)).toContain(`/org/${ORG_WITH_MODULES}/grading-scales?notice=Scale removed.`);
    expect(rows("org_grading_scales").some((s) => s.id === IDS.orgScale)).toBe(false);
  });

  it("deleteApprovedList removes the list and its courses, this org's only", async () => {
    const { deleteApprovedList } = await import("@/lib/actions/approvedCourses");
    currentUser = MEMBER_ID;
    expect((await run(() => deleteApprovedList(ORG_WITH_MODULES, IDS.orgList))).redirect).toBe("/unauthorized");
    currentUser = OWNER_ID;
    await run(() => deleteApprovedList(ORG_WITHOUT_MODULES, IDS.orgList));
    expect(rows("org_approved_course_lists").some((l) => l.id === IDS.orgList)).toBe(true);
    await run(() => deleteApprovedList(ORG_WITH_MODULES, IDS.orgList));
    expect(rows("org_approved_course_lists").some((l) => l.id === IDS.orgList)).toBe(false);
    expect(rows("org_approved_courses").some((c) => c.list_id === IDS.orgList)).toBe(false);
  });

  it("the list opens for editing with every course on it, and offers Remove List", async () => {
    const edit = await render("@/app/org/[slug]/approved-courses/[id]/edit/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.orgList }) });
    expect(edit).toMatch(/Edit Unscaled High School[\s\S]*Algebra II[\s\S]*partial, typed here/);
    const view = await render("@/app/org/[slug]/approved-courses/[id]/page", { params: p({ slug: ORG_WITH_MODULES, id: IDS.orgList }), searchParams: p({}) });
    expect(view).toMatch(/Edit This List[\s\S]*Remove List/);
    expect(view).toContain(`/approved-courses/${IDS.orgList}/edit`);
  });

  it("updateTransferWindow corrects a window in place and refuses a duplicate of another", async () => {
    rows("transfer_windows").push({ id: "tw2", sport: "baseball", division: "D2", season_year: "2026", window_label: "Second", opens_on: "2027-05-01", closes_on: "2027-05-15", source_url: "https://example.test/second", notes: null });
    const { updateTransferWindow } = await import("@/lib/actions/transferWindows");
    const base = { sport: "baseball", division: "D2", seasonYear: "2026", opensOn: "2026-12-02", closesOn: "2026-12-16", sourceUrl: "https://example.test/fixture-window" };
    const dup = await run(() => updateTransferWindow(ORG_WITH_MODULES, "tw1", { errors: {} }, form({ ...base, windowLabel: "Second" })));
    expect((dup.state as { errors: Record<string, string> }).errors.windowLabel).toMatch(/already on file/);
    const r = await run(() => updateTransferWindow(ORG_WITH_MODULES, "tw1", { errors: {} }, form({ ...base, windowLabel: "Fixture window", notes: "Corrected dates." })));
    expect(decodeURIComponent(r.redirect!)).toContain("Window saved.");
    expect(rows("transfer_windows").find((w) => w.id === "tw1")).toMatchObject({ opens_on: "2026-12-02", closes_on: "2026-12-16", notes: "Corrected dates." });
    currentUser = MEMBER_ID;
    expect((await run(() => updateTransferWindow(ORG_WITH_MODULES, "tw1", { errors: {} }, form({ ...base, windowLabel: "x" })))).redirect).toBe("/unauthorized");
  });

  it("the window's edit screen renders with its note, and the list links to it", async () => {
    const edit = await render("@/app/org/[slug]/transfer-windows/[id]/edit/page", { params: p({ slug: ORG_WITH_MODULES, id: "tw1" }) });
    expect(edit).toMatch(/Edit Transfer Window[\s\S]*Fixture window note\.[\s\S]*Remove Window/);
    const list = await render("@/app/org/[slug]/transfer-windows/page", { params: p({ slug: ORG_WITH_MODULES }), searchParams: p({}) });
    expect(list).toContain("/transfer-windows/tw1/edit");
  });
});

// Every removal on these screens asks first. A static read of Group B's
// pages and components: each form posting a delete, remove, clear or
// merge action wraps a ConfirmButton. A bare submit that deletes on one
// tap is the thing Dave's confirm sheet pick (2026-09-20) replaced.
describe("LAW: every delete on the reference screens goes through a confirm", () => {
  const { join } = posix;
  const ROOT = process.cwd().replace(/\\/g, "/");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const f = join(dir, name);
      if (statSync(f).isDirectory()) walk(f, out);
      else if (f.endsWith(".tsx")) out.push(f);
    }
    return out;
  };
  const APP = join(ROOT, "src/app/org/[slug]");
  const FILES = [
    ...walk(join(APP, "board")),
    ...walk(join(APP, "schools")),
    ...walk(join(APP, "grading-scales")),
    ...walk(join(APP, "approved-courses")),
    ...walk(join(APP, "transfer-windows")),
  ];

  it("found the screens", () => {
    expect(FILES.length).toBeGreaterThan(15);
  });

  it("no form posts a destructive action without a ConfirmButton inside it", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<Form action=\{(\w+)[.(]/g)) {
        if (!/^(delete|remove|clear|merge)/.test(m[1])) continue;
        const body = src.slice(m.index!, src.indexOf("</Form>", m.index!));
        if (!body.includes("<ConfirmButton")) offenders.push(`${f.slice(ROOT.length + 1)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every destructive action on these screens is actually reached from one", () => {
    const src = FILES.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const name of ["removeCommunication", "removeVisit", "deleteTarget", "clearTargetAid", "deleteSchool", "mergeSchool", "deleteCoach", "deleteGradingScale", "deleteApprovedList", "deleteTransferWindow"]) {
      expect(src, name).toMatch(new RegExp(`<Form action=\\{${name}\\.bind`));
    }
  });
});
