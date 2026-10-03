// Seven more server actions that nothing had executed: the two board
// actions, document delete-and-leave and the key check, the approved
// list paste preview, resending an invitation, reviewing an assignment
// with a comment, and saving a grading scale.
//
// Held to the same four things as src/laws/actionRun.test.ts: the row is
// written under the caller's org, the wrong caller is refused before a
// write, a row from another org is neither read nor changed, and the
// error branch is reachable. Nothing here calls a model: documents are
// only deleted, never read, and the one test that touches
// ANTHROPIC_API_KEY sets and restores the variable without a call.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID, OUTSIDER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { errorsOf, filterColumns, form, orgIdBySlug, run, writesTo } from "@/testing/actionHarness";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let failOn: (table: string, op: string) => string | null = () => null;
let revalidated: string[] = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => void revalidated.push(p) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  serviceRoleConfigured: () => true,
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn }),
}));
// The real model caller is never reached by these tests; the stub stands
// in so importing the documents module cannot make a network call.
vi.mock("@/lib/ai/anthropicCaller", async () => {
  const { createStubCaller } = await import("@/lib/docai/stubCaller");
  return { createAnthropicCaller: () => createStubCaller({ category: "transcript", seedText: "other-actions" }) };
});

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  failOn = () => null;
  revalidated = [];
});

const S = ORG_WITH_MODULES;
const BRIDGE = () => orgIdBySlug(data, ORG_WITH_MODULES);
const ELITE = () => orgIdBySlug(data, ORG_WITHOUT_MODULES);
const NO_STATE = { errors: {} };
const GONE = "00000000-0000-0000-0000-00000000dead";

// Every caller that must be turned away from a staff action.
const WRONG_CALLERS = [["a Viewer", MEMBER_ID], ["an Athlete login", FAMILY_ID], ["nobody signed in", null]] as const;

// ── boards ──────────────────────────────────────────────────────────────

const boardForm = (over: Record<string, string> = {}) => form({ name: "  Alumni Board ", kind: "general", giveGet: "7,500", minSeats: "2", maxSeats: "12", description: " Past families ", ...over });

describe("createBoard", () => {
  it("writes the board under the caller's org and lands on it", async () => {
    const { createBoard } = await import("@/lib/actions/governance");
    const r = await run(() => createBoard(S, NO_STATE, boardForm()));
    const [w] = writesTo(writes, "boards", "insert");
    expect(w!.rows[0]).toEqual({ org_id: BRIDGE(), name: "Alumni Board", kind: "general", sport: null, give_get_amount: "7500.00", min_seats: 2, max_seats: 12, description: "Past families" });
    const created = data.boards!.find((b) => b.name === "Alumni Board")!;
    expect(r.redirect).toBe(`/org/${S}/board-governance/${created.id}`);
    expect(revalidated).toContain(`/org/${S}/board-governance`);
  });

  it("a blank give/get and blank seat counts take the tier's defaults", async () => {
    const { createBoard } = await import("@/lib/actions/governance");
    await run(() => createBoard(S, NO_STATE, boardForm({ kind: "sport", sport: "Baseball", giveGet: "", minSeats: "", maxSeats: "" })));
    expect(writesTo(writes, "boards", "insert")[0]!.rows[0]).toMatchObject({ kind: "sport", sport: "Baseball", give_get_amount: "5000.00", min_seats: 3, max_seats: 5 });
  });

  it("a sport is only kept on a sport board", async () => {
    const { createBoard } = await import("@/lib/actions/governance");
    await run(() => createBoard(S, NO_STATE, boardForm({ kind: "executive", sport: "Baseball" })));
    expect(writesTo(writes, "boards", "insert")[0]!.rows[0]!.sport).toBeNull();
  });

  const REFUSED: Array<[string, Record<string, string>, string, RegExp]> = [
    ["a missing name", { name: "" }, "name", /needs a name/i],
    ["an unknown tier", { kind: "royal" }, "kind", /pick a tier/i],
    ["a negative give/get", { giveGet: "-1" }, "giveGet", /negative/i],
    ["a fractional minimum", { minSeats: "1.5" }, "minSeats", /whole number/i],
    ["a maximum below the minimum", { minSeats: "5", maxSeats: "3" }, "maxSeats", /cannot be below the minimum/i],
    ["a sport board with no sport", { kind: "sport", sport: "" }, "sport", /which sport/i],
  ];
  for (const [label, over, field, message] of REFUSED) {
    it(`refuses ${label} with a field error and writes nothing`, async () => {
      const { createBoard } = await import("@/lib/actions/governance");
      const r = await run(() => createBoard(S, NO_STATE, boardForm(over)));
      expect(r.redirect).toBeNull();
      expect(errorsOf(r.state)[field]).toMatch(message);
      expect(writes).toEqual([]);
    });
  }

  it("a database error comes back as a form error and does not redirect", async () => {
    failOn = (t, op) => (t === "boards" && op === "insert" ? "boom" : null);
    const { createBoard } = await import("@/lib/actions/governance");
    const r = await run(() => createBoard(S, NO_STATE, boardForm()));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toBe("boom");
  });

  // KNOWN GAP, found while writing these tests: the form reads "0" as
  // "not filled in" (Number("0") || default), so a board can never be
  // given a minimum of zero seats, although the validation message says
  // "zero or more". `it.fails` passes while the behaviour is wrong and
  // fails the day it is fixed, which is the cue to turn it into a plain it.
  it.fails("a minimum of zero seats is accepted, as the error message promises", async () => {
    const { createBoard } = await import("@/lib/actions/governance");
    await run(() => createBoard(S, NO_STATE, boardForm({ minSeats: "0", maxSeats: "5" })));
    expect(writesTo(writes, "boards", "insert")[0]!.rows[0]!.min_seats).toBe(0);
  });
});

describe("updateBoard", () => {
  it("updates only this org's board, by id and org, and says it saved", async () => {
    const { updateBoard } = await import("@/lib/actions/governance");
    const r = await run(() => updateBoard(S, IDS.board, NO_STATE, boardForm({ name: "Renamed Board" })));
    const [w] = writesTo(writes, "boards", "update");
    expect(filterColumns(w)).toEqual(["id", "org_id"]);
    expect(w!.filters.find((f) => f.column === "org_id")!.value).toBe(BRIDGE());
    expect(data.boards!.find((b) => b.id === IDS.board)!.name).toBe("Renamed Board");
    expect(r.redirect).toBe(`/org/${S}/board-governance/${IDS.board}?notice=${encodeURIComponent("Board saved.")}`);
    expect(revalidated).toEqual(expect.arrayContaining([`/org/${S}/board-governance`, `/org/${S}/board-governance/${IDS.board}`]));
  });

  it("does not edit another org's board", async () => {
    const foreign = "00000000-0000-0000-0000-0000000008b1";
    data.boards!.push({ id: foreign, org_id: ELITE(), name: "Squad Board", kind: "general", sport: null, give_get_amount: 1, min_seats: 1, max_seats: 2, description: null, sort_order: 0 });
    const { updateBoard } = await import("@/lib/actions/governance");
    const r = await run(() => updateBoard(S, foreign, NO_STATE, boardForm({ name: "Hijacked" })));
    expect(errorsOf(r.state).form).toMatch(/not in this organization/i);
    expect(data.boards!.find((b) => b.id === foreign)!.name).toBe("Squad Board");
  });

  it("validates before writing", async () => {
    const { updateBoard } = await import("@/lib/actions/governance");
    const r = await run(() => updateBoard(S, IDS.board, NO_STATE, boardForm({ kind: "royal" })));
    expect(errorsOf(r.state).kind).toMatch(/pick a tier/i);
    expect(writes).toEqual([]);
  });

  it("a database error comes back as a form error", async () => {
    failOn = (t, op) => (t === "boards" && op === "update" ? "locked" : null);
    const { updateBoard } = await import("@/lib/actions/governance");
    const r = await run(() => updateBoard(S, IDS.board, NO_STATE, boardForm()));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toBe("locked");
  });
});

describe("the board actions refuse the wrong caller and the wrong org before writing", () => {
  const calls = async (slug: string) => {
    const g = await import("@/lib/actions/governance");
    return { createBoard: () => g.createBoard(slug, NO_STATE, boardForm()), updateBoard: () => g.updateBoard(slug, IDS.board, NO_STATE, boardForm()) };
  };
  for (const name of ["createBoard", "updateBoard"] as const) {
    for (const [who, id] of WRONG_CALLERS) {
      it(`${name} refuses ${who}`, async () => {
        currentUser = id;
        await expect((await calls(S))[name]()).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
        expect(writes).toEqual([]);
      });
    }
    it(`${name} refuses an org without the governance module`, async () => {
      await expect((await calls(ORG_WITHOUT_MODULES))[name]()).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      expect(writes).toEqual([]);
    });
  }
});

// ── documents: delete and leave, and the key check ─────────────────────

describe("deleteDocumentAndLeave", () => {
  const OWN_PATH = () => `${BRIDGE()}/req_delete_me/scan.pdf`;
  const addDoc = (over: Record<string, unknown>) => {
    const row = { id: "00000000-0000-0000-0000-0000000007d1", org_id: BRIDGE(), athlete_id: null, file_name: "scan.pdf", status: "discarded", storage_paths: [OWN_PATH()], ...over };
    data.documents!.push(row);
    return row.id as string;
  };

  it("deletes a discarded document and its own file, then leaves for the list", async () => {
    const id = addDoc({});
    const { deleteDocumentAndLeave } = await import("@/lib/actions/documents");
    const r = await run(() => deleteDocumentAndLeave(S, id));
    expect(r.redirect).toBe(`/org/${S}/documents`);
    const [file] = writesTo(writes, "storage:documents", "delete");
    expect(file!.rows).toEqual([{ name: OWN_PATH() }]);
    const [row] = writesTo(writes, "documents", "delete");
    expect(filterColumns(row)).toEqual(["id", "org_id", "status"]);
    expect(data.documents!.some((d) => d.id === id)).toBe(false);
    expect(revalidated).toContain(`/org/${S}/documents`);
  });

  it("also deletes a failed document", async () => {
    const { deleteDocumentAndLeave } = await import("@/lib/actions/documents");
    const r = await run(() => deleteDocumentAndLeave(S, "doc-failed"));
    expect(r.redirect).toBe(`/org/${S}/documents`);
    expect(data.documents!.some((d) => d.id === "doc-failed")).toBe(false);
  });

  it("only removes files inside the org's own folder, never another org's or a malformed path", async () => {
    const id = addDoc({ storage_paths: [OWN_PATH(), `${ELITE()}/req_x/theirs.pdf`, "../escape.pdf", `${BRIDGE()}/a/b/c.pdf`] });
    const { deleteDocumentAndLeave } = await import("@/lib/actions/documents");
    await run(() => deleteDocumentAndLeave(S, id));
    expect(writesTo(writes, "storage:documents", "delete")[0]!.rows).toEqual([{ name: OWN_PATH() }]);
  });

  it("refuses to delete a document that is still live: nothing is written and nobody is sent away", async () => {
    const id = addDoc({ status: "pending" });
    const { deleteDocumentAndLeave } = await import("@/lib/actions/documents");
    const r = await run(() => deleteDocumentAndLeave(S, id));
    expect(r.redirect).toBeNull();
    expect(writesTo(writes, "documents")).toEqual([]);
    expect(writesTo(writes, "storage:documents")).toEqual([]);
    expect(data.documents!.some((d) => d.id === id)).toBe(true);
  });

  it("a document in another org is not found and not touched", async () => {
    const id = addDoc({ org_id: ELITE() });
    const { deleteDocumentAndLeave } = await import("@/lib/actions/documents");
    const r = await run(() => deleteDocumentAndLeave(S, id));
    expect(r.redirect).toBeNull();
    expect(writes).toEqual([]);
    expect(data.documents!.some((d) => d.id === id)).toBe(true);
  });

  it("a document that does not exist writes nothing", async () => {
    const { deleteDocumentAndLeave } = await import("@/lib/actions/documents");
    const r = await run(() => deleteDocumentAndLeave(S, GONE));
    expect(r.redirect).toBeNull();
    expect(writes).toEqual([]);
  });

  it("a failed row delete does not send the person away as if it worked", async () => {
    const id = addDoc({});
    failOn = (t, op) => (t === "documents" && op === "delete" ? "fk" : null);
    const { deleteDocumentAndLeave } = await import("@/lib/actions/documents");
    const r = await run(() => deleteDocumentAndLeave(S, id));
    expect(r.redirect).toBeNull();
    expect(data.documents!.some((d) => d.id === id)).toBe(true);
  });

  for (const [who, id] of WRONG_CALLERS) {
    it(`refuses ${who} before touching anything`, async () => {
      currentUser = id;
      const doc = addDoc({});
      const { deleteDocumentAndLeave } = await import("@/lib/actions/documents");
      await expect(deleteDocumentAndLeave(S, doc)).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      expect(writes).toEqual([]);
    });
  }
});

describe("isStubbedModel", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("is true while no AI key is set, so every screen says the reading is simulated", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { isStubbedModel } = await import("@/lib/actions/documents");
    expect(await isStubbedModel()).toBe(true);
  });

  it("is true for an empty key, which is how an unset secret often arrives", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    const { isStubbedModel } = await import("@/lib/actions/documents");
    expect(await isStubbedModel()).toBe(true);
  });

  it("is false once a key is set; the key is only checked, never used", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only-not-a-real-key";
    const { isStubbedModel } = await import("@/lib/actions/documents");
    expect(await isStubbedModel()).toBe(false);
    expect(writes).toEqual([]);
  });
});

// ── the approved list paste preview ─────────────────────────────────────

describe("previewApprovedListPaste", () => {
  it("parses a pasted list into rows, with the subject and credit read off each line", async () => {
    const { previewApprovedListPaste } = await import("@/lib/actions/approvedCourses");
    const r = await previewApprovedListPaste("Course Title\tSubject\tCredit\nAlgebra I\tMathematics\t1\nWorld History\tHistory\t1\n");
    expect(r.rows.map((x) => x.title)).toEqual(["Algebra I", "World History"]);
    expect(r.rows[0]).toMatchObject({ subject: "math", maxCredit: 1 });
    expect(r.ignored.length).toBeGreaterThanOrEqual(1);
  });

  it("flags a repeated title and a row with no subject, so the list cannot be saved as it stands", async () => {
    const { previewApprovedListPaste } = await import("@/lib/actions/approvedCourses");
    const r = await previewApprovedListPaste("Algebra I\tMathematics\nAlgebra I\tMathematics\nBasket Weaving\n");
    expect(r.duplicates).toBe(1);
    expect(r.rows[1]!.problem).toMatch(/already on the list/i);
    expect(r.rows[2]!.problem).toMatch(/no ncaa subject/i);
  });

  it("an empty or missing paste is no rows, not an error", async () => {
    const { previewApprovedListPaste } = await import("@/lib/actions/approvedCourses");
    expect((await previewApprovedListPaste("")).rows).toEqual([]);
    expect((await previewApprovedListPaste(undefined as unknown as string)).rows).toEqual([]);
  });

  it("is a pure parse: no write, no read, no sign-in needed", async () => {
    currentUser = null;
    const { previewApprovedListPaste } = await import("@/lib/actions/approvedCourses");
    await previewApprovedListPaste("Geometry\tMathematics\n");
    expect(writes).toEqual([]);
  });
});

// ── resending an invitation ─────────────────────────────────────────────

describe("resendInviteForm", () => {
  it("sends a new sign-in link to an existing account, without creating one, and says so", async () => {
    const { resendInviteForm } = await import("@/lib/actions/members");
    const r = await run(() => resendInviteForm(S, MEMBER_ID));
    const [otp] = writesTo(writes, "auth:otp");
    expect(otp!.rows[0]).toMatchObject({ email: "member@example.test", shouldCreateUser: false });
    expect(String(otp!.rows[0]!.emailRedirectTo)).toMatch(/\/auth\/callback$/);
    expect(r.redirect).toBe(`/org/${S}/members?notice=${encodeURIComponent("A new sign-in link is on its way.")}`);
  });

  it("uses the configured site address for the link when one is set", async () => {
    const had = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test/";
    try {
      const { resendInviteForm } = await import("@/lib/actions/members");
      await run(() => resendInviteForm(S, MEMBER_ID));
      expect(writesTo(writes, "auth:otp")[0]!.rows[0]!.emailRedirectTo).toBe("https://app.example.test/auth/callback");
    } finally {
      if (had === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = had;
    }
  });

  it("a person with no address on file is reported and nothing is sent", async () => {
    const { resendInviteForm } = await import("@/lib/actions/members");
    const r = await run(() => resendInviteForm(S, GONE));
    expect(r.redirect).toBe(`/org/${S}/members?error=${encodeURIComponent("That person is not in this organization.")}`);
    expect(writesTo(writes, "auth:otp")).toEqual([]);
  });

  for (const [who, id] of [...WRONG_CALLERS, ["the other org's owner", OUTSIDER_ID]] as const) {
    it(`is owner only: refuses ${who} and sends nothing`, async () => {
      currentUser = id;
      const { resendInviteForm } = await import("@/lib/actions/members");
      await expect(resendInviteForm(S, MEMBER_ID)).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      expect(writesTo(writes, "auth:otp")).toEqual([]);
    });
  }

  it("an organization that does not exist is reported, not sent to", async () => {
    const { resendInviteForm } = await import("@/lib/actions/members");
    const r = await run(() => resendInviteForm("no-such-org", MEMBER_ID));
    expect(r.redirect).toContain("error=Organization%20not%20found.");
    expect(writesTo(writes, "auth:otp")).toEqual([]);
  });
});

// ── reviewing an assignment, with the comment off a form ────────────────

describe("reviewAssignmentForm", () => {
  const review = async (decision: string, comment: string | null, id: string = IDS.assignmentSubmitted, athlete: string = IDS.athlete) => {
    const { reviewAssignmentForm } = await import("@/lib/actions/assignments");
    return reviewAssignmentForm(S, athlete, id, decision, NO_STATE, comment === null ? new FormData() : form({ comment }));
  };

  it("Needs Revision keeps the comment, marks who reviewed it, and logs it without the comment's words", async () => {
    const state = (await review("needs_revision", "  Please send the signed page too  ")) as { errors: Record<string, string> };
    expect(state.errors).toEqual({});
    const row = data.assignments!.find((a) => a.id === IDS.assignmentSubmitted)!;
    expect(row).toMatchObject({ status: "needs_revision", reviewer_comment: "Please send the signed page too", reviewed_by: OWNER_ID });
    expect(row.reviewed_at).toBeTruthy();
    const [w] = writesTo(writes, "assignments", "update");
    expect(filterColumns(w)).toEqual(["athlete_id", "id", "org_id", "status"]);
    const [log] = writesTo(writes, "activity_log", "insert");
    expect(log!.rows[0]).toMatchObject({ org_id: BRIDGE(), actor_id: OWNER_ID, athlete_id: IDS.athlete, action: "assignment_reviewed" });
    expect(JSON.stringify(log!.rows[0])).not.toMatch(/signed page/);
  });

  it("Needs Revision without a comment is refused, and the person's typing comes back", async () => {
    const state = (await review("needs_revision", "   ")) as { errors: Record<string, string>; comment?: string };
    expect(state.errors.comment).toMatch(/say what needs to change/i);
    expect(writes).toEqual([]);
    expect(data.assignments!.find((a) => a.id === IDS.assignmentSubmitted)!.status).toBe("submitted");
  });

  it("Complete needs no comment, and an empty one is not written over what is there", async () => {
    const state = (await review("complete", "")) as { errors: Record<string, string> };
    expect(state.errors).toEqual({});
    const row = data.assignments!.find((a) => a.id === IDS.assignmentSubmitted)!;
    expect(row.status).toBe("complete");
    expect(row.reviewer_comment).toBeNull();
  });

  it("a decision that is not one of the two is refused", async () => {
    const state = (await review("approve", "fine")) as { errors: Record<string, string> };
    expect(state.errors.form).toMatch(/choose complete or needs revision/i);
    expect(writes).toEqual([]);
  });

  it("a comment over the limit is refused", async () => {
    const state = (await review("complete", "x".repeat(4001))) as { errors: Record<string, string> };
    expect(state.errors.comment).toMatch(/under 4,000/i);
    expect(writes).toEqual([]);
  });

  it("only a submitted assignment is reviewed: assigned, complete and cancelled are refused untouched", async () => {
    for (const id of [IDS.assignmentOverdue, IDS.assignmentComplete, IDS.assignmentCancelled]) {
      const state = (await review("complete", null, id)) as { errors: Record<string, string> };
      expect(state.errors.form).toMatch(/only a submitted assignment/i);
    }
    expect(writes).toEqual([]);
  });

  it("an assignment on another athlete, or another org's athlete, is not found", async () => {
    const a = (await review("complete", null, IDS.assignmentSubmitted, IDS.athleteTransfer)) as { errors: Record<string, string> };
    expect(a.errors.form).toMatch(/not on this athlete's list/i);
    const b = (await review("complete", null, IDS.assignmentElite, IDS.athleteElite)) as { errors: Record<string, string> };
    expect(b.errors.form).toMatch(/isn't on this org's roster/i);
    expect(writes).toEqual([]);
  });

  it("two Admins reviewing at once cannot both win: the second finds it already reviewed", async () => {
    // The row moves on between the read and the write, which the update's
    // own status filter is there to catch.
    const { reviewAssignmentForm } = await import("@/lib/actions/assignments");
    failOn = () => null;
    const first = (await reviewAssignmentForm(S, IDS.athlete, IDS.assignmentSubmitted, "complete", NO_STATE, new FormData())) as { errors: Record<string, string> };
    expect(first.errors).toEqual({});
    const second = (await reviewAssignmentForm(S, IDS.athlete, IDS.assignmentSubmitted, "needs_revision", NO_STATE, form({ comment: "late" }))) as { errors: Record<string, string> };
    expect(second.errors.form).toMatch(/only a submitted assignment/i);
    expect(data.assignments!.find((a) => a.id === IDS.assignmentSubmitted)!.status).toBe("complete");
  });

  it("a database error comes back as a form error with the comment kept", async () => {
    failOn = (t, op) => (t === "assignments" && op === "update" ? "locked" : null);
    const state = (await review("needs_revision", "Try again")) as { errors: Record<string, string>; comment?: string };
    expect(state.errors.form).toBe("locked");
    expect(state.comment).toBe("Try again");
    expect(writesTo(writes, "activity_log")).toEqual([]);
  });

  for (const [who, id] of WRONG_CALLERS) {
    it(`refuses ${who} before reading or writing`, async () => {
      currentUser = id;
      await expect(review("complete", null)).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      expect(writes).toEqual([]);
    });
  }
});

// ── saving a grading scale ──────────────────────────────────────────────

describe("saveGradingScale", () => {
  const scaleForm = (over: Record<string, string> = {}) =>
    form({ schoolName: "  Fixture High School ", sourceNote: "School profile 2026", weightBonus: "1", min_A: "90", max_A: "100", min_B: "80", max_B: "89", min_C: "70", max_C: "79", min_D: "60", max_D: "69", ...over });

  it("a new scale is upserted under the caller's org on the table's own key, and says who entered it", async () => {
    const { saveGradingScale } = await import("@/lib/actions/gradingScales");
    const r = await run(() => saveGradingScale(S, null, NO_STATE, scaleForm()));
    const [w] = writesTo(writes, "org_grading_scales", "upsert");
    expect(w!.onConflict).toBe("org_id,school_name_key");
    expect(w!.rows[0]).toMatchObject({ org_id: BRIDGE(), school_name: "Fixture High School", entered_by: OWNER_ID, reports_weighted_grades: false, weight_bonus: 1 });
    expect((w!.rows[0]!.bands as unknown[]).length).toBe(4);
    expect(r.redirect).toBe(`/org/${S}/grading-scales`);
    expect(revalidated).toContain(`/org/${S}/grading-scales`);
  });

  it("an edit updates by id and org, not an upsert", async () => {
    data.org_grading_scales ??= [];
    data.org_grading_scales.push({ id: "gs-edit", org_id: BRIDGE(), school_name: "Fixture High School", bands: [] });
    const { saveGradingScale } = await import("@/lib/actions/gradingScales");
    const r = await run(() => saveGradingScale(S, "gs-edit", NO_STATE, scaleForm({ reportsWeightedGrades: "on" })));
    expect(writesTo(writes, "org_grading_scales", "upsert")).toEqual([]);
    const [w] = writesTo(writes, "org_grading_scales", "update");
    expect(filterColumns(w)).toEqual(["id", "org_id"]);
    expect(w!.rows[0]).toMatchObject({ reports_weighted_grades: true });
    expect(r.redirect).toBe(`/org/${S}/grading-scales`);
  });

  it("an edit aimed at another org's scale is scoped out by the org filter", async () => {
    data.org_grading_scales ??= [];
    data.org_grading_scales.push({ id: "gs-foreign", org_id: ELITE(), school_name: "Squad High", bands: [] });
    const { saveGradingScale } = await import("@/lib/actions/gradingScales");
    await run(() => saveGradingScale(S, "gs-foreign", NO_STATE, scaleForm({ schoolName: "Hijacked" })));
    expect(data.org_grading_scales.find((g) => g.id === "gs-foreign")!.school_name).toBe("Squad High");
  });

  it("goes back only to a path inside this org; an outside address is ignored", async () => {
    const { saveGradingScale } = await import("@/lib/actions/gradingScales");
    const ok = await run(() => saveGradingScale(S, null, NO_STATE, scaleForm({ returnTo: `/org/${S}/roster/${IDS.athlete}` })));
    expect(ok.redirect).toBe(`/org/${S}/roster/${IDS.athlete}`);
    for (const evil of ["https://evil.example/phish", "//evil.example", "/org/other-org/roster", "javascript:alert(1)"]) {
      const r = await run(() => saveGradingScale(S, null, NO_STATE, scaleForm({ returnTo: evil })));
      expect(r.redirect).toBe(`/org/${S}/grading-scales`);
    }
  });

  const REFUSED: Array<[string, Record<string, string>, string, RegExp]> = [
    ["a missing school name", { schoolName: "" }, "schoolName", /./],
    ["a band with only a low number", { max_B: "" }, "band_B", /needs both a low and a high/i],
    ["overlapping bands", { min_B: "85", max_B: "95" }, "bands", /cannot be right/i],
    ["no bands at all", { min_A: "", max_A: "", min_B: "", max_B: "", min_C: "", max_C: "", min_D: "", max_D: "" }, "bands", /at least the a, b and c/i],
  ];
  for (const [label, over, field, message] of REFUSED) {
    it(`refuses ${label} with a field error and writes nothing`, async () => {
      const { saveGradingScale } = await import("@/lib/actions/gradingScales");
      const r = await run(() => saveGradingScale(S, null, NO_STATE, scaleForm(over)));
      expect(r.redirect).toBeNull();
      expect(errorsOf(r.state)[field]).toMatch(message);
      expect(writes).toEqual([]);
    });
  }

  it("a database error comes back as a form error on both the create and the edit path", async () => {
    const { saveGradingScale } = await import("@/lib/actions/gradingScales");
    failOn = (t, op) => (t === "org_grading_scales" && op === "upsert" ? "dup" : null);
    const a = await run(() => saveGradingScale(S, null, NO_STATE, scaleForm()));
    expect(errorsOf(a.state).form).toBe("dup");
    failOn = (t, op) => (t === "org_grading_scales" && op === "update" ? "locked" : null);
    data.org_grading_scales ??= [];
    data.org_grading_scales.push({ id: "gs-err", org_id: BRIDGE(), school_name: "X", bands: [] });
    const b = await run(() => saveGradingScale(S, "gs-err", NO_STATE, scaleForm()));
    expect(errorsOf(b.state).form).toBe("locked");
  });

  for (const [who, id] of WRONG_CALLERS) {
    it(`refuses ${who} before writing`, async () => {
      currentUser = id;
      const { saveGradingScale } = await import("@/lib/actions/gradingScales");
      await expect(saveGradingScale(S, null, NO_STATE, scaleForm())).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      expect(writes).toEqual([]);
    });
  }
});
