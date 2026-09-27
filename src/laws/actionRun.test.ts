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
// The real model caller, stood in for by the stub with a usage report
// attached: the laws below are about the ledger and the cap, not about
// the API. Only reached when ANTHROPIC_API_KEY is set for a test.
vi.mock("@/lib/ai/anthropicCaller", async () => {
  const { createStubCaller } = await import("@/lib/docai/stubCaller");
  return {
    createAnthropicCaller: (opts: { onUsage?: (u: unknown) => Promise<void> | void } = {}) => {
      const stub = createStubCaller({ category: "transcript", seedText: "ledger" });
      return async (call: { requestId: string; model: string }) => {
        if (opts.onUsage) await opts.onUsage({ requestId: call.requestId, model: call.model, inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, costCents: 1.35 });
        return stub(call as never);
      };
    },
  };
});

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

// Applying is refused while no AI key is set, and for any document the
// stand-in read (audit wired F1). The apply laws below are about what an
// apply writes, so they run as a real model's reading with a key set;
// src/laws/documentLaws.test.ts holds the refusals.
async function asRealModel<T>(fn: () => Promise<T>): Promise<T> {
  const had = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-only";
  try {
    return await fn();
  } finally {
    if (had === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = had;
  }
}

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

  it("a family member invited for a second athlete gets the link, not a refusal", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    // The fixture parent is linked to two athletes already; the transfer athlete is a third.
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "parent@example.test", role: "family", athleteId: IDS.athleteTransfer })));
    expect(r.redirect).toContain("as%20well");
    expect(writes.find((w) => w.table === "org_members")).toBeUndefined();
    const guardian = writes.find((w) => w.table === "athlete_guardians" && w.op === "insert");
    expect(guardian?.rows[0]).toMatchObject({ user_id: FAMILY_ID, athlete_id: IDS.athleteTransfer, org_id: data.orgs[0]!.id });
  });

  it("linking a family member to an athlete they already see is refused", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "parent@example.test", role: "family", athleteId: IDS.athlete })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.athleteId).toMatch(/already linked/);
    expect(writes).toEqual([]);
  });

  it("a staff member invited again as family is still already a member", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "member@example.test", role: "family", athleteId: IDS.athlete })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.email).toMatch(/Already/);
    expect(writes).toEqual([]);
  });

  it("removing a family member removes their athlete links with the membership", async () => {
    withKey();
    const { removeMember } = await import("@/lib/actions/members");
    const r = await removeMember(ORG_WITH_MODULES, FAMILY_ID);
    expect(r.ok).toBe(true);
    const links = writes.find((w) => w.table === "athlete_guardians" && w.op === "delete");
    expect(links).toBeTruthy();
    expect(links!.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "user_id", value: FAMILY_ID }), expect.objectContaining({ column: "org_id", value: data.orgs[0]!.id })]));
    expect(writes.find((w) => w.table === "org_members" && w.op === "delete")).toBeTruthy();
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
    // An id no fixture row carries (c9 is the reopened athlete since Stage 1).
    const FOREIGN = "00000000-0000-0000-0000-00000000dead";
    data.athletes.push({ ...data.athletes[0], id: FOREIGN, org_id: data.orgs[1]!.id });
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "outsider@example.test", role: "family", athleteId: FOREIGN })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.athleteId).toMatch(/roster/);
    expect(writes).toEqual([]);
  });

  it("a switch to or from family needs its athlete or a confirm", async () => {
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

describe("LAW: a real model call is charged to the org, and stops at the month's cap", () => {
  const withModel = () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
  };
  const withoutModel = () => {
    delete process.env.ANTHROPIC_API_KEY;
  };
  const stored = (path: string) => ({
    originalName: "transcript.pdf",
    originalSize: 1000,
    originalMime: "application/pdf",
    kind: "pdf" as const,
    sourceRole: "parent" as const,
    ingestedAt: "2026-09-16T12:00:00.000Z",
    requestId: "req_ledger",
    mediaType: "application/pdf",
    blockType: "document" as const,
    storagePath: path,
  });
  const bridgePath = () => `${data.orgs[0]!.id as string}/req_fixture/1-transcript.pdf`;

  it("every call the real model makes lands in docai_usage with the org and the document", async () => {
    withModel();
    try {
      const { processDocument } = await import("@/lib/actions/documents");
      const r = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "parent", requestedCategory: "transcript" });
      expect(r.ok).toBe(true);
      const ledger = writes.filter((w) => w.table === "docai_usage" && w.op === "insert");
      expect(ledger.length).toBeGreaterThanOrEqual(1);
      const doc = writes.find((w) => w.table === "documents" && w.op === "insert");
      for (const row of ledger) {
        expect(row.rows[0]).toMatchObject({ org_id: data.orgs[0]!.id, cost_cents: 1.35, model: expect.any(String) });
        expect(row.rows[0]!.document_id).toBeTruthy();
        expect(doc).toBeTruthy();
      }
    } finally {
      withoutModel();
    }
  });

  it("a call that cannot be recorded is not used: the document fails rather than the cap staying empty", async () => {
    withModel();
    try {
      failOn = (table, op) => (table === "docai_usage" && op === "insert" ? "ledger is down" : null);
      const { processDocument } = await import("@/lib/actions/documents");
      const r = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "parent", requestedCategory: "transcript" });
      // The action answers ok with a document id, as it does for every
      // failed extraction: the failure lives on the document row.
      expect(r.ok).toBe(true);
      const failed = writes.find((w) => w.table === "documents" && w.op === "update" && w.rows[0]?.status === "failed");
      expect(failed).toBeTruthy();
      expect(String(failed!.rows[0]!.failure_reason)).toMatch(/could not be recorded/);
    } finally {
      withoutModel();
    }
  });

  it("the stub is free: no ledger row without a key", async () => {
    withoutModel();
    const { processDocument } = await import("@/lib/actions/documents");
    const r = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "parent", requestedCategory: "transcript" });
    expect(r.ok).toBe(true);
    expect(writes.filter((w) => w.table === "docai_usage")).toEqual([]);
  });

  it("at the cap the upload is refused before a row or a byte", async () => {
    withModel();
    try {
      data.docai_usage!.push({ id: "du_big", org_id: data.orgs[0]!.id, document_id: null, request_id: "req_big", model: "claude-opus-5", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_cents: 1999, created_at: new Date().toISOString() });
      const { processDocument } = await import("@/lib/actions/documents");
      const r = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "parent", requestedCategory: "transcript" });
      expect(r.ok).toBe(false);
      expect((r as { error?: string }).error).toMatch(/\$20\.00.*used up/);
      expect(writes).toEqual([]);
    } finally {
      withoutModel();
    }
  });

  it("last month's spend does not count against this month", async () => {
    withModel();
    try {
      const lastMonth = new Date();
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      data.docai_usage!.push({ id: "du_old", org_id: data.orgs[0]!.id, document_id: null, request_id: "req_old", model: "claude-opus-5", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_cents: 5000, created_at: lastMonth.toISOString() });
      const { processDocument } = await import("@/lib/actions/documents");
      const r = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "parent", requestedCategory: "transcript" });
      expect(r.ok).toBe(true);
    } finally {
      withoutModel();
    }
  });

  it("a cap of zero means reading is off", async () => {
    withModel();
    try {
      const { processDocument } = await import("@/lib/actions/documents");
      const elite = data.orgs[1]!.id as string;
      const r = await processDocument(ORG_WITHOUT_MODULES, { records: [stored(`${elite}/req_fixture/1-transcript.pdf`)], sourceRole: "parent", requestedCategory: "transcript" });
      expect(r.ok).toBe(false);
      expect((r as { error?: string }).error).toMatch(/turned off/);
      expect(writes).toEqual([]);
    } finally {
      withoutModel();
    }
  });

  it("an owner sets the cap in dollars and it lands in cents through the service role", async () => {
    const { setDocaiBudget } = await import("@/lib/actions/docaiBudget");
    const r = await run(() => setDocaiBudget(ORG_WITH_MODULES, { errors: {} }, form({ budget: "35" })));
    expect(r.redirect).toContain("/more");
    const update = writes.find((w) => w.table === "orgs" && w.op === "update");
    expect(update?.rows[0]).toMatchObject({ docai_budget_cents: 3500 });
  });

  it("a bad amount is refused and a member cannot set it", async () => {
    const { setDocaiBudget } = await import("@/lib/actions/docaiBudget");
    const bad = await run(() => setDocaiBudget(ORG_WITH_MODULES, { errors: {} }, form({ budget: "-4" })));
    expect(bad.redirect).toBeNull();
    expect((bad.state as { errors: Record<string, string> }).errors.budget).toBeTruthy();
    expect(writes).toEqual([]);
    currentUser = MEMBER_ID;
    const r = await run(() => setDocaiBudget(ORG_WITH_MODULES, { errors: {} }, form({ budget: "35" })));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });
});

describe("LAW: every document type applies to the record and every apply can be undone", () => {
  const orgId = () => data.orgs[0]!.id as string;
  const pendingDoc = (id: string, category: string, extracted: Record<string, unknown>) => ({
    id,
    org_id: orgId(),
    athlete_id: null,
    file_name: `${category}.pdf`,
    file_size: 1000,
    media_type: "application/pdf",
    source_role: "coordinator",
    status: "pending",
    route: "review",
    category,
    provenance: null,
    extracted,
    candidates: [],
    failure_reason: null,
    applied_at: null,
    applied_changes: null,
    undo_note: null,
    read_by: "claude-opus-5",
    created_at: "2026-09-21",
  });
  const applied = () => writes.find((w) => w.table === "documents" && w.op === "update" && w.rows[0]?.status === "applied");
  // The status moves first (the claim) and what changed is recorded
  // after the apply, in a second write.
  const changesOf = () => writes.find((w) => w.table === "documents" && w.op === "update" && w.rows[0]?.applied_changes !== undefined)!.rows[0]!.applied_changes as Record<string, unknown>;

  it("test scores land on the athlete's detail as the best SAT and ACT, and come back off", async () => {
    data.documents!.push(pendingDoc("doc-scores", "test_scores", { studentName: "Fixture Athlete", tests: [{ type: "SAT", testDate: "2026-03-01", totalScore: 1180 }, { type: "SAT", testDate: "2026-06-01", totalScore: 1250 }, { type: "ACT", testDate: "2026-04-01", totalScore: 27 }] }));
    const { applyDocument, discardDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-scores", IDS.athlete));
    expect(r.ok).toBe(true);
    const detail = writes.find((w) => w.table === "athletes" && w.op === "update")!.rows[0]!.detail as Record<string, unknown>;
    expect(detail).toMatchObject({ kind: "hs", satTotal: 1250, actComposite: 27 });
    expect(changesOf().detail).toMatchObject({ satTotal: { before: null, after: 1250 }, actComposite: { before: null, after: 27 } });
    expect(writes.find((w) => w.table === "athlete_school_fits")).toBeTruthy();

    // The fixture is a snapshot: put the written detail where the undo will read it.
    (data.athletes!.find((a) => a.id === IDS.athlete) as Record<string, unknown>).detail = detail;
    (data.documents!.find((d) => d.id === "doc-scores") as Record<string, unknown>).status = "applied";
    (data.documents!.find((d) => d.id === "doc-scores") as Record<string, unknown>).applied_changes = changesOf();
    writes.length = 0;
    const u = await discardDocument(ORG_WITH_MODULES, "doc-scores");
    expect(u.ok).toBe(true);
    expect(u.undone!.join(" ")).toMatch(/Put back the athlete's previous SAT and ACT/);
    const restored = writes.find((w) => w.table === "athletes" && w.op === "update")!.rows[0]!.detail as Record<string, unknown>;
    expect(restored.satTotal).toBeUndefined();
    expect(restored.actComposite).toBeUndefined();
  });

  it("test scores for a transfer stay on the document", async () => {
    data.documents!.push(pendingDoc("doc-scores-t", "test_scores", { studentName: "Fixture Transfer", tests: [{ type: "SAT", testDate: "2026-03-01", totalScore: 1250 }] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-scores-t", IDS.athleteTransfer));
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/transfer/);
    expect(writes.find((w) => w.table === "athletes" && w.op === "update")).toBeUndefined();
  });

  it("an offer letter adds the college to the board as an Offer, and the undo takes it off", async () => {
    const schoolD3 = data.schools!.find((s) => s.id === IDS.schoolD3)!;
    data.documents!.push(pendingDoc("doc-offer", "offer_letter", { studentName: "Fixture Athlete", college: String(schoolD3.name), offerType: "scholarship", scholarshipPercent: 40, offerDate: "2026-09-01", coachName: "Coach Fixture", isOfficial: true }));
    const { applyDocument, discardDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-offer", IDS.athlete));
    expect(r.ok).toBe(true);
    const insert = writes.find((w) => w.table === "recruiting_targets" && w.op === "insert")!;
    expect(insert.rows[0]).toMatchObject({ org_id: orgId(), athlete_id: IDS.athlete, school_id: IDS.schoolD3, status: "Offer", offer_type: "scholarship", offer_scholarship_percent: 40, coach_name: "Coach Fixture" });
    const change = changesOf().target as { id: string; created: boolean };
    expect(change.created).toBe(true);

    // The fake persists the insert, so the row is already on the table.
    (data.documents!.find((d) => d.id === "doc-offer") as Record<string, unknown>).status = "applied";
    (data.documents!.find((d) => d.id === "doc-offer") as Record<string, unknown>).applied_changes = changesOf();
    writes.length = 0;
    const u = await discardDocument(ORG_WITH_MODULES, "doc-offer");
    expect(u.undone!.join(" ")).toMatch(/Removed the college/);
    expect(writes.find((w) => w.table === "recruiting_targets" && w.op === "delete")).toBeTruthy();
  });

  it("an offer letter for a college already on the board moves it to Offer and the undo puts the stage back", async () => {
    const target = data.recruiting_targets!.find((t) => t.id === IDS.target)!;
    const schoolName = data.schools!.find((s) => s.id === target.school_id)!.name;
    (target as Record<string, unknown>).status = "In Contact";
    (target as Record<string, unknown>).offer_type = null;
    data.documents!.push(pendingDoc("doc-offer2", "offer_letter", { studentName: "Fixture Athlete", college: String(schoolName), offerType: "verbal", offerDate: "2026-09-01", isOfficial: false }));
    const { applyDocument, discardDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-offer2", IDS.athlete));
    expect(r.ok).toBe(true);
    const update = writes.find((w) => w.table === "recruiting_targets" && w.op === "update")!;
    expect(update.rows[0]).toMatchObject({ status: "Offer", offer_type: "verbal" });
    const change = changesOf().target as { created: boolean; before: Record<string, unknown> };
    expect(change.created).toBe(false);
    expect(change.before).toMatchObject({ status: "In Contact", offer_type: null });

    Object.assign(target, update.rows[0]);
    (data.documents!.find((d) => d.id === "doc-offer2") as Record<string, unknown>).status = "applied";
    (data.documents!.find((d) => d.id === "doc-offer2") as Record<string, unknown>).applied_changes = changesOf();
    writes.length = 0;
    const u = await discardDocument(ORG_WITH_MODULES, "doc-offer2");
    expect(u.undone!.join(" ")).toMatch(/Put back the college's previous/);
    const restore = writes.find((w) => w.table === "recruiting_targets" && w.op === "update")!;
    expect(restore.rows[0]).toMatchObject({ status: "In Contact", offer_type: null });
  });

  it("an offer letter naming a school not on file applies nothing and says so", async () => {
    data.documents!.push(pendingDoc("doc-offer3", "offer_letter", { studentName: "Fixture Athlete", college: "Nowhere Tech", offerType: "verbal", offerDate: "2026-09-01", isOfficial: false }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-offer3", IDS.athlete));
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/No school on file named "Nowhere Tech"/);
    expect(writes.find((w) => w.table === "recruiting_targets")).toBeUndefined();
  });

  it("an award letter puts its numbers on the college and the match is rescored from them", async () => {
    const target = data.recruiting_targets!.find((t) => t.id === IDS.target)!;
    const schoolName = data.schools!.find((s) => s.id === target.school_id)!.name;
    data.documents!.push(pendingDoc("doc-aid", "financial_aid", { documentType: "award_letter", college: String(schoolName), academicYear: "2027-28", totalCostOfAttendance: 52000, awards: [{ type: "grant", name: "Fixture Grant", amount: 30000 }, { type: "unsubsidized_loan", name: "Loan", amount: 5000 }] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-aid", IDS.athlete));
    expect(r.ok).toBe(true);
    const update = writes.find((w) => w.table === "recruiting_targets" && w.op === "update")!;
    const aid = update.rows[0]!.aid as { netCost: number; academicYear: string; documentId: string };
    // Gift aid only: the loan is money the family still pays.
    expect(aid).toMatchObject({ netCost: 22000, academicYear: "2027-28", documentId: "doc-aid" });
    Object.assign(target, update.rows[0]);
    writes.length = 0;
    const { recomputeFitsForAthlete } = await import("@/lib/data/fits");
    const fake = createFakeClient(data, { userId: currentUser, recorded: writes }) as unknown as Parameters<typeof recomputeFitsForAthlete>[0];
    await recomputeFitsForAthlete(fake, orgId(), IDS.athlete);
    const fits = writes.find((w) => w.table === "athlete_school_fits")!;
    const row = fits.rows.find((x) => x.school_id === target.school_id)! as { reasons: string[]; dimensions: { financial: { reasons: string[]; confidence: string } } };
    expect(row.dimensions.financial.reasons[0]).toMatch(/award letter for 2027-28/);
    expect(row.dimensions.financial.confidence).toBe("high");
  });

  it("a FAFSA report is kept on file and changes nothing", async () => {
    data.documents!.push(pendingDoc("doc-fafsa", "financial_aid", { documentType: "fafsa_sar", academicYear: "2027-28", sai: 4200, awards: [] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-fafsa", IDS.athlete));
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/FAFSA report is kept on file/);
    expect(writes.find((w) => w.table === "recruiting_targets")).toBeUndefined();
  });

  it("a recommendation letter becomes a contact, once, and the undo removes it", async () => {
    data.documents!.push(pendingDoc("doc-rec", "recommendation", { studentName: "Fixture Athlete", recommenderName: "Fixture Teacher", recommenderTitle: "Counselor", recommenderOrg: "Fixture High School", recType: "academic", letterDate: "2026-05-01", tone: "strong", themes: ["work ethic"], summary: "A strong student." }));
    const { applyDocument, discardDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-rec", IDS.athlete));
    expect(r.ok).toBe(true);
    const insert = writes.find((w) => w.table === "contacts" && w.op === "insert")!;
    expect(insert.rows[0]).toMatchObject({ org_id: orgId(), athlete_id: IDS.athlete, name: "Fixture Teacher", role: "advisor" });
    expect(String(insert.rows[0]!.notes)).toMatch(/Recommendation letter · academic, strong · 2026-05-01 at Fixture High School\. A strong student\./);
    const contactId = changesOf().contactId as string;
    expect(contactId).toBeTruthy();

    // The fake persists the insert, so the row is already on the table.
    // The same letter again: the person is already a contact.
    data.documents!.push(pendingDoc("doc-rec2", "recommendation", { studentName: "Fixture Athlete", recommenderName: "fixture teacher", recommenderTitle: "Counselor", recType: "academic", letterDate: "2026-05-01", tone: "strong", themes: [], summary: "Again." }));
    writes.length = 0;
    const again = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-rec2", IDS.athlete));
    expect(again.error).toMatch(/already one of the athlete's contacts/);
    expect(writes.find((w) => w.table === "contacts")).toBeUndefined();

    (data.documents!.find((d) => d.id === "doc-rec") as Record<string, unknown>).status = "applied";
    (data.documents!.find((d) => d.id === "doc-rec") as Record<string, unknown>).applied_changes = { athleteId: IDS.athlete, athleteFields: {}, gradingScaleId: null, coursesSuperseded: 0, contactId };
    writes.length = 0;
    const u = await discardDocument(ORG_WITH_MODULES, "doc-rec");
    expect(u.undone!.join(" ")).toMatch(/Removed Fixture Teacher/);
    expect(writes.find((w) => w.table === "contacts" && w.op === "delete")).toBeTruthy();
  });
});

describe("LAW: metrics are logged from the Add form and from a metrics report, and both are dated and sourced", () => {
  it("createAthlete logs each first metric as a dated entry with the source, then scores", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() =>
      createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "New Athlete", sport: "Baseball", position: "RHP", recruitType: "hs", status: "Active", metric_fbVelo: "86", metric_strikePct: "61", metricsMeasuredOn: "2026-08-15", metricsSource: "pbr", metricsSourceDetail: "PBR Connecticut" })),
    );
    expect(r.redirect).toMatch(/\/roster\//);
    const athlete = writes.find((w) => w.table === "athletes" && w.op === "insert")!;
    const logged = writes.find((w) => w.table === "athlete_metrics" && w.op === "insert")!;
    expect(logged.rows).toHaveLength(2);
    // The fake mints the athlete's id on insert; the recorded write holds the input, so the id is checked by shape.
    expect(athlete.rows[0]!.name).toBe("New Athlete");
    expect(logged.rows[0]).toMatchObject({ org_id: data.orgs[0]!.id, athlete_id: expect.stringMatching(/^fake-athletes-/), metric: "fbVelo", value: 86, measured_on: "2026-08-15", source: "pbr", source_detail: "PBR Connecticut", entered_by: OWNER_ID });
    expect(writes.findIndex((w) => w.table === "athlete_metrics")).toBeLessThan(writes.findIndex((w) => w.table === "athlete_school_fits"));
  });

  it("createAthlete with a metric and no date saves nothing and says which field", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "New Athlete", sport: "Baseball", recruitType: "hs", status: "Active", metric_fbVelo: "86", metricsMeasuredOn: "", metricsSource: "pbr" })));
    expect(r.redirect).toBeNull();
    expect((r.state as { errors: Record<string, string> }).errors.metricsMeasuredOn).toMatch(/date/);
    expect(writes).toEqual([]);
  });

  it("a metrics report applies as dated, sourced entries and the undo removes exactly those", async () => {
    data.documents!.push({
      id: "doc-metrics", org_id: data.orgs[0]!.id, athlete_id: null, file_name: "showcase.pdf", file_size: 1000, media_type: "application/pdf", source_role: "coordinator", status: "pending", route: "review", category: "metrics", provenance: null,
      extracted: { studentName: "Fixture Athlete", sport: "Baseball", source: "perfect_game", eventName: "PG Northeast", measuredOn: "2026-07", metrics: [{ key: "fbVelo", value: 88 }, { key: "sixty", value: 6.85 }, { key: "verticalJump", value: 30 }] },
      candidates: [], failure_reason: null, applied_at: null, applied_changes: null, undo_note: null, read_by: "claude-opus-5", created_at: "2026-09-21",
    });
    const { applyDocument, discardDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-metrics", IDS.athlete));
    expect(r.ok).toBe(true);
    const logged = writes.find((w) => w.table === "athlete_metrics" && w.op === "insert")!;
    // The unknown key is dropped; a month-only date lands on the first.
    expect(logged.rows).toHaveLength(2);
    expect(logged.rows[0]).toMatchObject({ athlete_id: IDS.athlete, metric: "fbVelo", value: 88, measured_on: "2026-07-01", source: "perfect_game", source_detail: "PG Northeast", entered_by: OWNER_ID });
    expect(writes.find((w) => w.table === "athlete_school_fits")).toBeTruthy();
    const applied = writes.find((w) => w.table === "documents" && w.op === "update" && w.rows[0]?.applied_changes !== undefined)!;
    const changes = applied.rows[0]!.applied_changes as { metricIds: string[] };
    expect(changes.metricIds).toHaveLength(2);

    (data.documents!.find((d) => d.id === "doc-metrics") as Record<string, unknown>).status = "applied";
    (data.documents!.find((d) => d.id === "doc-metrics") as Record<string, unknown>).applied_changes = changes;
    writes.length = 0;
    const u = await discardDocument(ORG_WITH_MODULES, "doc-metrics");
    expect(u.undone!.join(" ")).toMatch(/Removed the 2 metric entries/);
    const del = writes.find((w) => w.table === "athlete_metrics" && w.op === "delete")!;
    expect(del.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "id", value: changes.metricIds })]));
  });
});

describe("LAW: a document is read once, applied once, and a reading that stops leaves a row that says so", () => {
  const stored = (path: string, over: Record<string, unknown> = {}) => ({
    originalName: "transcript.pdf",
    originalSize: 1000,
    originalMime: "application/pdf",
    kind: "pdf" as const,
    sourceRole: "coordinator" as const,
    ingestedAt: "2026-09-21T12:00:00.000Z",
    requestId: "req_once",
    mediaType: "application/pdf",
    blockType: "document" as const,
    storagePath: path,
    ...over,
  });
  const bridgePath = () => `${data.orgs[0]!.id as string}/req_fixture/1-transcript.pdf`;
  const docUpdates = () => writes.filter((w) => w.table === "documents" && w.op === "update");

  it("the detect path pays for one triage, and its verdict is the one the reading uses", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    try {
      const { processDocument } = await import("@/lib/actions/documents");
      const r = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "coordinator", requestedCategory: null });
      expect(r.ok).toBe(true);
      const ledger = writes.filter((w) => w.table === "docai_usage" && w.op === "insert").map((w) => String(w.rows[0]!.request_id));
      // The stand-in model's triage for this seed says retake. One
      // triage charged, and the reading stopped on that answer instead
      // of asking a second time.
      expect(ledger).toEqual(["req_once_triage"]);
      const failed = docUpdates().find((w) => w.rows[0]?.status === "failed");
      expect(failed?.rows[0]).toMatchObject({ failure_stage: "triage_retake", detected_type: "transcript", category: "transcript" });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("a refused upload removes what the browser put in the bucket", async () => {
    const orgId = data.orgs[0]!.id as string;
    const path = `${orgId}/req_junk/1-notes.pdf`;
    data.storage_objects!.push({ bucket: "documents", name: path, base64: Buffer.from("just some text, not a pdf").toString("base64") });
    const { processDocument } = await import("@/lib/actions/documents");
    const r = await processDocument(ORG_WITH_MODULES, { records: [stored(path)], sourceRole: "coordinator", requestedCategory: "transcript" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a PDF or an image/);
    expect(writes.filter((w) => w.table === "documents")).toEqual([]);
    const removed = writes.find((w) => w.table === "storage:documents" && w.op === "delete");
    expect(removed?.rows.map((x) => x.name)).toEqual([path]);
  });

  it("a reading that crashes leaves a failed row, never one stuck at processing", async () => {
    // The roster table vanishing is the fake's way of throwing from
    // inside the reading, after the row exists.
    const { processDocument } = await import("@/lib/actions/documents");
    const athletes = data.athletes;
    delete (data as Record<string, unknown>).athletes;
    let r;
    try {
      r = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "coordinator", requestedCategory: "transcript" });
    } finally {
      data.athletes = athletes;
    }
    expect(r.ok).toBe(true);
    const failed = docUpdates().find((w) => w.rows[0]?.status === "failed");
    expect(failed).toBeTruthy();
    expect(failed!.rows[0]).toMatchObject({ failure_stage: "crash" });
    expect(String(failed!.rows[0]!.failure_reason)).toMatch(/Nothing was changed on any athlete/);
  });

  const pending = (id: string, category: string, extracted: Record<string, unknown>) => ({
    id, org_id: data.orgs[0]!.id, athlete_id: null, file_name: "x.pdf", file_size: 1, media_type: "application/pdf", source_role: "coordinator", status: "pending", route: "review", category, provenance: null,
    extracted, candidates: [], failure_reason: null, applied_at: null, applied_changes: null, undo_note: null, read_by: "claude-opus-5", created_at: "2026-09-21",
  });

  it("a second Apply on an applied document is refused and touches nothing", async () => {
    data.documents!.push(pending("doc-once", "metrics", { studentName: "Fixture Athlete", source: "pbr", measuredOn: "2026-07-04", metrics: [{ key: "fbVelo", value: 84 }] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const first = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-once", IDS.athlete));
    expect(first.ok).toBe(true);
    expect(writes.filter((w) => w.table === "athlete_metrics" && w.op === "insert")).toHaveLength(1);
    writes.length = 0;
    const second = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-once", IDS.athlete));
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already been applied/);
    expect(writes.filter((w) => w.table === "athlete_metrics")).toEqual([]);
  });

  it("the claim comes before the write: if the document cannot be claimed the athlete is not touched", async () => {
    data.documents!.push(pending("doc-claim", "metrics", { studentName: "Fixture Athlete", source: "pbr", measuredOn: "2026-07-04", metrics: [{ key: "fbVelo", value: 84 }] }));
    failOn = (table, op) => (table === "documents" && op === "update" ? "row locked" : null);
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-claim", IDS.athlete));
    expect(r.ok).toBe(false);
    expect(writes.filter((w) => w.table === "athlete_metrics")).toEqual([]);
  });

  it("a second discard finds the document already discarded", async () => {
    data.documents!.push(pending("doc-twice", "metrics", { studentName: "Fixture Athlete", source: "pbr", measuredOn: "2026-07-04", metrics: [{ key: "fbVelo", value: 84 }] }));
    const { discardDocument } = await import("@/lib/actions/documents");
    expect((await discardDocument(ORG_WITH_MODULES, "doc-twice")).ok).toBe(true);
    const again = await discardDocument(ORG_WITH_MODULES, "doc-twice");
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/already discarded/);
  });

  it("a metrics report dated in the future logs nothing and says why", async () => {
    data.documents!.push(pending("doc-future", "metrics", { studentName: "Fixture Athlete", source: "pbr", measuredOn: "2099-01-01", metrics: [{ key: "fbVelo", value: 84 }] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-future", IDS.athlete));
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/in the future/);
    expect(writes.filter((w) => w.table === "athlete_metrics")).toEqual([]);
  });

  it("a metric that is not a plausible reading is left out at apply time too", async () => {
    data.documents!.push(pending("doc-slip", "metrics", { studentName: "Fixture Athlete", source: "pbr", measuredOn: "2026-07-04", metrics: [{ key: "fbVelo", value: 8.4 }, { key: "sixty", value: 6.9 }] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-slip", IDS.athlete));
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/fbVelo 8.4/);
    const logged = writes.find((w) => w.table === "athlete_metrics" && w.op === "insert")!;
    expect(logged.rows.map((x) => x.metric)).toEqual(["sixty"]);
  });

  it("an SAT whose total did not read is still scored from its sections", async () => {
    data.documents!.push(pending("doc-sections", "test_scores", { studentName: "Fixture Athlete", tests: [{ type: "SAT", testDate: "2026-03-01", totalScore: null, breakdown: { math: 640, ebrw: 610 } }] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-sections", IDS.athlete));
    expect(r.ok).toBe(true);
    const detail = writes.find((w) => w.table === "athletes" && w.op === "update")!.rows[0]!.detail as Record<string, unknown>;
    expect(detail.satTotal).toBe(1250);
  });

  it("a transcript that changes the GPA rescores the athlete's matches, and the undo rescores again", async () => {
    data.documents!.push(pending("doc-gpa", "transcript", { studentName: "Fixture Athlete", school: "Fixture High", gradYear: 2027, gpa: 3.9, gpaScale: "4.0", gpaVerified: true, courseLoad: "Regular", courses: [] }));
    const { applyDocument, discardDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-gpa", IDS.athlete));
    expect(r.ok).toBe(true);
    expect(writes.find((w) => w.table === "athlete_school_fits")).toBeTruthy();
    const changes = writes.find((w) => w.table === "documents" && w.op === "update" && w.rows[0]?.applied_changes !== undefined)!.rows[0]!.applied_changes as Record<string, unknown>;
    (data.documents!.find((d) => d.id === "doc-gpa") as Record<string, unknown>).applied_changes = changes;
    writes.length = 0;
    const u = await discardDocument(ORG_WITH_MODULES, "doc-gpa");
    expect(u.ok).toBe(true);
    expect(u.undone!.join(" ")).toMatch(/Put back the athlete's previous GPA/);
    expect(writes.find((w) => w.table === "athlete_school_fits")).toBeTruthy();
  });
});

describe("LAW: the same file is read once, a stuck reading can be cleared, and a transcript is applied by its level", () => {
  const stored = (path: string) => ({
    originalName: "transcript.pdf",
    originalSize: 1000,
    originalMime: "application/pdf",
    kind: "pdf" as const,
    sourceRole: "coordinator" as const,
    ingestedAt: "2026-09-21T12:00:00.000Z",
    requestId: "req_twice",
    mediaType: "application/pdf",
    blockType: "document" as const,
    storagePath: path,
  });
  const bridgePath = () => `${data.orgs[0]!.id as string}/req_fixture/1-transcript.pdf`;
  const pending = (id: string, category: string, extracted: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    id, org_id: data.orgs[0]!.id, athlete_id: null, file_name: "x.pdf", file_size: 1, media_type: "application/pdf", source_role: "coordinator", status: "pending", route: "review", category, provenance: null,
    extracted, candidates: [], failure_reason: null, applied_at: null, applied_changes: null, undo_note: null, read_by: "claude-opus-5", created_at: "2026-09-21", ...over,
  });

  it("the second upload of the same bytes is refused, pointing at the first, and its file is dropped", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const first = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "coordinator", requestedCategory: "transcript" });
    expect(first.ok).toBe(true);
    const insert = writes.find((w) => w.table === "documents" && w.op === "insert")!;
    expect(String(insert.rows[0]!.content_hash)).toMatch(/^[0-9a-f]{64}$/);
    writes.length = 0;
    const second = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "coordinator", requestedCategory: "transcript" });
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already uploaded/);
    expect(second.documentId).toBe(first.documentId);
    expect(writes.filter((w) => w.table === "documents")).toEqual([]);
    expect(writes.find((w) => w.table === "storage:documents" && w.op === "delete")).toBeTruthy();
  });

  it("a discarded copy does not block reading the file again", async () => {
    const { processDocument, discardDocument } = await import("@/lib/actions/documents");
    const first = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "coordinator", requestedCategory: "transcript" });
    expect((await discardDocument(ORG_WITH_MODULES, first.documentId!)).ok).toBe(true);
    const again = await processDocument(ORG_WITH_MODULES, { records: [stored(bridgePath())], sourceRole: "coordinator", requestedCategory: "transcript" });
    expect(again.ok).toBe(true);
    expect(again.documentId).not.toBe(first.documentId);
  });

  it("a reading still marked processing after ten minutes can be discarded; a fresh one cannot", async () => {
    data.documents!.push(pending("doc-old", "transcript", {}, { status: "processing", created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }));
    data.documents!.push(pending("doc-fresh", "transcript", {}, { status: "processing", created_at: new Date().toISOString() }));
    const { discardDocument } = await import("@/lib/actions/documents");
    expect((await discardDocument(ORG_WITH_MODULES, "doc-old")).ok).toBe(true);
    const fresh = await discardDocument(ORG_WITH_MODULES, "doc-fresh");
    expect(fresh.ok).toBe(false);
    expect(fresh.error).toMatch(/still being read/);
  });

  it("a college transcript keeps its GPA and leaves its courses on the document", async () => {
    data.documents!.push(pending("doc-college", "transcript", { studentName: "Fixture Athlete", school: "Sample College", level: "college", gpa: 3.2, gpaScale: "4.0", courses: [{ title: "Calculus I", subject: "math", credit: 4, grade: "B" }] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-college", IDS.athlete));
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/College courses were left on the document/);
    expect(writes.find((w) => w.table === "athletes" && w.op === "update")!.rows[0]!.gpa).toBe(3.2);
    expect(writes.filter((w) => w.table === "athlete_courses")).toEqual([]);
  });

  it("a middle school transcript changes nothing", async () => {
    data.documents!.push(pending("doc-ms", "transcript", { studentName: "Fixture Athlete", school: "Sample Middle", level: "middle_school", gpa: 3.9, gpaScale: "4.0", courses: [] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-ms", IDS.athlete));
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/middle school/);
    expect(writes.filter((w) => w.table === "athletes")).toEqual([]);
  });

  it("a metric from another sport is left out and named", async () => {
    data.documents!.push(pending("doc-hoops", "metrics", { studentName: "Fixture Athlete", source: "event", measuredOn: "2026-07-04", metrics: [{ key: "ppg", value: 18 }, { key: "fbVelo", value: 84 }] }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await asRealModel(() => applyDocument(ORG_WITH_MODULES, "doc-hoops", IDS.athlete));
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/Points per Game 18: not a baseball metric/);
    const logged = writes.find((w) => w.table === "athlete_metrics" && w.op === "insert")!;
    expect(logged.rows.map((x) => x.metric)).toEqual(["fbVelo"]);
  });
});

describe("LAW: a family invite from an athlete's page is a staff job, and comes back to that athlete", () => {
  // Dave's pick, 2026-09-21: staff invite a family from the athlete's
  // page. That widens who may call inviteMember, so what a staff member
  // may NOT do is asserted next to what they may.
  const withKey = () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
  };
  const asStaff = () => {
    data.org_members.push({ id: "m9", user_id: OUTSIDER_ID, org_id: data.orgs[0]!.id, role: "staff" });
    currentUser = OUTSIDER_ID;
  };

  it("a staff member may invite a family and the relationship is written", async () => {
    withKey();
    asStaff();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() =>
      inviteMember(
        ORG_WITH_MODULES,
        { errors: {} },
        form({ email: "grandma@example.test", role: "family", athleteId: IDS.athlete, relationship: "guardian", returnTo: `/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}` }),
      ),
    );
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}?notice=${encodeURIComponent("Invitation sent to grandma@example.test. They will see Fixture Athlete and nothing else.")}`);
    const guardian = writes.find((w) => w.table === "athlete_guardians" && w.op === "insert");
    expect(guardian?.rows[0]).toMatchObject({ athlete_id: IDS.athlete, org_id: data.orgs[0]!.id, relationship: "guardian" });
    expect(revalidated).toContain(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}`);
  });

  it("a staff member cannot invite staff", async () => {
    withKey();
    asStaff();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "new-coach@example.test", role: "staff" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.role).toMatch(/Only an owner/);
    expect(writes).toEqual([]);
  });

  it("a return path outside this org is ignored", async () => {
    withKey();
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(ORG_WITH_MODULES, { errors: {} }, form({ email: "outsider@example.test", role: "family", athleteId: IDS.athlete, returnTo: "https://evil.test/steal" })));
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/members\\?notice=`));
  });
});

describe("LAW: a board seat points at one sign-in, in this org", () => {
  // The seat is what a member's own Giving screen reads, through
  // member_giving()'s my_seat_id. A seat pointed at the wrong person
  // shows them someone else's give/get, so every branch is asserted.
  it("linking writes the sign-in on the seat, scoped to the org", async () => {
    const { linkSeatSignIn } = await import("@/lib/actions/governance");
    const r = await run(() => linkSeatSignIn(ORG_WITH_MODULES, IDS.board, "bm2", form({ userId: OWNER_ID })));
    expect(r.redirect).toContain("notice=");
    const update = writes.find((w) => w.table === "board_members" && w.op === "update");
    expect(update?.rows[0]).toMatchObject({ user_id: OWNER_ID });
    expect(update?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "id", value: "bm2" }), expect.objectContaining({ column: "org_id", value: data.orgs[0]!.id })]));
  });

  it("a family login cannot hold a seat", async () => {
    const { linkSeatSignIn } = await import("@/lib/actions/governance");
    const r = await run(() => linkSeatSignIn(ORG_WITH_MODULES, IDS.board, "bm2", form({ userId: FAMILY_ID })));
    expect(r.redirect).toContain("error=");
    expect(decodeURIComponent(r.redirect!)).toMatch(/family login cannot hold a seat/);
    expect(writes.filter((w) => w.table === "board_members")).toEqual([]);
  });

  it("someone outside the org cannot hold a seat", async () => {
    const { linkSeatSignIn } = await import("@/lib/actions/governance");
    const r = await run(() => linkSeatSignIn(ORG_WITH_MODULES, IDS.board, "bm2", form({ userId: OUTSIDER_ID })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/member of this organization/);
    expect(writes.filter((w) => w.table === "board_members")).toEqual([]);
  });

  it("a second seat for the same sign-in is refused", async () => {
    const { linkSeatSignIn } = await import("@/lib/actions/governance");
    // The fixture chair is already linked to the member login.
    const r = await run(() => linkSeatSignIn(ORG_WITH_MODULES, IDS.board, "bm2", form({ userId: MEMBER_ID })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/already linked to another seat/);
    expect(writes.filter((w) => w.table === "board_members")).toEqual([]);
  });

  it("unlinking clears the sign-in", async () => {
    const { linkSeatSignIn } = await import("@/lib/actions/governance");
    const r = await run(() => linkSeatSignIn(ORG_WITH_MODULES, IDS.board, IDS.boardMember, form({ userId: "" })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/no longer linked/);
    expect(writes.find((w) => w.table === "board_members" && w.op === "update")?.rows[0]).toMatchObject({ user_id: null });
  });

  it("a seat in another org is refused", async () => {
    const { linkSeatSignIn } = await import("@/lib/actions/governance");
    const r = await run(() => linkSeatSignIn(ORG_WITH_MODULES, IDS.board, "no-such-seat", form({ userId: OWNER_ID })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/not in this organization/);
    expect(writes).toEqual([]);
  });
});

describe("LAW: transfer window dates are data an owner enters, never code", () => {
  // src/lib/fit/transfer.ts reports timing as unverified when no window
  // row matches. This is the only way a row gets there, so the gate and
  // the shape of the row are both asserted.
  it("an owner adds a window through the service role", async () => {
    const { createTransferWindow } = await import("@/lib/actions/transferWindows");
    const r = await run(() =>
      createTransferWindow(
        ORG_WITH_MODULES,
        { errors: {} },
        form({ sport: "Baseball", division: "D1", seasonYear: "2026-27", windowLabel: "Winter", opensOn: "2026-12-01", closesOn: "2026-12-15", sourceUrl: "https://ncaa.org/windows" }),
      ),
    );
    expect(r.redirect).toContain("/transfer-windows?notice=");
    const row = writes.find((w) => w.table === "transfer_windows" && w.op === "insert")?.rows[0];
    expect(row).toMatchObject({ sport: "baseball", division: "D1", season_year: "2026-27", window_label: "Winter", opens_on: "2026-12-01", closes_on: "2026-12-15", source_url: "https://ncaa.org/windows" });
  });

  it("a window that closes before it opens is refused", async () => {
    const { createTransferWindow } = await import("@/lib/actions/transferWindows");
    const r = await run(() =>
      createTransferWindow(
        ORG_WITH_MODULES,
        { errors: {} },
        form({ sport: "Baseball", division: "D1", seasonYear: "2026", windowLabel: "Winter", opensOn: "2026-12-15", closesOn: "2026-12-01", sourceUrl: "https://ncaa.org/windows" }),
      ),
    );
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.closesOn).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it("a window with no source is refused", async () => {
    const { createTransferWindow } = await import("@/lib/actions/transferWindows");
    const r = await run(() =>
      createTransferWindow(ORG_WITH_MODULES, { errors: {} }, form({ sport: "Baseball", division: "D1", seasonYear: "2026", windowLabel: "Winter", opensOn: "2026-12-01", closesOn: "2026-12-15" })),
    );
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.sourceUrl).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it("the same window twice is refused", async () => {
    const { createTransferWindow } = await import("@/lib/actions/transferWindows");
    const r = await run(() =>
      createTransferWindow(
        ORG_WITH_MODULES,
        { errors: {} },
        form({ sport: "Baseball", division: "D2", seasonYear: "2026", windowLabel: "Fixture window", opensOn: "2026-12-01", closesOn: "2026-12-15", sourceUrl: "https://ncaa.org/windows" }),
      ),
    );
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.windowLabel).toMatch(/already on file/);
    expect(writes).toEqual([]);
  });

  it("a duplicate that slips past the check still reads as one", async () => {
    // The unique index (migration 0032) is what holds when two owners
    // write at the same moment. The fake client cannot race, so the
    // insert is made to fail the way Postgres would.
    failOn = (table, op) => (table === "transfer_windows" && op === "insert" ? 'duplicate key value violates unique constraint "transfer_windows_unique_idx"' : null);
    const { createTransferWindow } = await import("@/lib/actions/transferWindows");
    const r = await run(() =>
      createTransferWindow(
        ORG_WITH_MODULES,
        { errors: {} },
        form({ sport: "Soccer", division: "D1", seasonYear: "2026", windowLabel: "Winter", opensOn: "2026-12-01", closesOn: "2026-12-15", sourceUrl: "https://ncaa.org/windows" }),
      ),
    );
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.windowLabel).toMatch(/already on file/);
  });

  it("staff cannot add or remove a window", async () => {
    currentUser = MEMBER_ID;
    const { createTransferWindow, deleteTransferWindow } = await import("@/lib/actions/transferWindows");
    const add = await run(() =>
      createTransferWindow(
        ORG_WITH_MODULES,
        { errors: {} },
        form({ sport: "Baseball", division: "D1", seasonYear: "2026", windowLabel: "Winter", opensOn: "2026-12-01", closesOn: "2026-12-15", sourceUrl: "https://ncaa.org/windows" }),
      ),
    );
    expect(add.redirect).toBe("/unauthorized");
    const remove = await run(() => deleteTransferWindow(ORG_WITH_MODULES, "tw1"));
    expect(remove.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("an owner removes a window", async () => {
    const { deleteTransferWindow } = await import("@/lib/actions/transferWindows");
    const r = await run(() => deleteTransferWindow(ORG_WITH_MODULES, "tw1"));
    expect(decodeURIComponent(r.redirect!)).toContain("Window removed");
    const del = writes.find((w) => w.table === "transfer_windows" && w.op === "delete");
    expect(del?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "id", value: "tw1" })]));
  });
});

describe("LAW: enrolling closes out recruiting, and nothing else does it silently", () => {
  // Dave, 2026-09-26, after trying to update an athlete's status and
  // watching nothing else change: "their status should change and
  // everything should shift based on that status... it should be
  // cleared out." src/lib/data/enrollment.ts is the one place this
  // actually happens; both callers below run through it.

  it("marks Enrolled, closes the open target with a note, and leaves the Committed one alone", async () => {
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const r = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ enrolledOn: "2026-09-01" })));
    expect(r.redirect).toContain(`/roster/${IDS.athleteCommitted}?notice=`);
    expect(decodeURIComponent(r.redirect!)).toMatch(/Enrolled at Fixture State University\. 1 other target closed\./);

    const closed = writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === IDS.targetToClose));
    // closed_from records what the close-out replaced, so Reopen
    // Recruiting can put it back (Stage 1, 2026-09-26). Proven to bite
    // by dropping the closed_from write in enrollment.ts: planted and
    // reverted.
    expect(closed?.rows[0]).toMatchObject({ status: "Not Interested", closed_from: "In Contact" });
    expect(String(closed?.rows[0]?.notes)).toMatch(/Closed automatically: Fixture Committed enrolled at Fixture State University on Sep 1, 2026\./);

    expect(writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === IDS.targetCommitted))).toBeUndefined();

    const athleteUpdate = writes.find((w) => w.table === "athletes" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === IDS.athleteCommitted));
    expect(athleteUpdate?.rows[0]).toMatchObject({ status: "Enrolled", first_full_time_enrollment: "2026-09-01" });
  });

  it("an athlete already in college is enrolled at their Current School, and their open targets close", async () => {
    // Dave, 2026-09-26: "if I click edit and I put their school in...
    // when I mark them as enrolled, it just says enrolled, doesn't even
    // say what school." The Current School on the record is the school.
    data.recruiting_targets.push({ id: "tx-open", org_id: data.orgs[0]!.id, athlete_id: IDS.athleteTransfer, school_id: IDS.school, status: "In Contact", coach_name: null, offer_type: null, offer_scholarship_percent: null, updated_at: "2026-08-01" });
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const r = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteTransfer, { errors: {} }, form({ enrolledOn: "2026-09-01", schoolId: "" })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/notice=Enrolled at City College of New York\. 1 other target closed\./);

    const closed = writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === "tx-open"));
    expect(closed?.rows[0]).toMatchObject({ status: "Not Interested" });
    expect(String(closed?.rows[0]?.notes)).toMatch(/enrolled at City College of New York on Sep 1, 2026\./);
    expect(writes.some((w) => w.table === "recruiting_targets" && w.op === "insert")).toBe(false);
  });

  it("with no Committed target and no Current School, the picked school becomes the Committed target", async () => {
    // IDS.athlete holds an Offer from IDS.school: picking that school
    // commits the existing target rather than closing it or adding a
    // second one for the same school.
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const r = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ enrolledOn: "2026-09-01", schoolId: IDS.school })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/notice=Enrolled at Fixture State University\.$/);

    const committed = writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === IDS.target));
    expect(committed?.rows[0]).toMatchObject({ status: "Committed" });
    expect(writes.filter((w) => w.table === "recruiting_targets" && w.op === "update" && (w.rows[0] as { status?: string })?.status === "Not Interested")).toEqual([]);
    const athleteUpdate = writes.find((w) => w.table === "athletes" && w.op === "update");
    expect(athleteUpdate?.rows[0]).toMatchObject({ status: "Enrolled" });
  });

  it("with no Committed target and no Current School, a school the org has never targeted is added as the Committed one", async () => {
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const r = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ enrolledOn: "2026-09-01", schoolId: IDS.schoolD3 })));
    expect(r.redirect).toContain("?notice=");
    const inserted = writes.find((w) => w.table === "recruiting_targets" && w.op === "insert");
    expect(inserted?.rows[0]).toMatchObject({ athlete_id: IDS.athlete, school_id: IDS.schoolD3, status: "Committed" });
  });

  it("never enrolls an athlete nowhere: no Committed target, no Current School, no pick", async () => {
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const r = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ enrolledOn: "2026-09-01", schoolId: "" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.schoolId).toMatch(/Pick the school/);
    expect(writes).toEqual([]);
  });

  it("a board commit closes every other open target, and taking it back brings them back", async () => {
    // Dave, 2026-09-26: Derek committed to one school and still showed
    // In Contact at two others. A commitment ends recruiting everywhere
    // else, the same way enrolling does. Planted and reverted: dropped
    // the closeOpenTargets call in syncCommitment, watched this fail.
    data.recruiting_targets.push({ id: "other-open", org_id: data.orgs[0]!.id, athlete_id: IDS.athlete, school_id: IDS.schoolD3, status: "In Contact", coach_name: null, offer_type: null, offer_scholarship_percent: null, closed_from: null, notes: null, updated_at: "2026-08-01" });
    const { updateTarget } = await import("@/lib/actions/targets");
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Committed" })));
    const closed = writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === "other-open"));
    expect(closed?.rows[0]).toMatchObject({ status: "Not Interested", closed_from: "In Contact" });
    expect(String(closed?.rows[0]?.notes)).toMatch(/committed to Fixture State University/);

    writes.length = 0;
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Offer" })));
    const restored = writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === "other-open"));
    expect(restored?.rows[0]).toMatchObject({ status: "In Contact", closed_from: null });
    expect(String(restored?.rows[0]?.notes)).toMatch(/commitment withdrawn/);
  });

  it("the Edit dropdown cannot set Committed without a commitment on the board", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "baseball", recruitType: "hs", status: "Committed" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.status).toMatch(/Targets board/);
    expect(writes).toEqual([]);
  });

  it("a board commit makes the athlete Committed, and taking it back makes them Active again", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    const commit = await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Committed" })));
    expect(commit.redirect).toContain(`/board/${IDS.target}`);
    expect(writes.find((w) => w.table === "athletes" && w.op === "update")?.rows[0]).toMatchObject({ status: "Committed" });
    expect(data.athletes.find((a) => a.id === IDS.athlete)?.status).toBe("Committed");

    writes.length = 0;
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Offer" })));
    expect(writes.find((w) => w.table === "athletes" && w.op === "update")?.rows[0]).toMatchObject({ status: "Active" });
  });

  // A placed athlete has no score anywhere (Dave, 2026-09-26), and the
  // lead's call the same day: neither does an Inactive one, since
  // scoring is only for a kid actively recruiting. The stored rows go
  // at the moment recruiting ends and never come back through a
  // recompute. Proven to bite by removing the `.in("status", ...)`
  // filter in fits.ts and watching the Recalculate law fail: planted
  // and reverted.
  const fitDeletes = () => writes.filter((w) => w.table === "athlete_school_fits" && w.op === "delete");
  const fitUpserts = () => writes.filter((w) => w.table === "athlete_school_fits" && w.op === "upsert").flatMap((w) => w.rows as { athlete_id: string }[]);

  it("a close-out deletes every stored fit for the athlete", async () => {
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ enrolledOn: "2026-09-01" })));
    const del = fitDeletes().find((w) => w.filters.some((f) => f.column === "athlete_id" && f.value === IDS.athleteCommitted));
    expect(del).toBeDefined();
    expect(del?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "org_id", value: data.orgs[0]!.id })]));
    expect(fitUpserts()).toEqual([]);
  });

  it("Recalculate All never scores a placed or Inactive athlete, and deletes what it finds on one", async () => {
    const org = data.orgs[0]!.id;
    data.athletes.push({ ...data.athletes.find((a) => a.id === IDS.athleteNoGpa)!, id: "a-inactive", name: "Fixture Inactive", status: "Inactive" });
    data.athlete_school_fits.push({ ...data.athlete_school_fits.find((f) => f.athlete_id === IDS.athleteNoGpa)!, id: "fit-stale", athlete_id: "a-inactive" });
    const quiet = [IDS.athleteCommitted, IDS.athleteEnrolled, IDS.athleteGraduated, IDS.athleteDrafted, "a-inactive"];

    const { recalculateAllMatches } = await import("@/lib/actions/matching");
    const r = await run(() => recalculateAllMatches(ORG_WITH_MODULES));
    expect(decodeURIComponent(r.redirect!)).toMatch(/matches recalculated/);

    const del = fitDeletes().find((w) => w.filters.some((f) => f.column === "athlete_id"));
    const deleted = del?.filters.find((f) => f.column === "athlete_id")?.value as string[];
    expect(deleted).toEqual(expect.arrayContaining(quiet));
    expect(del?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "org_id", value: org })]));

    const scored = new Set(fitUpserts().map((r) => r.athlete_id));
    for (const id of quiet) expect(scored.has(id)).toBe(false);
    expect(scored.has(IDS.athlete)).toBe(true);
    expect(scored.has(IDS.athleteTransferring)).toBe(true);
    expect(data.athlete_school_fits.some((f) => f.athlete_id === "a-inactive")).toBe(false);
  });

  it("a board commit clears the athlete's scores, and taking it back scores them again", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Committed" })));
    expect(fitDeletes().some((w) => w.filters.some((f) => f.column === "athlete_id" && f.value === IDS.athlete))).toBe(true);
    expect(fitUpserts().some((r) => r.athlete_id === IDS.athlete)).toBe(false);
    expect(data.athlete_school_fits.some((f) => f.athlete_id === IDS.athlete)).toBe(false);

    writes.length = 0;
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Offer" })));
    expect(fitUpserts().some((r) => r.athlete_id === IDS.athlete)).toBe(true);
  });

  it("a Transferring athlete who commits on the board is placed, and stops scoring, like an Active one", async () => {
    // Transferring is Active for a college athlete; a commitment ends
    // their recruiting the same way. Without this the athlete stayed
    // Transferring with a Committed target, which placementOf() reads
    // as not placed at all, and kept scoring.
    const { updateTarget } = await import("@/lib/actions/targets");
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.targetTransferring, { errors: {} }, form({ athleteId: IDS.athleteTransferring, schoolId: IDS.schoolD3, status: "Committed" })));
    const athlete = writes.find((w) => w.table === "athletes" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === IDS.athleteTransferring));
    expect(athlete?.rows[0]).toMatchObject({ status: "Committed" });
    expect(fitDeletes().some((w) => w.filters.some((f) => f.column === "athlete_id" && f.value === IDS.athleteTransferring))).toBe(true);
    expect(data.athlete_school_fits.some((f) => f.athlete_id === IDS.athleteTransferring)).toBe(false);
  });

  it("a board edit never touches an Enrolled athlete's status", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    await run(() => updateTarget(ORG_WITH_MODULES, IDS.targetEnrolledCommitted, { errors: {} }, form({ athleteId: IDS.athleteEnrolled, schoolId: IDS.school, status: "Offer" })));
    expect(writes.some((w) => w.table === "athletes")).toBe(false);
  });

  it("the Edit dropdown cannot set Enrolled with no school anywhere", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athleteNoGpa, { errors: {}, values: {} }, form({ name: "Fixture Unknown", sport: "baseball", recruitType: "hs", status: "Enrolled" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.status).toMatch(/Mark Enrolled/);
    expect(writes).toEqual([]);
  });

  it("Mark Graduated names the school they were enrolled at, asks for one when nothing names it, and never repeats", async () => {
    // Dave's pick, 2026-09-26: Graduated means graduated from college.
    const { markGraduated } = await import("@/lib/actions/enrollment");
    const r = await run(() => markGraduated(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ graduatedOn: "2026-09-15" })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/notice=Graduated from Fixture State University\.$/);
    expect(writes.find((w) => w.table === "athletes" && w.op === "update")?.rows[0]).toMatchObject({ status: "Graduated", graduated_on: "2026-09-15" });

    // An athlete never marked Enrolled can be marked Graduated too (Dave,
    // 2026-09-27: an alumnus should not be left Inactive), but only
    // naming a school, and nothing is written until one is named.
    writes.length = 0;
    const noSchool = await run(() => markGraduated(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ graduatedOn: "2026-09-15" })));
    expect(noSchool.redirect).toBeNull();
    expect((noSchool.state as { errors: Record<string, string> }).errors.schoolId).toMatch(/school they graduated from/);
    expect(writes).toEqual([]);

    // Graduated twice is not a thing.
    writes.length = 0;
    const again = await run(() => markGraduated(ORG_WITH_MODULES, IDS.athleteGraduated, { errors: {} }, form({ graduatedOn: "2026-09-15" })));
    expect(again.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athleteGraduated}`);
    expect(writes).toEqual([]);
  });

  it("Mark Drafted records the team, round and year, and closes open targets", async () => {
    const { markDrafted } = await import("@/lib/actions/enrollment");
    const r = await run(() => markDrafted(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ draftTeam: "New York Yankees", draftRound: "5", draftYear: "2026" })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/notice=Drafted by New York Yankees, Round 5, 2026\. 1 other target closed\./);
    expect(writes.find((w) => w.table === "athletes" && w.op === "update")?.rows[0]).toMatchObject({ status: "Drafted", draft_team: "New York Yankees", draft_round: 5, draft_year: 2026 });
    const closed = writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === IDS.targetToClose));
    expect(String(closed?.rows[0]?.notes)).toMatch(/was drafted by New York Yankees \(round 5, 2026\)\./);
    // The college commitment is history, not an open target.
    expect(writes.some((w) => w.table === "recruiting_targets" && w.filters.some((f) => f.value === IDS.targetCommitted))).toBe(false);
  });

  it("Mark Drafted needs a team, and a sane round and year", async () => {
    const { markDrafted } = await import("@/lib/actions/enrollment");
    const r = await run(() => markDrafted(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ draftTeam: "", draftRound: "0", draftYear: "26" })));
    const errors = (r.state as MemberState).errors;
    expect(errors.draftTeam).toMatch(/team/);
    expect(errors.draftRound).toMatch(/1 to 99/);
    expect(errors.draftYear).toMatch(/four digit/);
    expect(writes).toEqual([]);
  });

  it("on an athlete already Drafted, Mark Drafted only corrects the details", async () => {
    const { markDrafted } = await import("@/lib/actions/enrollment");
    const r = await run(() => markDrafted(ORG_WITH_MODULES, IDS.athleteDrafted, { errors: {} }, form({ draftTeam: "Fixture Pros", draftRound: "4", draftYear: "2026" })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athleteDrafted}`);
    expect(writes.filter((w) => w.table === "athletes")).toHaveLength(1);
    expect(writes.find((w) => w.table === "athletes")?.rows[0]).toMatchObject({ draft_round: 4 });
    expect(writes.some((w) => w.table === "recruiting_targets")).toBe(false);
  });

  it("the Edit dropdown sends Drafted to the screen that takes the team", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athlete, { errors: {}, values: {} }, form({ name: "Fixture Athlete", sport: "baseball", recruitType: "hs", status: "Drafted" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.status).toMatch(/Mark Drafted/);
    expect(writes).toEqual([]);
  });

  it("refuses a missing or unparseable date", async () => {
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const r = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ enrolledOn: "" })));
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.enrolledOn).toMatch(/Pick the date/);
    expect(writes).toEqual([]);
  });

  it("is a quiet no-op on an athlete already Enrolled", async () => {
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const r = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ enrolledOn: "2026-09-01" })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athleteEnrolled}`);
    expect(writes).toEqual([]);
  });

  it("a member cannot mark an athlete Enrolled", async () => {
    currentUser = MEMBER_ID;
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    const r = await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {} }, form({ enrolledOn: "2026-09-01" })));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("never overwrites a first full-time enrollment that already started the NCAA clock", async () => {
    // A transfer athlete's clock started at their original school, years
    // before this org ever saw them. Enrolling here must not move it.
    data.recruiting_targets.push({ id: "tx-committed", org_id: data.orgs[0]!.id, athlete_id: IDS.athleteTransfer, school_id: IDS.schoolD3, status: "Committed", coach_name: null, offer_type: null, offer_scholarship_percent: null, updated_at: "2026-08-01" });
    const { markEnrolled } = await import("@/lib/actions/enrollment");
    await run(() => markEnrolled(ORG_WITH_MODULES, IDS.athleteTransfer, { errors: {} }, form({ enrolledOn: "2026-09-01" })));
    const athleteUpdate = writes.find((w) => w.table === "athletes" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === IDS.athleteTransfer));
    expect(athleteUpdate?.rows[0]).not.toHaveProperty("first_full_time_enrollment");
    expect(data.athletes.find((a) => a.id === IDS.athleteTransfer)?.first_full_time_enrollment).toBe("2024-08-26");
  });

  it("a plain Edit save that flips the dropdown to Enrolled is refused and points to Mark Enrolled", async () => {
    // Audit crud F8, 2026-09-27: a hand change to Enrolled used to stamp
    // today's date on the NCAA clock. It now goes through Mark Enrolled,
    // which asks for the date; Edit only corrects a date already set.
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() =>
      updateAthlete(ORG_WITH_MODULES, IDS.athleteCommitted, { errors: {}, values: {} }, form({ name: "Fixture Committed", sport: "baseball", recruitType: "hs", status: "Enrolled" })),
    );
    expect(r.redirect).toBeNull();
    expect((r.state as MemberState).errors.status).toMatch(/Mark Enrolled/);
    expect(writes).toEqual([]);
  });

  it("an ordinary save on an already-Enrolled athlete does not re-run the close-out", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() =>
      updateAthlete(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {}, values: {} }, form({ name: "Fixture Enrolled", sport: "baseball", recruitType: "hs", status: "Enrolled" })),
    );
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athleteEnrolled}`);
    expect(writes.find((w) => w.table === "recruiting_targets" && w.op === "update")).toBeUndefined();
  });
});

describe("LAW: reopening restores exactly what the close-out closed", () => {
  // Dave, 2026-09-26: a kid who committed and backed out, or enrolled
  // and is now in the portal, is being recruited again, and the schools
  // the close-out shut come back as they were. src/lib/data/reopen.ts
  // reads closed_from, the marker the close-out leaves; the commitment
  // itself becomes history for a transfer and an offer again for a
  // withdrawn commitment. Drafted is final. Proven to bite by dropping
  // the `.not("closed_from", "is", null)` filter in reopen.ts and
  // watching the hand-picked Not Interested come back: planted and
  // reverted.
  const targetUpdate = (id: string) => writes.find((w) => w.table === "recruiting_targets" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === id));
  const athleteUpdate = (id: string) => writes.find((w) => w.table === "athletes" && w.op === "update" && w.filters.some((f) => f.column === "id" && f.value === id));

  it("an Enrolled athlete leaves as a transfer: closed targets come back, the commitment closes, and they score again", async () => {
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    const r = await run(() =>
      reopenRecruiting(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ transferKind: "transfer_4to4", currentSchool: "Fixture State University", eligibilityYearsRemaining: "2", transferCount: "1" })),
    );
    expect(r.redirect).toContain(`/roster/${IDS.athleteEnrolled}?notice=`);
    expect(decodeURIComponent(r.redirect!)).toMatch(/Recruiting reopened\. 1 target restored\./);

    const athlete = athleteUpdate(IDS.athleteEnrolled)?.rows[0] as { status: string; recruit_type: string; detail: Record<string, unknown> };
    expect(athlete).toMatchObject({ status: "Transferring", recruit_type: "transfer_4to4" });
    expect(athlete.detail).toMatchObject({ kind: "transfer", currentSchool: "Fixture State University", currentDivision: "D2", eligibilityYearsRemaining: 2, transferCount: 1, degreeCompleted: false });
    expect(athlete).not.toHaveProperty("first_full_time_enrollment");

    const restored = targetUpdate(IDS.targetEnrolledClosed);
    expect(restored?.rows[0]).toMatchObject({ status: "In Contact", closed_from: null });
    expect(String(restored?.rows[0]?.notes)).toMatch(/Closed automatically[\s\S]*Reopened: Fixture Enrolled is recruiting again as of/);
    expect(restored?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "org_id", value: data.orgs[0]!.id })]));

    const committed = targetUpdate(IDS.targetEnrolledCommitted);
    expect(committed?.rows[0]).toMatchObject({ status: "Not Interested", closed_from: null });
    expect(String(committed?.rows[0]?.notes)).toMatch(/Reopened: Fixture Enrolled is transferring from Fixture State University as of/);

    const scored = writes.filter((w) => w.table === "athlete_school_fits" && w.op === "upsert").flatMap((w) => w.rows as { athlete_id: string }[]);
    expect(scored.some((row) => row.athlete_id === IDS.athleteEnrolled)).toBe(true);
    expect(revalidated).toEqual(expect.arrayContaining([`/org/${ORG_WITH_MODULES}`, `/org/${ORG_WITH_MODULES}/roster`, `/org/${ORG_WITH_MODULES}/board`]));
  });

  it("a Graduated athlete leaves as a grad transfer by default, with the degree marked complete", async () => {
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    const r = await run(() => reopenRecruiting(ORG_WITH_MODULES, IDS.athleteGraduated, { errors: {} }, form({ eligibilityYearsRemaining: "1" })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/Recruiting reopened\.$/);
    const athlete = athleteUpdate(IDS.athleteGraduated)?.rows[0] as { status: string; recruit_type: string; detail: Record<string, unknown> };
    expect(athlete).toMatchObject({ status: "Transferring", recruit_type: "transfer_grad" });
    // Nothing on the board named a school, so the Current School on the
    // record is the one they are leaving.
    expect(athlete.detail).toMatchObject({ kind: "transfer", currentSchool: "Fixture Tech", degreeCompleted: true, eligibilityYearsRemaining: 1 });
    expect(athlete).not.toHaveProperty("graduated_on");
  });

  it("a transfer needs the eligibility years, and a bad count or date is refused before anything is written", async () => {
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    const r = await run(() => reopenRecruiting(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ transferKind: "transfer_4to4", eligibilityYearsRemaining: "", transferCount: "-1", portalEntryDate: "soon" })));
    expect(r.redirect).toBeNull();
    const errors = (r.state as MemberState).errors;
    expect(errors.eligibilityYearsRemaining).toMatch(/0 to 5/);
    expect(errors.transferCount).toMatch(/whole number/);
    expect(errors.portalEntryDate).toMatch(/date/);
    expect(writes).toEqual([]);
  });

  it("a withdrawn commitment goes back to Active, the commitment back to the offer it was, and open targets are untouched", async () => {
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    // The profile's confirm posts a plain form: no state, no fields.
    const r = await run(() => reopenRecruiting(ORG_WITH_MODULES, IDS.athleteCommitted, form({})));
    expect(decodeURIComponent(r.redirect!)).toMatch(new RegExp(`/roster/${IDS.athleteCommitted}\\?notice=Recruiting reopened\\.$`));
    const athlete = athleteUpdate(IDS.athleteCommitted)?.rows[0] as Record<string, unknown>;
    expect(athlete).toMatchObject({ status: "Active" });
    expect(athlete).not.toHaveProperty("recruit_type");
    expect(athlete).not.toHaveProperty("detail");

    const committed = targetUpdate(IDS.targetCommitted);
    expect(committed?.rows[0]).toMatchObject({ status: "Offer", closed_from: null });
    expect(String(committed?.rows[0]?.notes)).toMatch(/Reopened: commitment withdrawn on/);
    expect(targetUpdate(IDS.targetToClose)).toBeUndefined();

    const scored = writes.filter((w) => w.table === "athlete_school_fits" && w.op === "upsert").flatMap((w) => w.rows as { athlete_id: string }[]);
    expect(scored.some((row) => row.athlete_id === IDS.athleteCommitted)).toBe(true);
  });

  it("a commitment with no offer behind it goes back to In Contact", async () => {
    data.recruiting_targets.find((t) => t.id === IDS.targetCommitted)!.offer_type = null;
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    await run(() => reopenRecruiting(ORG_WITH_MODULES, IDS.athleteCommitted, form({})));
    expect(targetUpdate(IDS.targetCommitted)?.rows[0]).toMatchObject({ status: "In Contact" });
  });

  it("a hand-picked Not Interested stays closed: only a target with closed_from comes back", async () => {
    data.recruiting_targets.push({ ...data.recruiting_targets.find((t) => t.id === IDS.targetEnrolledClosed)!, id: "t-hand", school_id: IDS.school, closed_from: null, notes: "Coach said no." });
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    const r = await run(() => reopenRecruiting(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {} }, form({ eligibilityYearsRemaining: "2" })));
    expect(decodeURIComponent(r.redirect!)).toMatch(/1 target restored/);
    expect(targetUpdate("t-hand")).toBeUndefined();
    expect(targetUpdate(IDS.targetEnrolledClosed)?.rows[0]).toMatchObject({ status: "In Contact" });
  });

  it("Drafted is final: reopen sends the person back to the profile and writes nothing", async () => {
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    const r = await run(() => reopenRecruiting(ORG_WITH_MODULES, IDS.athleteDrafted, form({})));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athleteDrafted}`);
    expect(writes).toEqual([]);
    const active = await run(() => reopenRecruiting(ORG_WITH_MODULES, IDS.athlete, form({})));
    expect(active.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}`);
    expect(writes).toEqual([]);
  });

  it("a member cannot reopen recruiting", async () => {
    currentUser = MEMBER_ID;
    const { reopenRecruiting } = await import("@/lib/actions/reopen");
    const r = await run(() => reopenRecruiting(ORG_WITH_MODULES, IDS.athleteCommitted, form({})));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("the Edit form refuses to bring a placed athlete back by hand", async () => {
    const { updateAthlete } = await import("@/lib/actions/athletes");
    for (const status of ["Active", "Transferring", "Inactive"]) {
      const r = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athleteEnrolled, { errors: {}, values: {} }, form({ name: "Fixture Enrolled", sport: "baseball", recruitType: "hs", status })));
      expect(r.redirect).toBeNull();
      expect((r.state as MemberState).errors.status).toMatch(/Reopen Recruiting/);
    }
    expect(writes).toEqual([]);
  });

  it("an athlete who arrives already in the portal can be created Transferring", async () => {
    const { createAthlete } = await import("@/lib/actions/athletes");
    const r = await run(() =>
      createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, form({ name: "Portal Arrival", sport: "baseball", recruitType: "transfer_4to4", status: "Transferring", currentSchool: "Elsewhere College", eligibilityYearsRemaining: "3", transferCount: "1" })),
    );
    expect(r.redirect).toMatch(new RegExp(`^/org/${ORG_WITH_MODULES}/roster/`));
    expect(inserts("athletes")[0]?.rows[0]).toMatchObject({ status: "Transferring", recruit_type: "transfer_4to4" });
  });
});

describe("LAW: Recalculate All says what it did", () => {
  // A failed rescore after a big import used to look exactly like a
  // finished one. 2026-09-26.
  it("reports how many matches it wrote", async () => {
    const { recalculateAllMatches } = await import("@/lib/actions/matching");
    const r = await run(() => recalculateAllMatches(ORG_WITH_MODULES));
    expect(decodeURIComponent(r.redirect!)).toMatch(/\/more\?notice=\d+ match(es)? recalculated\.$/);
    expect(writes.some((w) => w.table === "athlete_school_fits")).toBe(true);
  });
});

// Stage 3, 2026-09-26 (migration 0039). A message on an athlete's thread
// is the one thing a family login writes, and only as itself, on its own
// athlete. Check-ins are staff only. An advisor is an owner or staff
// member of the athlete's own org, and stops being one the moment they
// leave the org or become a member. The database holds each line too
// (policies and triggers, scripts/rls_test.sql); these prove the actions
// answer first, with a page rather than an error.
//
// Each was planted against and reverted before this was called done: the
// author taken from the form instead of the session, the family branch
// skipping requireFamilyAthlete, logCheckin opened to every role, the
// org filter dropped from removeCheckin, the advisor check in athletes.ts
// removed, and the advisor clearing removed from removeMember and from
// changeMemberRole. Each failed here.
describe("LAW: a family writes one thing, a message on its own athlete's thread, as itself", () => {
  const ORG = () => data.orgs[0]!.id;
  const msg = (body = "Hello from the test.") => form({ body });

  it("a family message on its own athlete is signed by the family login and marks the thread read for it", async () => {
    currentUser = FAMILY_ID;
    const { sendMessage } = await import("@/lib/actions/messages");
    const r = await run(() => sendMessage(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, msg()));
    expect(r.redirect).toBeNull();
    expect((r.state as { errors: Record<string, string> }).errors).toEqual({});
    const [w] = inserts("athlete_messages");
    expect(w?.rows[0]).toEqual({ org_id: ORG(), athlete_id: IDS.athlete, author_id: FAMILY_ID, body: "Hello from the test." });
    const read = writes.find((x) => x.table === "athlete_message_reads");
    expect(read?.op).toBe("upsert");
    expect(read?.rows[0]).toMatchObject({ org_id: ORG(), athlete_id: IDS.athlete, user_id: FAMILY_ID });
    // Nothing a family writes touches the staff-only log.
    expect(writes.filter((x) => x.table === "athlete_checkins")).toEqual([]);
    expect(revalidated).toContain(`/org/${ORG_WITH_MODULES}/family/${IDS.athlete}/messages`);
  });

  it("a family login cannot write on an athlete it is not linked to", async () => {
    currentUser = FAMILY_ID;
    const { sendMessage } = await import("@/lib/actions/messages");
    await expect(sendMessage(ORG_WITH_MODULES, IDS.athleteTransfer, { errors: {} }, msg())).rejects.toThrow(NOT_FOUND);
    expect(writes).toEqual([]);
  });

  it("a member cannot write on a thread", async () => {
    currentUser = MEMBER_ID;
    const { sendMessage } = await import("@/lib/actions/messages");
    const r = await run(() => sendMessage(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, msg()));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("staff write as themselves, and never on another org's athlete", async () => {
    const { sendMessage } = await import("@/lib/actions/messages");
    const ok = await run(() => sendMessage(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, msg()));
    expect(ok.redirect).toBeNull();
    expect(inserts("athlete_messages")[0]?.rows[0]).toMatchObject({ org_id: ORG(), author_id: OWNER_ID });
    writes.length = 0;
    // The fixture owner is Elite Squad's owner too; a Bridge athlete
    // under Elite's slug is refused before anything is written.
    const cross = await run(() => sendMessage(ORG_WITHOUT_MODULES, IDS.athlete, { errors: {} }, msg()));
    expect(cross.redirect).toBeNull();
    expect((cross.state as { errors: Record<string, string> }).errors.form).toMatch(/roster/);
    expect(writes).toEqual([]);
  });

  it("an empty message is refused and hands back nothing to send", async () => {
    currentUser = FAMILY_ID;
    const { sendMessage } = await import("@/lib/actions/messages");
    const r = await run(() => sendMessage(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, msg("   ")));
    expect((r.state as { errors: Record<string, string> }).errors.body).toBeTruthy();
    expect(writes).toEqual([]);
  });
});

describe("LAW: a check-in is staff's to write and remove, in its own org", () => {
  const ORG = () => data.orgs[0]!.id;

  for (const [who, as] of [["family", FAMILY_ID], ["member", MEMBER_ID]] as const) {
    it(`a ${who} login cannot log or remove a check-in`, async () => {
      currentUser = as;
      const { logCheckin, removeCheckin } = await import("@/lib/actions/checkins");
      expect((await run(() => logCheckin(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ kind: "call", notes: "x" })))).redirect).toBe("/unauthorized");
      expect((await run(() => removeCheckin(ORG_WITH_MODULES, IDS.athlete, "ck1"))).redirect).toBe("/unauthorized");
      expect(writes).toEqual([]);
    });
  }

  it("staff log a check-in stamped with the org and themselves as who checked in", async () => {
    const { logCheckin } = await import("@/lib/actions/checkins");
    const r = await run(() => logCheckin(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ kind: "meeting", occurredOn: "2026-09-25", notes: "Talked about visits." })));
    expect((r.state as { errors: Record<string, string> }).errors).toEqual({});
    expect(inserts("athlete_checkins")[0]?.rows[0]).toEqual({ org_id: ORG(), athlete_id: IDS.athlete, advisor_id: OWNER_ID, kind: "meeting", occurred_on: "2026-09-25", notes: "Talked about visits." });
    // The log is staff only, so no family screen goes stale.
    expect(revalidated.filter((x) => x.includes("/family/"))).toEqual([]);
  });

  it("a check-in on another org's athlete is refused, and a removal is scoped to the org and the athlete", async () => {
    const { logCheckin, removeCheckin } = await import("@/lib/actions/checkins");
    const cross = await run(() => logCheckin(ORG_WITHOUT_MODULES, IDS.athlete, { errors: {} }, form({ kind: "call" })));
    expect((cross.state as { errors: Record<string, string> }).errors.form).toMatch(/roster/);
    expect(writes).toEqual([]);
    await removeCheckin(ORG_WITH_MODULES, IDS.athlete, "ck1");
    const del = writes.find((w) => w.table === "athlete_checkins" && w.op === "delete");
    expect(del?.filters).toEqual(expect.arrayContaining([{ column: "id", value: "ck1" }, { column: "org_id", value: ORG() }, { column: "athlete_id", value: IDS.athlete }]));
  });
});

describe("LAW: an advisor is owner or staff of the athlete's org, and stops being one on leaving it", () => {
  const withKey = () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  };
  const athlete = (fields: Record<string, string> = {}) => form({ name: "Fixture Athlete", sport: "baseball", recruitType: "hs", status: "Active", ...fields });
  const advisorOf = (id: string) => data.athletes.find((a) => a.id === id)?.advisor_id ?? null;

  it("the owner can be picked; a member and another org's staff cannot", async () => {
    const { updateAthlete, createAthlete } = await import("@/lib/actions/athletes");
    const picked = await run(() => updateAthlete(ORG_WITH_MODULES, IDS.athleteTransfer, { errors: {}, values: {} }, athlete({ advisorId: OWNER_ID })));
    expect(picked.redirect).toContain(`/roster/${IDS.athleteTransfer}`);
    expect(advisorOf(IDS.athleteTransfer)).toBe(OWNER_ID);
    writes.length = 0;
    // MEMBER_ID is a Bridge member (Board); OUTSIDER_ID is Elite's staff.
    for (const advisorId of [MEMBER_ID, OUTSIDER_ID, FAMILY_ID]) {
      const r = await run(() => createAthlete(ORG_WITH_MODULES, { errors: {}, values: {} }, athlete({ name: "New Athlete", advisorId })));
      expect(r.redirect).toBeNull();
      expect((r.state as { errors: Record<string, string> }).errors.advisorId).toMatch(/staff/);
    }
    expect(writes).toEqual([]);
  });

  it("removing someone from the org clears them as advisor, in that org only", async () => {
    withKey();
    // A stale pointer: a member is not a legal advisor, which is exactly
    // what the removal must not leave behind.
    data.athletes.find((a) => a.id === IDS.athlete)!.advisor_id = MEMBER_ID;
    const { removeMember } = await import("@/lib/actions/members");
    expect((await removeMember(ORG_WITH_MODULES, MEMBER_ID)).ok).toBe(true);
    const cleared = writes.find((w) => w.table === "athletes" && w.op === "update");
    expect(cleared?.rows[0]).toEqual({ advisor_id: null });
    expect(cleared?.filters).toEqual(expect.arrayContaining([{ column: "org_id", value: data.orgs[0]!.id }, { column: "advisor_id", value: MEMBER_ID }]));
    expect(advisorOf(IDS.athlete)).toBeNull();
    // The owner's own athlete keeps its advisor.
    expect(advisorOf(IDS.athleteNoGpa)).toBe(OWNER_ID);
  });

  it("a staff advisor made a member stops advising; made an owner, keeps it", async () => {
    withKey();
    // Elite Squad: the fixture owner owns it and OUTSIDER_ID is its staff.
    data.athletes.find((a) => a.id === IDS.athleteElite)!.advisor_id = OUTSIDER_ID;
    const { changeMemberRole } = await import("@/lib/actions/members");
    expect((await changeMemberRole(ORG_WITHOUT_MODULES, OUTSIDER_ID, "owner")).ok).toBe(true);
    expect(advisorOf(IDS.athleteElite)).toBe(OUTSIDER_ID);
    expect(writes.filter((w) => w.table === "athletes")).toEqual([]);
    expect((await changeMemberRole(ORG_WITHOUT_MODULES, OUTSIDER_ID, "member")).ok).toBe(true);
    const cleared = writes.find((w) => w.table === "athletes" && w.op === "update");
    expect(cleared?.filters).toEqual(expect.arrayContaining([{ column: "org_id", value: data.orgs[1]!.id }, { column: "advisor_id", value: OUTSIDER_ID }]));
    expect(advisorOf(IDS.athleteElite)).toBeNull();
  });
});
