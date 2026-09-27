// Temporary probe (WIRE B): one activity_log row per wired action on
// success, none on refusal, no body in any summary. Deleted after the run.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, FAMILY_ID, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const REDIRECT = "NEXT_REDIRECT:";
let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let failOn: (table: string, op: string) => string | null = () => null;

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(REDIRECT + url); },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn }) }));
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

beforeEach(() => { currentUser = OWNER_ID; writes = []; data = buildFixture(); failOn = () => null; delete process.env.ANTHROPIC_API_KEY; });

function form(v: Record<string, string>) { const fd = new FormData(); for (const [k, x] of Object.entries(v)) fd.append(k, x); return fd; }
async function quietly(fn: () => Promise<unknown>) { try { return await fn(); } catch (e) { const m = (e as Error).message; if (!m.startsWith(REDIRECT) && m !== "NEXT_NOT_FOUND") throw e; return m; } }
const logs = () => writes.filter((w) => w.table === "activity_log");
const summaries = () => logs().map((w) => `${w.rows[0]?.action}: ${w.rows[0]?.summary} [athlete=${w.rows[0]?.athlete_id ? "set" : "null"} actor=${w.rows[0]?.actor_id}]`);
const bridge = () => String(data.orgs[0].id);

describe("WIRE B probe", () => {
  it("createTarget logs once on success, never on refusal", async () => {
    const { createTarget } = await import("@/lib/actions/targets");
    await quietly(() => createTarget(ORG_WITH_MODULES, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.schoolD3, status: "Target" })));
    console.log(summaries());
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rows[0].summary).toBe("Added Fixture College as a target for Fixture Athlete");
    writes.length = 0;
    data.athletes.push({ ...data.athletes[0], id: "00000000-0000-0000-0000-0000000009f1", org_id: data.orgs[1].id });
    await quietly(() => createTarget(ORG_WITH_MODULES, { errors: {} }, form({ athleteId: "00000000-0000-0000-0000-0000000009f1", schoolId: IDS.school, status: "Target" })));
    expect(logs()).toHaveLength(0);
    // the log write failing never fails the action
    writes.length = 0;
    failOn = (t, op) => (t === "activity_log" && op === "insert" ? "boom" : null);
    const r = await quietly(() => createTarget(ORG_WITH_MODULES, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.schoolD3, status: "Target" })));
    expect(String(r)).toContain("/board");
    expect(writes.filter((w) => w.table === "recruiting_targets")).toHaveLength(1);
  });

  it("updateTarget logs a status change only", async () => {
    const { updateTarget } = await import("@/lib/actions/targets");
    await quietly(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status: "Visit" })));
    console.log(summaries());
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rows[0].summary).toMatch(/^Moved Fixture Athlete at Fixture State University from \w+ to Visit$/);
    writes.length = 0;
    data = buildFixture();
    const status = String(data.recruiting_targets.find((t) => t.id === IDS.target)!.status);
    await quietly(() => updateTarget(ORG_WITH_MODULES, IDS.target, { errors: {} }, form({ athleteId: IDS.athlete, schoolId: IDS.school, status, coachName: "Someone Else" })));
    expect(writes.filter((w) => w.table === "recruiting_targets" && w.op === "update")).toHaveLength(1);
    expect(logs()).toHaveLength(0);
  });

  it("deleteTarget logs target_removed with both names", async () => {
    const { deleteTarget } = await import("@/lib/actions/targets");
    await quietly(() => deleteTarget(ORG_WITH_MODULES, IDS.target));
    console.log(summaries());
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rows[0].summary).toBe("Removed Fixture State University as a target for Fixture Athlete");
  });

  it("addMatchToBoard logs once", async () => {
    const { addMatchToBoard } = await import("@/lib/actions/matching");
    await quietly(() => addMatchToBoard(ORG_WITH_MODULES, IDS.athleteNoGpa, IDS.school));
    console.log(summaries());
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rows[0].action).toBe("target_added");
  });

  it("logCheckin logs kind and date, never the note; refusal logs nothing", async () => {
    const { logCheckin } = await import("@/lib/actions/checkins");
    const r = await logCheckin(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ kind: "call", occurredOn: "2026-09-21", notes: "Fixture check-in note." }));
    expect(r.errors).toEqual({});
    console.log(summaries());
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rows[0].summary).toBe("Logged a call check-in for Fixture Athlete on Sep 21, 2026");
    expect(JSON.stringify(logs()[0].rows)).not.toContain("Fixture check-in");
    writes.length = 0;
    await logCheckin(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ kind: "bogus", notes: "x" }));
    expect(logs()).toHaveLength(0);
  });

  it("sendMessage: staff logs directly, family through the rpc, neither carries the body", async () => {
    const { sendMessage } = await import("@/lib/actions/messages");
    await sendMessage(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ body: "Fixture message from staff." }));
    currentUser = FAMILY_ID;
    const r = await sendMessage(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form({ body: "Fixture reply from the family." }));
    expect(r.errors).toEqual({});
    console.log(summaries());
    expect(logs()).toHaveLength(2);
    expect(logs()[0].rows[0]).toMatchObject({ actor_id: OWNER_ID, summary: "Sent a message to the family of Fixture Athlete" });
    expect(logs()[1].rows[0]).toMatchObject({ actor_id: FAMILY_ID, summary: "Sent a message", org_id: bridge() });
    expect(JSON.stringify(logs().map((w) => w.rows))).not.toMatch(/Fixture message|Fixture reply/);
  });

  it("processDocument, applyDocument and discardDocument each log once", async () => {
    const { processDocument, applyDocument, discardDocument } = await import("@/lib/actions/documents");
    const stored = { originalName: "transcript.pdf", originalSize: 40, originalMime: "application/pdf", kind: "pdf" as const, sourceRole: "coordinator" as const, ingestedAt: "2026-09-26T00:00:00.000Z", requestId: "req_probe", mediaType: "application/pdf", blockType: "document" as const, storagePath: `${bridge()}/req_fixture/1-transcript.pdf` };
    const p = await processDocument(ORG_WITH_MODULES, { records: [stored], sourceRole: "coordinator", requestedCategory: "transcript", athleteId: IDS.athlete });
    expect(p.ok).toBe(true);
    console.log(summaries());
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rows[0].summary).toBe("Uploaded a transcript for Fixture Athlete");
    expect(logs()[0].rows[0].subject_id).toBe(p.documentId);

    writes.length = 0;
    process.env.ANTHROPIC_API_KEY = "test-only";
    const a = await applyDocument(ORG_WITH_MODULES, IDS.document, IDS.athlete);
    console.log("apply", a, summaries());
    expect(a.ok).toBe(true);
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rows[0].summary).toBe("Applied a transcript to Fixture Athlete");
    expect(JSON.stringify(logs()[0].rows)).not.toMatch(/smudged|graduation year|3\.4/);

    writes.length = 0;
    const again = await applyDocument(ORG_WITH_MODULES, IDS.document, IDS.athlete);
    expect(again.ok).toBe(false);
    expect(logs()).toHaveLength(0);

    writes.length = 0;
    const d = await discardDocument(ORG_WITH_MODULES, IDS.document);
    console.log("discard", d, summaries());
    expect(d.ok).toBe(true);
    expect(logs()).toHaveLength(1);
    expect(logs()[0].rows[0].summary).toBe("Discarded a transcript for Fixture Athlete");

    writes.length = 0;
    expect((await discardDocument(ORG_WITH_MODULES, IDS.document)).ok).toBe(false);
    expect(logs()).toHaveLength(0);
  });
});
