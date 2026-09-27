// Add, edit and remove, everywhere on an athlete (Dave, 2026-09-27:
// "everything should be very easy for anyone to edit anything... add
// and delete and all that good stuff"). The audit found athletes that
// could never be removed, contacts, metrics and check-ins that could not
// be edited, messages that could not be taken down, a family login that
// could only be unlinked by removing it from everything, and an Edit
// dropdown that stamped today's date on the NCAA clock.
//
// These laws run the real actions against the fixture:
//
//   - every edit and remove is staff only and names the org, the athlete
//     and the row, so another org's id or another athlete's row is never
//     touched
//   - an edit that matches no row says so instead of reporting success
//   - Enrolled and Graduated are never set from the Edit dropdown, and a
//     date already on file is corrected there, not overwritten by today
//   - every remove, delete and unlink button on a screen sits behind a
//     ConfirmButton
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

type State = { errors: Record<string, string> };

describe("LAW: Remove Athlete is a staff soft delete, scoped to this org", () => {
  // Planted: removed `.eq("org_id", org.id)` from removeAthlete's update;
  // the filter check failed and Elite's athlete was removed. Reverted.
  it("sets deleted_at on this org's athlete, clears their matches and lands on the roster", async () => {
    const { removeAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => removeAthlete(ORG_WITH_MODULES, IDS.athlete));
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster\\?notice=`));
    const up = updates("athletes")[0];
    expect(up?.rows[0]).toHaveProperty("deleted_at");
    expect(filterCols(up)).toEqual(expect.arrayContaining(["id", "org_id"]));
    expect(data.athletes.find((a) => a.id === IDS.athlete)?.deleted_at).toBeTruthy();
    const fits = deletes("athlete_school_fits")[0];
    expect(fits?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "athlete_id", value: IDS.athlete }), expect.objectContaining({ column: "org_id", value: bridgeId() })]));
    // Nothing is hard deleted: the record and its history stay.
    expect(deletes("athletes")).toEqual([]);
    expect(deletes("recruiting_targets")).toEqual([]);
  });

  it("another org's athlete id under this slug removes nothing", async () => {
    const { removeAthlete } = await import("@/lib/actions/athletes");
    await run(() => removeAthlete(ORG_WITH_MODULES, IDS.athleteElite));
    expect(data.athletes.find((a) => a.id === IDS.athleteElite)?.deleted_at).toBeNull();
    expect(deletes("athlete_school_fits")).toEqual([]);
  });

  it("a member or a family login cannot remove an athlete", async () => {
    const { removeAthlete } = await import("@/lib/actions/athletes");
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      const r = await run(() => removeAthlete(ORG_WITH_MODULES, IDS.athlete));
      expect(r.redirect).toBe("/unauthorized");
    }
    expect(writes).toEqual([]);
  });

  it("a removed athlete can no longer be edited or noted", async () => {
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-01T00:00:00.000Z";
    const { updateAthlete, addNote } = await import("@/lib/actions/athletes");
    const r = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "Baseball", recruitType: "hs", status: "Active" })));
    expect(r.redirect).toBe("/unauthorized");
    await run(() => addNote(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ body: "Too late." })));
    expect(writes).toEqual([]);
  });
});

describe("LAW: the NCAA clock is set by its own screens and corrected on Edit, never stamped with today", () => {
  // Audit crud F8. Planted: disabled the refusal of a hand edit to
  // Enrolled; the first case failed, the save going through with no
  // date asked. Reverted.
  it("the Edit dropdown cannot move an athlete to Enrolled or Graduated", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const enrolled = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {}, values: {} }, form({ name: "Fixture Committed", sport: "Baseball", recruitType: "hs", status: "Enrolled" })));
    expect((enrolled.state as State).errors.status).toMatch(/Mark Enrolled/);
    const graduated = await run(() =>
      updateAthlete(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {}, values: {} }, form({ name: "Fixture Enrolled", sport: "Baseball", recruitType: "hs", status: "Graduated" })),
    );
    expect((graduated.state as State).errors.status).toMatch(/Mark Graduated/);
    expect(writes).toEqual([]);
  });

  it("an enrollment date already on file is corrected in place", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    await run(() =>
      updateAthlete(
        ORG_WITH_MODULES,
        IDS.athleteTransfer,
        { errors: {}, values: {} },
        form({ name: "Fixture Transfer", sport: "Baseball", recruitType: "transfer_4to4", status: "Active", currentSchool: "City College of New York", eligibilityYearsRemaining: "3", transferCount: "1", enrollmentDate: "2023-08-28" }),
      ),
    );
    expect(updates("athletes")[0]?.rows[0]).toMatchObject({ first_full_time_enrollment: "2023-08-28" });
  });

  it("a high school athlete with no clock cannot have one started from Edit", async () => {
    // Planted: dropped the `enrollmentEditable` condition; this failed
    // with the date written. Reverted.
    const { updateAthlete } = await import("@/lib/actions/athletes");
    await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "Baseball", recruitType: "hs", status: "Active", enrollmentDate: "2026-08-28", graduatedOn: "2030-05-01" })));
    const row = updates("athletes")[0]?.rows[0];
    expect(row).not.toHaveProperty("first_full_time_enrollment");
    expect(row).not.toHaveProperty("graduated_on");
  });

  it("Graduated On is corrected once set, and never before the enrollment date", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const base = { name: "Fixture Graduated", sport: "Baseball", recruitType: "transfer_4to4", status: "Graduated", currentSchool: "Fixture Tech", eligibilityYearsRemaining: "0", transferCount: "0" };
    const early = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athleteGraduated, { errors: {}, values: {} }, form({ ...base, graduatedOn: "2022-01-01" })));
    expect((early.state as State).errors.graduatedOn).toMatch(/after the Enrollment Date/);
    expect(writes).toEqual([]);
    await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athleteGraduated, { errors: {}, values: {} }, form({ ...base, graduatedOn: "2026-06-01" })));
    expect(updates("athletes")[0]?.rows[0]).toMatchObject({ graduated_on: "2026-06-01" });
  });
});

describe("LAW: an edit names the org, the athlete and the row, and says when nothing matched", () => {
  // Planted: removed `.eq("athlete_id", athleteId)` from updateContact;
  // the filter check failed. Planted: removed the zero-row check from
  // updateCheckin; the foreign-id case redirected as if saved. Both
  // reverted.
  it("updateContact edits one contact in place and fills from the coach directory", async () => {
    const { updateContact } = await import("@/lib/actions/contacts");
    const r = await run(() => updateContact(ORG_WITH_MODULES, IDS.athlete, "ct1", { errors: {} }, form({ name: "Fixture Parent", role: "parent_guardian", email: "parent.new@example.test", phone: "555-0199" })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}`);
    const up = updates("contacts")[0];
    expect(filterCols(up)).toEqual(expect.arrayContaining(["id", "org_id", "athlete_id"]));
    expect(data.contacts.find((c) => c.id === "ct1")).toMatchObject({ email: "parent.new@example.test", phone: "555-0199" });
  });

  it("updateContact on another athlete's contact changes nothing and says so", async () => {
    const { updateContact } = await import("@/lib/actions/contacts");
    const r = await run(() => updateContact(ORG_WITH_MODULES, IDS.athleteNoGpa, "ct1", { errors: {} }, form({ name: "Hijacked", role: "other" })));
    expect(r.redirect).toBeNull();
    expect((r.state as State).errors.form).toMatch(/not on this athlete/);
    expect(data.contacts.find((c) => c.id === "ct1")?.name).toBe("Fixture Parent");
  });

  it("updateMetric edits the entry, recomputes the matches, and refuses a foreign entry", async () => {
    const { updateMetric } = await import("@/lib/actions/metrics");
    const r = await run(() => updateMetric(ORG_WITH_MODULES, IDS.athlete, "mx1", { errors: {} }, form({ metric: "fbVelo", value: "87", measuredOn: "2026-08-16", source: "premier", sourceDetail: "Fall Showcase" })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/metrics`);
    expect(filterCols(updates("athlete_metrics")[0])).toEqual(expect.arrayContaining(["id", "org_id", "athlete_id"]));
    expect(data.athlete_metrics.find((m) => m.id === "mx1")).toMatchObject({ value: 87, measured_on: "2026-08-16", source_detail: "Fall Showcase" });
    expect(writes.some((w) => w.op === "upsert" && w.table === "athlete_school_fits")).toBe(true);

    writes.length = 0;
    const foreign = await run(() => updateMetric(ORG_WITH_MODULES, IDS.athleteNoGpa, "mx1", { errors: {} }, form({ metric: "fbVelo", value: "99", measuredOn: "2026-08-16", source: "premier" })));
    expect((foreign.state as State).errors.form).toMatch(/not on this athlete/);
    expect(data.athlete_metrics.find((m) => m.id === "mx1")?.value).toBe(87);
  });

  it("updateCheckin edits type, date and notes, never who checked in", async () => {
    const { updateCheckin } = await import("@/lib/actions/checkins");
    const r = await run(() => updateCheckin(ORG_WITH_MODULES, IDS.athlete, "ck1", { errors: {} }, form({ kind: "meeting", occurredOn: "2026-09-20", notes: "Met at school.", advisorId: MEMBER_ID })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/checkins`);
    const up = updates("athlete_checkins")[0];
    expect(filterCols(up)).toEqual(expect.arrayContaining(["id", "org_id", "athlete_id"]));
    expect(Object.keys(up?.rows[0] ?? {}).sort()).toEqual(["kind", "notes", "occurred_on"]);
    expect(data.athlete_checkins.find((c) => c.id === "ck1")).toMatchObject({ kind: "meeting", occurred_on: "2026-09-20", advisor_id: OWNER_ID });

    const foreign = await run(() => updateCheckin(ORG_WITH_MODULES, IDS.athleteNoGpa, "ck1", { errors: {} }, form({ kind: "text", occurredOn: "2026-09-21" })));
    expect(foreign.redirect).toBeNull();
    expect((foreign.state as State).errors.form).toMatch(/not on this athlete/);
  });

  it("a member cannot edit a contact, a metric or a check-in", async () => {
    currentUser = MEMBER_ID;
    const { updateContact } = await import("@/lib/actions/contacts");
    const { updateMetric } = await import("@/lib/actions/metrics");
    const { updateCheckin } = await import("@/lib/actions/checkins");
    expect((await run(() => updateContact(ORG_WITH_MODULES, IDS.athlete, "ct1", { errors: {} }, form({ name: "X", role: "other" })))).redirect).toBe("/unauthorized");
    expect((await run(() => updateMetric(ORG_WITH_MODULES, IDS.athlete, "mx1", { errors: {} }, form({ metric: "fbVelo", value: "90", measuredOn: "2026-08-16", source: "premier" })))).redirect).toBe("/unauthorized");
    expect((await run(() => updateCheckin(ORG_WITH_MODULES, IDS.athlete, "ck1", { errors: {} }, form({ kind: "call", occurredOn: "2026-09-20" })))).redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });
});

describe("LAW: staff remove a message; nobody else does", () => {
  // Audit crud F9. Planted: swapped requireRole(STAFF_ROLES) in
  // deleteMessage for getCurrentUser with no role check; the family case
  // deleted am1. Reverted.
  it("staff remove one message, by id, org and athlete", async () => {
    const { deleteMessage } = await import("@/lib/actions/messages");
    await run(() => deleteMessage(ORG_WITH_MODULES, IDS.athlete, "am2"));
    expect(filterCols(deletes("athlete_messages")[0])).toEqual(expect.arrayContaining(["id", "org_id", "athlete_id"]));
    expect(data.athlete_messages.some((m) => m.id === "am2")).toBe(false);
    expect(data.athlete_messages.some((m) => m.id === "am1")).toBe(true);
  });

  it("a message id under another athlete's thread removes nothing", async () => {
    const { deleteMessage } = await import("@/lib/actions/messages");
    await run(() => deleteMessage(ORG_WITH_MODULES, IDS.athleteNoGpa, "am1"));
    expect(data.athlete_messages.some((m) => m.id === "am1")).toBe(true);
  });

  it("a family login and a member are sent away and remove nothing", async () => {
    const { deleteMessage } = await import("@/lib/actions/messages");
    for (const who of [FAMILY_ID, MEMBER_ID]) {
      currentUser = who;
      const r = await run(() => deleteMessage(ORG_WITH_MODULES, IDS.athlete, "am1"));
      expect(r.redirect).toBe("/unauthorized");
    }
    expect(writes).toEqual([]);
  });
});

describe("LAW: a family link is unlinked, relabelled and added one athlete at a time", () => {
  // Audit crud F7. Planted: removed `.eq("athlete_id", athleteId)` from
  // unlinkGuardian's delete; every one of the parent's links went and the
  // other-children check failed. Reverted.
  const links = () => data.athlete_guardians.filter((g) => g.user_id === FAMILY_ID).map((g) => g.athlete_id).sort();

  it("unlinking drops exactly one link and keeps the parent's other children", async () => {
    const { unlinkGuardian } = await import("@/lib/actions/guardians");
    const r = await run(() => unlinkGuardian(ORG_WITH_MODULES, IDS.athleteNoGpa, FAMILY_ID, form({ returnTo: `/org/${ORG_WITH_MODULES}/roster/${IDS.athleteNoGpa}` })));
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/${IDS.athleteNoGpa}\\?notice=`));
    expect(filterCols(deletes("athlete_guardians")[0])).toEqual(expect.arrayContaining(["org_id", "athlete_id", "user_id"]));
    expect(links()).toEqual([IDS.athlete, IDS.athleteEnrolled].sort());
    // The sign-in stays.
    expect(data.org_members.some((m) => m.user_id === FAMILY_ID)).toBe(true);
  });

  it("the relationship changes on the one link, and only to a known value", async () => {
    const { updateGuardianRelationship } = await import("@/lib/actions/guardians");
    const bad = await run(() => updateGuardianRelationship(ORG_WITH_MODULES, IDS.athlete, FAMILY_ID, form({ relationship: "owner" })));
    expect(bad.redirect).toMatch(/error=/);
    expect(writes).toEqual([]);
    await run(() => updateGuardianRelationship(ORG_WITH_MODULES, IDS.athlete, FAMILY_ID, form({ relationship: "guardian" })));
    expect(filterCols(updates("athlete_guardians")[0])).toEqual(expect.arrayContaining(["org_id", "athlete_id", "user_id"]));
    expect(data.athlete_guardians.find((g) => g.user_id === FAMILY_ID && g.athlete_id === IDS.athlete)?.relationship).toBe("guardian");
    expect(data.athlete_guardians.find((g) => g.user_id === FAMILY_ID && g.athlete_id === IDS.athleteNoGpa)?.relationship).toBe("parent");
  });

  it("a family login is linked to another of this org's athletes, and only a family login, and only this org's", async () => {
    const { linkGuardian } = await import("@/lib/actions/guardians");
    const ok = await run(() => linkGuardian(ORG_WITH_MODULES, FAMILY_ID, form({ athleteId: IDS.athleteTransfer, relationship: "parent", fromAthleteId: IDS.athlete })));
    expect(ok.redirect).toMatch(/notice=/);
    expect(inserts("athlete_guardians")[0]?.rows[0]).toMatchObject({ org_id: bridgeId(), athlete_id: IDS.athleteTransfer, user_id: FAMILY_ID, relationship: "parent" });

    writes.length = 0;
    const staffLogin = await run(() => linkGuardian(ORG_WITH_MODULES, MEMBER_ID, form({ athleteId: IDS.athleteTransfer })));
    expect(staffLogin.redirect).toMatch(/error=/);
    const elite = await run(() => linkGuardian(ORG_WITH_MODULES, FAMILY_ID, form({ athleteId: IDS.athleteElite })));
    expect(elite.redirect).toMatch(/error=/);
    expect(writes).toEqual([]);
  });

  it("returnTo only ever points inside this org", async () => {
    const { updateGuardianRelationship } = await import("@/lib/actions/guardians");
    const r = await run(() => updateGuardianRelationship(ORG_WITH_MODULES, IDS.athlete, FAMILY_ID, form({ relationship: "parent", returnTo: "https://example.test/phish" })));
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/family/${FAMILY_ID}\\?notice=`));
  });

  it("a member or the family login itself cannot unlink, relabel or link", async () => {
    const { unlinkGuardian, updateGuardianRelationship, linkGuardian } = await import("@/lib/actions/guardians");
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      expect((await run(() => unlinkGuardian(ORG_WITH_MODULES, IDS.athlete, FAMILY_ID))).redirect).toBe("/unauthorized");
      expect((await run(() => updateGuardianRelationship(ORG_WITH_MODULES, IDS.athlete, FAMILY_ID, form({ relationship: "guardian" })))).redirect).toBe("/unauthorized");
      expect((await run(() => linkGuardian(ORG_WITH_MODULES, FAMILY_ID, form({ athleteId: IDS.athleteTransfer })))).redirect).toBe("/unauthorized");
    }
    expect(writes).toEqual([]);
  });
});

describe("LAW: every remove, delete and unlink on an athlete screen asks first", () => {
  // Dave's pick, 2026-09-20: a destructive action opens a confirm sheet.
  // Every screen or component that posts one of these actions must also
  // render a ConfirmButton. Planted: a scratch component under
  // src/components posting removeNote from a plain Button; this failed
  // naming it. Reverted.
  const DESTRUCTIVE = ["removeAthlete", "removeNote", "deleteContact", "deleteMetric", "removeCheckin", "deleteMessage", "unlinkGuardian"];
  // An action handed to a component that does the confirming: the page
  // passes it as that prop, and the component must hold the ConfirmButton.
  const HANDED_TO: Record<string, { component: string; prop: string }> = { deleteMessage: { component: "MessageThread", prop: "remove" } };

  it("each one is posted somewhere, and every file that posts one has a ConfirmButton", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const name of readdirSync(dir)) {
        const p = `${dir}/${name}`;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx$/.test(p)) out.push(p);
      }
      return out;
    };
    const root = process.cwd().replace(/\\/g, "/");
    const ui = [...walk(`${root}/src/app`), ...walk(`${root}/src/components`)];
    const offenders: string[] = [];
    const unused: string[] = [];
    for (const name of DESTRUCTIVE) {
      const users = ui.filter((f) => new RegExp(`\\b${name}\\b`).test(readFileSync(f, "utf8")));
      if (users.length === 0) unused.push(name);
      for (const f of users) {
        const src = readFileSync(f, "utf8");
        if (/<ConfirmButton\b/.test(src)) continue;
        const handed = HANDED_TO[name];
        const component = handed ? `${root}/src/components/${handed.component}.tsx` : null;
        if (handed && component && new RegExp(`<${handed.component}\\b[^>]*\\b${handed.prop}=\\{${name}\\b`).test(src) && /<ConfirmButton\b/.test(readFileSync(component, "utf8"))) continue;
        offenders.push(`${f.slice(root.length + 1)}: ${name}`);
      }
    }
    expect(unused).toEqual([]);
    expect(offenders).toEqual([]);
  });

  it("the thread's Remove is behind a confirm and only on the staff screen", async () => {
    const { readFileSync } = await import("node:fs");
    const root = process.cwd();
    expect(readFileSync(`${root}/src/components/MessageThread.tsx`, "utf8")).toMatch(/remove && \([\s\S]*<ConfirmButton\b/);
    expect(readFileSync(`${root}/src/app/org/[slug]/family/[id]/messages/page.tsx`, "utf8")).not.toMatch(/deleteMessage|remove=/);
  });
});
