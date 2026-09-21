// Every server action actually runs.
//
// The companion to pageRender.test.ts, and the larger hole of the two.
// Fifteen form screens and twenty-five actions had never been executed by
// anything. What IS tested is the pure validation module each one calls,
// which is the easy half; the half that had no coverage is the glue, and
// the glue is where the dangerous mistakes live:
//
//   - the authorization check, or its absence
//   - the org scoping on the row being written
//   - the cross-org guard on a foreign key, which RLS cannot do because
//     RLS only ever sees the new row's own org_id
//   - the error branch, which no test had ever reached
//
// A missing `org_id` on an insert is not a crash. It is a row that lands
// in the wrong org, or in none, and reads back as missing data weeks
// later. Nothing in the type system has an opinion about it.
//
// Actions redirect on success, which throws in Next, so a successful
// action is asserted by its redirect target and by what it wrote.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, OUTSIDER_ID, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let failOn: (table: string, op: string) => string | null = () => null;
let revalidated: string[] = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

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

// The service role. Two actions use it on purpose (creating a school,
// and Doc AI writing shared reference data), and every other action
// reaching for it would be a finding, so it is a separate fake whose
// writes land in the same list under their own flag.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  failOn = () => null;
  revalidated = [];
});

// An action returns a state object on a validation failure and throws a
// redirect on success. This turns both into one shape to assert on.
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

describe("LAW: a created row carries the org that created it", () => {
  // The single highest-consequence field in a multi-tenant app, and the
  // one nothing was checking. A missing org_id is not a crash, it is a
  // row in the wrong place that reads as missing data weeks later.
  it("createAthlete stamps org_id", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() =>
      createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "New Athlete", sport: "baseball", recruitType: "hs", status: "Active" })),
    );
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/`));
    const row = inserts("athletes")[0]?.rows[0];
    expect(row).toBeDefined();
    expect(row?.org_id).toBe(data.orgs[0].id);
    expect(row?.name).toBe("New Athlete");
  });

  it("createMetric stamps org_id and recomputes the athlete's matches", async () => {
    const { createMetric } = await import("@/lib/actions/metrics");
    const r = await run(() => createMetric(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ metric: "fbVelo", value: "87", measuredOn: "2026-09-15", source: "pbr" })));
    expect(r.redirect).toContain(`/roster/${IDS.athlete}/metrics`);
    const [w] = inserts("athlete_metrics");
    expect(w).toBeDefined();
    expect((w!.rows[0] as { org_id: string }).org_id).toBe(data.orgs[0].id);
    expect(writes.some((w) => w.op === "upsert" && w.table === "athlete_school_fits")).toBe(true);
  });

  it("addMatchToBoard stamps org_id and lands at the Target stage", async () => {
    const { addMatchToBoard } = await import("@/lib/actions/matching");
    const r = await run(() => addMatchToBoard(ORG_WITH_MODULES, IDS.athleteNoGpa, IDS.school));
    expect(r.redirect).toContain("/board/");
    const [w] = inserts("recruiting_targets");
    const row = w!.rows[0] as { org_id: string; status: string };
    expect(row.org_id).toBe(data.orgs[0].id);
    expect(row.status).toBe("Target");
  });

  it("saveOrgSchoolNote stamps org_id and parses positions of need", async () => {
    const { saveOrgSchoolNote } = await import("@/lib/actions/schools");
    const r = await run(() => saveOrgSchoolNote(ORG_WITH_MODULES, IDS.schoolD3, { errors: {} }, form({ coachName: "A Coach", positionsOfNeed: "SS 2027; RHP" })));
    expect(r.redirect).toContain(`/schools/${IDS.schoolD3}`);
    const w = writes.find((x) => x.op === "upsert" && x.table === "org_school_notes");
    expect(w).toBeDefined();
    const row = w!.rows[0] as { org_id: string; positions_of_need: unknown };
    expect(row.org_id).toBe(data.orgs[0].id);
    expect(row.positions_of_need).toEqual([{ position: "SS", gradYear: 2027 }, { position: "RHP" }]);
  });

  it("recordGift stamps org_id", async () => {
    const { recordGift } = await import("@/lib/actions/fundraising");
    const r = await run(() =>
      recordGift(ORG_WITH_MODULES, { errors: {} }, form({ amount: "250", receivedOn: "2026-05-05", category: "individual", method: "check", donorId: IDS.donor })),
    );
    expect(r.redirect).toContain("/fundraising");
    expect(inserts("gifts")[0]?.rows[0]?.org_id).toBe(data.orgs[0].id);
  });

  it("createContact stamps org_id", async () => {
    const { createContact } = await import("@/lib/actions/contacts");
    await run(() => createContact(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ name: "New Contact", role: "hs_coach" })));
    expect(inserts("contacts")[0]?.rows[0]?.org_id).toBe(data.orgs[0].id);
  });

  it("logCommunication stamps org_id", async () => {
    const { logCommunication } = await import("@/lib/actions/communications");
    await run(() => logCommunication(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ kind: "email", notes: "hello", occurredOn: "2026-05-05" })));
    expect(inserts("target_communications")[0]?.rows[0]?.org_id).toBe(data.orgs[0].id);
  });

  it("addBoardSeat stamps org_id", async () => {
    const { addBoardSeat } = await import("@/lib/actions/governance");
    await run(() =>
      addBoardSeat(ORG_WITH_MODULES, IDS.board, { errors: {} }, form({ name: "New Seat", status: "active", commitmentAmount: "5000" })),
    );
    expect(inserts("board_members")[0]?.rows[0]?.org_id).toBe(data.orgs[0].id);
  });
});

describe("LAW: a member cannot write", () => {
  // requireRole redirects rather than returning, so a write by somebody
  // without the role never reaches the insert. Checked on the action
  // side as well as in RLS, because the two protect against different
  // things: RLS is the boundary, this is the boundary being asked.
  const CASES: Array<{ name: string; call: () => Promise<unknown> }> = [
    {
      name: "createAthlete",
      call: async () => {
        const { createAthlete } = await import("@/lib/actions/athletes");
        return createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Sneaky", sport: "baseball", recruitType: "hs", status: "Active" }));
      },
    },
    {
      name: "recordGift",
      call: async () => {
        const { recordGift } = await import("@/lib/actions/fundraising");
        return recordGift(ORG_WITH_MODULES, { errors: {} }, form({ amount: "1", receivedOn: "2026-05-05", category: "individual", method: "cash" }));
      },
    },
    {
      name: "addBoardSeat",
      call: async () => {
        const { addBoardSeat } = await import("@/lib/actions/governance");
        return addBoardSeat(ORG_WITH_MODULES, IDS.board, { errors: {} }, form({ name: "Sneaky", status: "active", commitmentAmount: "0" }));
      },
    },
    {
      name: "createMetric",
      call: async () => {
        const { createMetric } = await import("@/lib/actions/metrics");
        return createMetric(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ metric: "fbVelo", value: "99", measuredOn: "2026-09-15", source: "self" }));
      },
    },
    {
      name: "addMatchToBoard",
      call: async () => {
        const { addMatchToBoard } = await import("@/lib/actions/matching");
        return addMatchToBoard(ORG_WITH_MODULES, IDS.athlete, IDS.schoolD3);
      },
    },
    {
      name: "saveOrgSchoolNote",
      call: async () => {
        const { saveOrgSchoolNote } = await import("@/lib/actions/schools");
        return saveOrgSchoolNote(ORG_WITH_MODULES, IDS.school, { errors: {} }, form({ coachName: "Sneaky" }));
      },
    },
    {
      name: "setScoringPreset",
      call: async () => {
        const { setScoringPreset } = await import("@/lib/actions/matching");
        return setScoringPreset(ORG_WITH_MODULES, { errors: {} }, form({ preset: "baseball_first" }));
      },
    },
    {
      name: "importSchools",
      call: async () => {
        const { importSchools } = await import("@/lib/actions/schools");
        const fd = new FormData();
        fd.append("file", new File(["name,division\nSneaky U,D1\n"], "s.csv", { type: "text/csv" }));
        return importSchools(ORG_WITH_MODULES, { errors: {}, problems: [] }, fd);
      },
    },
  ];

  for (const c of CASES) {
    it(`${c.name} refuses a member and writes nothing`, async () => {
      currentUser = MEMBER_ID;
      await expect(c.call()).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      expect(writes).toEqual([]);
    });
  }
});

describe("LAW: a module-gated action checks the gate", () => {
  // A page that does not render is not the same thing as an endpoint
  // that cannot be called. The gate is on both, and this is the half
  // nobody can see by clicking around.
  it("recordGift refuses an org without the fundraising module", async () => {
    const { recordGift } = await import("@/lib/actions/fundraising");
    await expect(
      recordGift(ORG_WITHOUT_MODULES, { errors: {} }, form({ amount: "1", receivedOn: "2026-05-05", category: "individual", method: "cash" })),
    ).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
    expect(writes).toEqual([]);
  });

  it("addBoardSeat refuses an org without the governance module", async () => {
    const { addBoardSeat } = await import("@/lib/actions/governance");
    await expect(
      addBoardSeat(ORG_WITHOUT_MODULES, IDS.board, { errors: {} }, form({ name: "X", status: "active", commitmentAmount: "0" })),
    ).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
    expect(writes).toEqual([]);
  });
});

// Real UUIDs, because the form parsers reject a malformed id before the
// cross-org guard is ever reached. The first draft of these tests used
// "foreign-athlete" as an id and passed for exactly that wrong reason:
// removing the guard entirely did not fail them.
const FOREIGN_ATHLETE = "00000000-0000-0000-0000-0000000009f1";
const FOREIGN_ATHLETE_2 = "00000000-0000-0000-0000-0000000009f2";

describe("LAW: a foreign key from another org is refused", () => {
  // RLS cannot catch this. A policy on target_communications checks that
  // the new row's own org_id is yours; it has nothing to say about the
  // target_id pointing at another org's target. The app has to re-fetch
  // the parent scoped by org before writing, and that guard had never
  // been executed.
  it("createTarget refuses an athlete from another org", async () => {
    data.athletes.push({ ...data.athletes[0], id: FOREIGN_ATHLETE, org_id: data.orgs[1].id });

    const { createTarget } = await import("@/lib/actions/targets");
    const r = await run(() =>
      createTarget(ORG_WITH_MODULES, { errors: {} }, form({ athleteId: FOREIGN_ATHLETE, schoolId: IDS.school, status: "Target" })),
    );
    expect(r.redirect).toBeNull();
    expect((r.state as { errors: Record<string, string> }).errors.athleteId).toMatch(/roster/i);
    expect(inserts("recruiting_targets")).toEqual([]);
  });

  it("createTarget accepts an athlete from this org", async () => {
    const { createTarget } = await import("@/lib/actions/targets");
    const r = await run(() =>
      createTarget(ORG_WITH_MODULES, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Target" })),
    );
    expect(r.redirect).toContain("/board");
    expect(inserts("recruiting_targets")[0]?.rows[0]?.org_id).toBe(data.orgs[0].id);
  });

  it("createContact refuses an athlete from another org", async () => {
    data.athletes.push({ ...data.athletes[0], id: FOREIGN_ATHLETE_2, org_id: data.orgs[1].id });

    const { createContact } = await import("@/lib/actions/contacts");
    const r = await run(() => createContact(ORG_WITH_MODULES, FOREIGN_ATHLETE_2, { errors: {} }, form({ name: "X", role: "hs_coach" })));
    expect(r.redirect).toBeNull();
    expect(inserts("contacts")).toEqual([]);
  });
});

describe("LAW: an update is scoped to the org, not just to the id", () => {
  // An UPDATE filtered only by id relies entirely on RLS. RLS is the
  // right backstop and the wrong only line of defence, because the
  // service-role client bypasses it and one of these actions is a
  // copy-paste away from using one.
  it("updateAthlete filters on org_id as well as id", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    await run(() =>
      updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ name: "Renamed", sport: "baseball", recruitType: "hs", status: "Active" })),
    );
    const update = writes.find((w) => w.op === "update" && w.table === "athletes");
    expect(update).toBeDefined();
    expect(update?.filters.map((f) => f.column)).toContain("org_id");
    expect(update?.filters.map((f) => f.column)).toContain("id");
  });

  it("updateTarget filters on org_id as well as id", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    await run(() =>
      updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Visit" })),
    );
    const update = writes.find((w) => w.op === "update" && w.table === "recruiting_targets");
    expect(update?.filters.map((f) => f.column)).toContain("org_id");
  });

  it("deleteContact filters on org_id as well as id", async () => {
    const { deleteContact } = await import("@/lib/actions/contacts");
    await run(() => deleteContact(ORG_WITH_MODULES, IDS.athlete, "ct1"));
    const del = writes.find((w) => w.op === "delete" && w.table === "contacts");
    expect(del?.filters.map((f) => f.column)).toContain("org_id");
  });
});

describe("LAW: the error branch is reachable and reports rather than redirects", () => {
  // Every action has a `if (error) return { errors: ... }` and not one of
  // them had ever run. An action that redirects on a failed write tells
  // somebody their work saved when it did not, which is the worst
  // outcome available to a form.
  it("createAthlete reports a database error instead of redirecting", async () => {
    failOn = (table, op) => (table === "athletes" && op === "insert" ? "fixture: insert refused" : null);
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() =>
      createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Doomed", sport: "baseball", recruitType: "hs", status: "Active" })),
    );
    expect(r.redirect).toBeNull();
    expect(JSON.stringify((r.state as { errors: unknown }).errors)).toContain("refused");
  });

  it("recordGift reports a database error instead of redirecting", async () => {
    failOn = (table, op) => (table === "gifts" && op === "insert" ? "fixture: insert refused" : null);
    const { recordGift } = await import("@/lib/actions/fundraising");
    const r = await run(() =>
      recordGift(ORG_WITH_MODULES, { errors: {} }, form({ amount: "5", receivedOn: "2026-05-05", category: "individual", method: "cash" })),
    );
    expect(r.redirect).toBeNull();
    expect(JSON.stringify((r.state as { errors: unknown }).errors)).toContain("refused");
  });
});

describe("LAW: a bad form is rejected without writing", () => {
  // The validation modules are unit tested. What is not, until here, is
  // that the action honours them: a parse failure has to return before
  // the insert, and "returns errors" and "wrote nothing" are two
  // different claims.
  it("createAthlete with no name writes nothing", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ sport: "baseball", recruitType: "hs", status: "Active" })));
    expect(r.redirect).toBeNull();
    expect(Object.keys((r.state as { errors: Record<string, string> }).errors).length).toBeGreaterThan(0);
    expect(writes).toEqual([]);
  });

  it("recordGift with no amount writes nothing", async () => {
    const { recordGift } = await import("@/lib/actions/fundraising");
    const r = await run(() => recordGift(ORG_WITH_MODULES, { errors: {} }, form({ receivedOn: "2026-05-05", category: "individual", method: "cash" })));
    expect(r.redirect).toBeNull();
    expect(writes).toEqual([]);
  });

  it("saveApprovedList refuses a short list called complete, and writes nothing", async () => {
    // The rule that makes "complete" mean anything: a handful of rows is
    // not a school's whole catalog, and accepting one is how a real core
    // course silently stops counting.
    const { saveApprovedList } = await import("@/lib/actions/approvedCourses");
    const fd = form({ schoolName: "Somewhere High", sourceNote: "typed", isComplete: "on" });
    fd.append("title_0", "Algebra II");
    fd.append("subject_0", "math");
    fd.append("title_1", "English 11");
    fd.append("subject_1", "english");
    const r = await run(() => saveApprovedList(ORG_WITH_MODULES, { errors: {} }, fd));
    expect(r.redirect).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("LAW: a successful write tells Next what went stale", () => {
  // revalidatePath is what makes the list show the row that was just
  // added. Forgetting it produces the single most confusing bug a form
  // can have: it saved, and the screen says it did not.
  it("createAthlete revalidates the roster", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Fresh", sport: "baseball", recruitType: "hs", status: "Active" })));
    expect(revalidated.some((p) => p.includes("/roster"))).toBe(true);
  });

  it("recordGift revalidates fundraising", async () => {
    const { recordGift } = await import("@/lib/actions/fundraising");
    await run(() => recordGift(ORG_WITH_MODULES, { errors: {} }, form({ amount: "9", receivedOn: "2026-05-05", category: "individual", method: "cash" })));
    expect(revalidated.some((p) => p.includes("/fundraising"))).toBe(true);
  });
});

describe("LAW: a document is read back from Storage, and only from this org's folder", () => {
  // The bytes never arrive in the action (see dataLaws.test.ts). What
  // arrives is a path, and the two things that can go wrong with a path
  // are that it points somewhere else and that it reads nothing. Both
  // have to be refused before a row exists.
  function stored(path: string) {
    return {
      originalName: "transcript.pdf",
      originalSize: 40,
      originalMime: "application/pdf",
      kind: "pdf" as const,
      sourceRole: "parent" as const,
      ingestedAt: "2026-09-19T00:00:00.000Z",
      requestId: "req_fixture",
      mediaType: "application/pdf",
      blockType: "document" as const,
      storagePath: path,
    };
  }

  it("processDocument reads the file from the bucket and records where it is", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const orgId = data.orgs[0]!.id as string;
    const path = `${orgId}/req_fixture/1-transcript.pdf`;
    const r = await processDocument(ORG_WITH_MODULES, { records: [stored(path)], sourceRole: "parent", requestedCategory: "transcript" });
    expect(r.ok).toBe(true);
    const insert = writes.find((w) => w.table === "documents" && w.op === "insert");
    expect(insert?.rows[0]?.org_id).toBe(orgId);
    expect(insert?.rows[0]?.storage_paths).toEqual([path]);
  });

  it("refuses a path in another org's folder without writing", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const otherOrg = data.orgs[1]!.id as string;
    const r = await processDocument(ORG_WITH_MODULES, {
      records: [stored(`${otherOrg}/req_fixture/1-transcript.pdf`)],
      sourceRole: "parent",
      requestedCategory: "transcript",
    });
    expect(r.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses a path that climbs out of the folder", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const orgId = data.orgs[0]!.id as string;
    const r = await processDocument(ORG_WITH_MODULES, {
      records: [stored(`${orgId}/../${orgId}/x.pdf`)],
      sourceRole: "parent",
      requestedCategory: "transcript",
    });
    expect(r.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("refuses a path with nothing behind it without writing", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const orgId = data.orgs[0]!.id as string;
    const r = await processDocument(ORG_WITH_MODULES, {
      records: [stored(`${orgId}/req_missing/1-transcript.pdf`)],
      sourceRole: "parent",
      requestedCategory: "transcript",
    });
    expect(r.ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("LAW: membership is written by the service role, only by an owner, and never leaves an org ownerless", () => {
  // org_members has no INSERT, UPDATE or DELETE policy on purpose
  // (docs/DECISIONS.md, 2026-09-17): a row there is what grants access
  // to everything and it carries its own role. So the owner check is
  // the gate and the admin client is the hand, and both are asserted
  // here rather than assumed.
  const withKey = () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
  };
  const withoutKey = () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  };

  it("an owner inviting a new address sends an invitation and adds the membership", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "New@Example.test", role: "staff", fullName: "New Person" })));
    expect(r.redirect).toContain("/members");
    const invite = writes.find((w) => w.table === "auth:invite");
    expect(invite?.rows[0]?.email).toBe("new@example.test");
    expect(String(invite?.rows[0]?.redirectTo)).toBe("https://app.example.test/auth/callback?next=/");
    const membership = writes.find((w) => w.table === "org_members" && w.op === "insert");
    expect(membership?.rows[0]).toMatchObject({ org_id: data.orgs[0]!.id, role: "staff" });
  });

  it("an owner adding an existing account writes the membership and sends no invitation", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "outsider@example.test", role: "member" })));
    expect(r.redirect).toContain("/members");
    expect(writes.find((w) => w.table === "auth:invite")).toBeUndefined();
    const membership = writes.find((w) => w.table === "org_members" && w.op === "insert");
    expect(membership?.rows[0]).toMatchObject({ user_id: OUTSIDER_ID, org_id: data.orgs[0]!.id, role: "member" });
  });

  it("inviting someone already in the org writes nothing", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "member@example.test", role: "staff" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.email).toMatch(/Already/);
    expect(writes).toEqual([]);
  });

  it("a member cannot invite", async () => {
    withKey();
    currentUser = MEMBER_ID;
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "x@example.test", role: "member" })));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("a family invite writes the membership and the link to the athlete", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "outsider@example.test", role: "family", athleteId: IDS.athlete })));
    expect(r.redirect).toContain("/members");
    expect(r.redirect).toContain("nothing%20else");
    const membership = writes.find((w) => w.table === "org_members" && w.op === "insert");
    expect(membership?.rows[0]).toMatchObject({ user_id: OUTSIDER_ID, org_id: data.orgs[0]!.id, role: "family" });
    const guardian = writes.find((w) => w.table === "athlete_guardians" && w.op === "insert");
    expect(guardian?.rows[0]).toMatchObject({ user_id: OUTSIDER_ID, org_id: data.orgs[0]!.id, athlete_id: IDS.athlete });
  });

  it("a family invite without an athlete is refused before anything is written", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "outsider@example.test", role: "family" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.athleteId).toMatch(/athlete/i);
    expect(writes).toEqual([]);
  });

  it("a family invite for an athlete outside the org is refused", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const FOREIGN = "00000000-0000-0000-0000-0000000000c9";
    data.athletes.push({ ...data.athletes[0], id: FOREIGN, org_id: data.orgs[1]!.id });
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "outsider@example.test", role: "family", athleteId: FOREIGN })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.athleteId).toMatch(/roster/);
    expect(writes).toEqual([]);
  });

  it("a role cannot be changed to or from family", async () => {
    withKey();
    const { changeMemberRole } = await import("@/lib/actions/members");
    const toFamily = await changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "family");
    expect(toFamily.ok).toBe(false);
    expect(toFamily.error).toMatch(/tied to an athlete/);
    const fromFamily = await changeMemberRole(ORG_WITH_MODULES, FAMILY_ID, "staff");
    expect(fromFamily.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("a family member cannot invite", async () => {
    withKey();
    currentUser = FAMILY_ID;
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "x@example.test", role: "member" })));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("without the service role key an invite says so and writes nothing", async () => {
    withoutKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "x@example.test", role: "member" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.form).toMatch(/service role key/);
    expect(writes).toEqual([]);
  });

  it("the only owner cannot be demoted or removed", async () => {
    withKey();
    const { changeMemberRole, removeMember } = await import("@/lib/actions/members");
    const demote = await changeMemberRole(ORG_WITH_MODULES, OWNER_ID, "staff");
    expect(demote.ok).toBe(false);
    expect(demote.error).toMatch(/only owner/);
    const remove = await removeMember(ORG_WITH_MODULES, OWNER_ID);
    expect(remove.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("a role change and a removal go through the admin client, scoped to the org", async () => {
    withKey();
    const { changeMemberRole, removeMember } = await import("@/lib/actions/members");
    expect((await changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "staff")).ok).toBe(true);
    const update = writes.find((w) => w.table === "org_members" && w.op === "update");
    expect(update?.rows[0]).toEqual({ role: "staff" });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        { column: "user_id", value: MEMBER_ID },
        { column: "org_id", value: data.orgs[0]!.id },
      ]),
    );
    expect((await removeMember(ORG_WITH_MODULES, MEMBER_ID)).ok).toBe(true);
    const del = writes.find((w) => w.table === "org_members" && w.op === "delete");
    expect(del?.filters).toEqual(
      expect.arrayContaining([
        { column: "user_id", value: MEMBER_ID },
        { column: "org_id", value: data.orgs[0]!.id },
      ]),
    );
  });

  it("a role that is not a role is refused", async () => {
    withKey();
    const { changeMemberRole } = await import("@/lib/actions/members");
    expect((await changeMemberRole(ORG_WITH_MODULES, MEMBER_ID, "admin")).ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

type MemberState = { errors: Record<string, string> };

describe("LAW: the magic link never creates an account and always comes back to this site", () => {
  it("sendMagicLink asks for a link to /auth/callback with signups off", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
    const { sendMagicLink } = await import("@/lib/auth/actions");
    const r = await sendMagicLink({ sent: false, email: "", error: null }, form({ email: " Owner@Example.test " }));
    expect(r.sent).toBe(true);
    const otp = writes.find((w) => w.table === "auth:otp");
    expect(otp?.rows[0]).toMatchObject({ email: "owner@example.test", emailRedirectTo: "https://app.example.test/auth/callback", shouldCreateUser: false });
  });

  it("an address with no account is told so, not shown 'check your email'", async () => {
    const { sendMagicLink } = await import("@/lib/auth/actions");
    const r = await sendMagicLink({ sent: false, email: "", error: null }, form({ email: "nobody@example.test" }));
    expect(r.sent).toBe(false);
    expect(r.error).toMatch(/no account for nobody@example.test/);
  });

  it("a bad address is refused before any call", async () => {
    const { sendMagicLink } = await import("@/lib/auth/actions");
    const r = await sendMagicLink({ sent: false, email: "", error: null }, form({ email: "nope" }));
    expect(r.sent).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("LAW: the auth callback verifies, then lands on this site only", () => {
  async function get(query: string): Promise<string> {
    const { GET } = await import("@/app/auth/callback/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest(`https://app.example.test/auth/callback${query}`));
    return res.headers.get("location") ?? "";
  }

  it("a token hash is verified and the person lands on the path they asked for", async () => {
    expect(await get("?token_hash=abc&type=magiclink&next=/org/bridge-fixture")).toBe("https://app.example.test/org/bridge-fixture");
    expect(writes.find((w) => w.table === "auth:verify")?.rows[0]).toEqual({ token_hash: "abc", type: "magiclink" });
  });

  it("a code is exchanged", async () => {
    expect(await get("?code=xyz")).toBe("https://app.example.test/");
    expect(writes.find((w) => w.table === "auth:exchange")?.rows[0]).toEqual({ code: "xyz" });
  });

  it("an expired link goes back to sign-in with a reason", async () => {
    expect(await get("?token_hash=expired&type=magiclink")).toMatch(/\/login\?error=/);
  });

  it("an off-site next is ignored", async () => {
    expect(await get("?token_hash=abc&type=magiclink&next=https://evil.example")).toBe("https://app.example.test/");
    expect(await get("?token_hash=abc&type=magiclink&next=//evil.example")).toBe("https://app.example.test/");
  });

  it("nothing to verify is a failure, not a session", async () => {
    expect(await get("")).toMatch(/\/login\?error=/);
    expect(writes).toEqual([]);
  });
});

describe("LAW: a resend is the ordinary magic link, sent for a colleague", () => {
  it("resendInvite sends a link to the invited person's address, without the service role", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
    const { resendInvite } = await import("@/lib/actions/members");
    const r = await resendInvite(ORG_WITH_MODULES, MEMBER_ID);
    expect(r.ok).toBe(true);
    const otp = writes.find((w) => w.table === "auth:otp");
    expect(otp?.rows[0]).toMatchObject({ email: "member@example.test", shouldCreateUser: false });
  });

  it("a member cannot resend", async () => {
    currentUser = MEMBER_ID;
    const { resendInvite } = await import("@/lib/actions/members");
    await expect(resendInvite(ORG_WITH_MODULES, OWNER_ID)).rejects.toThrow(REDIRECT + "/unauthorized");
    expect(writes).toEqual([]);
  });

  it("the form wrappers report back in the query string", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
    const { changeMemberRoleForm, removeMemberForm } = await import("@/lib/actions/members");
    const changed = await run(() => changeMemberRoleForm(ORG_WITH_MODULES, MEMBER_ID, form({ role: "staff" })));
    expect(changed.redirect).toBe(`/org/${ORG_WITH_MODULES}/members/${MEMBER_ID}?notice=Role%20updated.`);
    const refused = await run(() => removeMemberForm(ORG_WITH_MODULES, OWNER_ID));
    expect(refused.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/members/${OWNER_ID}\\?error=`));
    const removed = await run(() => removeMemberForm(ORG_WITH_MODULES, MEMBER_ID));
    expect(removed.redirect).toBe(`/org/${ORG_WITH_MODULES}/members?notice=Removed.`);
  });
});
