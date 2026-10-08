// Documents and the transcript: what a reading may do to an athlete, and
// how staff correct, add, remove and delete what it left (Stage 4, group
// C: audit wired F1, crud F5, crud F19, design A8).
//
// The first law is the reason this file exists. With no AI key on the
// server every document is read by the stand-in, which invents a
// transcript: a GPA marked verified, a date of birth, a school and a
// course list. Applying one wrote that invented record onto a real
// minor's file. Nothing may write a stand-in's reading onto an athlete,
// by the button or by the pipeline's own auto-apply, now or after a key
// is added.
//
// Each law here was planted and watched fail before it was kept: see the
// note above each describe.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFixture, FAMILY_ID, IDS, MEMBER_ID, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { applyRefusal, readerFor } from "@/lib/data/readBy";
import { applyExtractedEdits, editableFields } from "@/lib/data/extractedEdit";
import { clampCredit, parseCourseForm } from "@/lib/validation/course";

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
// The real model, stood in for by the stub with a usage report, as in
// actionRun.test.ts. Only reached while a test sets ANTHROPIC_API_KEY.
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

beforeEach(() => {
  currentUser = OWNER_ID;
  writes.length = 0;
  data = buildFixture();
  delete process.env.ANTHROPIC_API_KEY;
});

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  process.env.ANTHROPIC_API_KEY = "test-only";
  try {
    return await fn();
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
}

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; state: unknown }> {
  try {
    return { redirect: null, state: await fn() };
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

const bridge = () => data.orgs[0]!.id as string;
const elite = () => data.orgs[1]!.id as string;

// Everything a stand-in transcript would put on an athlete, so a leak of
// any one of them shows up.
const INVENTED = {
  studentName: "Fixture Athlete",
  school: "Sample High School",
  level: "high_school",
  gradYear: 2027,
  gpa: 3.95,
  gpaScale: "4.0",
  gpaVerified: true,
  courseLoad: "Regular",
  dateOfBirth: "2008-03-15",
  gradingScale: [
    { letter: "A", min: 90, max: 100 },
    { letter: "B", min: 80, max: 89 },
    { letter: "C", min: 70, max: 79 },
    { letter: "D", min: 60, max: 69 },
    { letter: "F", min: 0, max: 59 },
  ],
  courses: [{ title: "English 9", subject: "english", credit: 1, grade: "A", term: "24-25", school: null }],
  warnings: [],
};

function pendingDoc(id: string, readBy: string | null, over: Record<string, unknown> = {}) {
  return {
    id,
    org_id: bridge(),
    athlete_id: null,
    file_name: `${id}.pdf`,
    file_size: 1000,
    media_type: "application/pdf",
    source_role: "coordinator",
    status: "pending",
    route: "review",
    category: "transcript",
    provenance: null,
    extracted: INVENTED,
    candidates: [],
    failure_reason: null,
    applied_at: null,
    applied_changes: null,
    undo_note: null,
    storage_paths: [],
    read_by: readBy,
    created_at: "2026-09-26",
    ...over,
  };
}

// Anything that would put a reading on an athlete.
const touchedAthlete = () =>
  writes.filter(
    (w) =>
      (w.table === "athletes" && w.op === "update") ||
      w.table === "athlete_courses" ||
      w.table === "high_school_grading_scales" ||
      w.table === "athlete_metrics" ||
      w.table === "recruiting_targets" ||
      w.table === "contacts" ||
      (w.table === "documents" && w.rows.some((r) => r.status === "applied")),
  );

// Planted: removed the readBy === "stub" branch from applyRefusal and ran
// with a key set: "a stand-in's reading is refused" failed with the GPA,
// the courses and the grading table written. Planted: dropped the gate
// call from applyGuarded and from applyDocument: the same law failed.
// Planted: made applyRefusal ignore `stubbed`: "while no key is set"
// failed. Planted: read_by left off the insert in processDocument: "the
// reader is recorded" failed. Planted: canAutoApply without the gate and
// applyGuarded without it: "the pipeline never auto-applies" failed with
// status applied and athlete writes. All reverted.
describe("LAW: a reading the stand-in made up never lands on an athlete (wired F1)", () => {
  it("a stand-in's reading is refused, even after a key is added, and nothing is written", async () => {
    data.documents!.push(pendingDoc("doc-stub", "stub"));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await withKey(() => applyDocument(ORG_WITH_MODULES, "doc-stub", IDS.athlete));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/made up by the stand-in/);
    expect(touchedAthlete()).toEqual([]);
  });

  it("the fixture's stand-in document is refused too", async () => {
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await withKey(() => applyDocument(ORG_WITH_MODULES, IDS.documentStub, IDS.athlete));
    expect(r.ok).toBe(false);
    expect(touchedAthlete()).toEqual([]);
  });

  it("while no key is set, nothing is applied, not even a real model's earlier reading", async () => {
    data.documents!.push(pendingDoc("doc-real", "claude-opus-5"));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await applyDocument(ORG_WITH_MODULES, "doc-real", IDS.athlete);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No AI key is set/);
    expect(touchedAthlete()).toEqual([]);
  });

  it("a reading from before the reader was recorded needs the model ledger to show a real read", async () => {
    data.documents!.push(pendingDoc("doc-legacy", null, { extracted: { ...INVENTED, courses: [] } }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const refused = await withKey(() => applyDocument(ORG_WITH_MODULES, "doc-legacy", IDS.athlete));
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/before the app recorded which model/);
    expect(touchedAthlete()).toEqual([]);

    // The ledger shows a real model call for it: now it may be applied.
    data.docai_usage!.push({ id: "du-legacy", org_id: bridge(), document_id: "doc-legacy", request_id: "req_legacy", model: "claude-opus-5", input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_cents: 1, created_at: new Date().toISOString() });
    const applied = await withKey(() => applyDocument(ORG_WITH_MODULES, "doc-legacy", IDS.athlete));
    expect(applied.ok).toBe(true);
    expect(writes.some((w) => w.table === "athletes" && w.op === "update")).toBe(true);
  });

  it("the reader is recorded on the row when the reading starts: the stand-in, or the model", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const stored = { originalName: "transcript.pdf", originalSize: 40, originalMime: "application/pdf", kind: "pdf" as const, sourceRole: "coordinator" as const, ingestedAt: "2026-09-26T00:00:00.000Z", requestId: "req_reader", mediaType: "application/pdf", blockType: "document" as const, storagePath: `${bridge()}/req_fixture/1-transcript.pdf` };
    await processDocument(ORG_WITH_MODULES, { records: [stored], sourceRole: "coordinator", requestedCategory: "transcript" });
    expect(writes.find((w) => w.table === "documents" && w.op === "insert")?.rows[0]?.read_by).toBe("stub");

    data = buildFixture();
    writes.length = 0;
    await withKey(() => processDocument(ORG_WITH_MODULES, { records: [stored], sourceRole: "coordinator", requestedCategory: "transcript" }));
    expect(writes.find((w) => w.table === "documents" && w.op === "insert")?.rows[0]?.read_by).toBe("claude-opus-5");
  });

  it("the pipeline never auto-applies a stand-in's reading, even one it would have auto-applied", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    // Find a file the stand-in reads cleanly enough for the pipeline to
    // route it to auto-apply, so this law exercises that exact path.
    let routedToAutoApply = false;
    for (let i = 0; i < 60 && !routedToAutoApply; i++) {
      data = buildFixture();
      writes.length = 0;
      // The name the stand-in prints on every reading, so the resolver
      // matches it and nothing but the gate stands in the way.
      (data.athletes!.find((a) => a.id === IDS.athlete) as Record<string, unknown>).name = "Sample Athlete";
      const stored = { originalName: `scan-${i}.pdf`, originalSize: 40 + i, originalMime: "application/pdf", kind: "pdf" as const, sourceRole: "coordinator" as const, ingestedAt: "2026-09-26T00:00:00.000Z", requestId: `req_auto_${i}`, mediaType: "application/pdf", blockType: "document" as const, storagePath: `${bridge()}/req_fixture/1-transcript.pdf` };
      const r = await processDocument(ORG_WITH_MODULES, { records: [stored], sourceRole: "coordinator", requestedCategory: "transcript", athleteId: IDS.athlete });
      expect(r.ok).toBe(true);
      routedToAutoApply = writes.some((w) => w.table === "documents" && w.op === "update" && w.rows[0]?.route === "auto_apply");
      expect(touchedAthlete()).toEqual([]);
    }
    expect(routedToAutoApply).toBe(true);
    const settled = writes.find((w) => w.table === "documents" && w.op === "update" && w.rows[0]?.route === "auto_apply")!;
    expect(settled.rows[0]!.status).toBe("pending");
  });

  it("the gate itself: stand-in forever, nothing without a key, a blank reader needs the ledger", () => {
    expect(readerFor(true, "claude-opus-5")).toBe("stub");
    expect(readerFor(false, "claude-opus-5")).toBe("claude-opus-5");
    expect(applyRefusal({ readBy: "stub", stubbed: false, ledgerShowsRealRead: true })).toMatch(/never be applied/);
    expect(applyRefusal({ readBy: "claude-opus-5", stubbed: true, ledgerShowsRealRead: true })).toMatch(/No AI key/);
    expect(applyRefusal({ readBy: null, stubbed: false, ledgerShowsRealRead: false })).toMatch(/before the app recorded/);
    expect(applyRefusal({ readBy: null, stubbed: false, ledgerShowsRealRead: true })).toBeNull();
    expect(applyRefusal({ readBy: "claude-opus-5", stubbed: false, ledgerShowsRealRead: false })).toBeNull();
  });
});

// Planted: made the no-Apply candidate branch unreachable so Apply showed
// on a stand-in's reading: the render law failed on the Apply button.
// Reverted.
describe("LAW: the review screen offers no Apply on a reading that can not be applied", () => {
  async function render(id: string): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = (await import("@/app/org/[slug]/documents/[id]/page")) as { default: (p: unknown) => Promise<unknown> };
    const tree = await mod.default({ params: Promise.resolve({ slug: ORG_WITH_MODULES, id }) });
    return renderToStaticMarkup(tree as never);
  }
  const withCandidate = (d: Record<string, unknown>) => ({ ...d, candidates: [{ athleteId: IDS.athlete, name: "Fixture Athlete", score: 0.8, reasons: ["name"] }] });

  it("a stand-in's reading says why and has no Apply, with or without a key", async () => {
    data.documents!.push(withCandidate(pendingDoc("doc-stub-page", "stub")));
    const html = await withKey(() => render("doc-stub-page"));
    expect(html).toMatch(/This Reading Can(&#x27;|')t Be Applied/);
    expect(html).not.toMatch(/>Apply</);
    expect(html).not.toMatch(/Correct the Reading/);
  });

  it("a real model's reading with a key set shows Apply and Correct the Reading", async () => {
    data.documents!.push(withCandidate(pendingDoc("doc-real-page", "claude-opus-5")));
    const html = await withKey(() => render("doc-real-page"));
    expect(html).toMatch(/>Apply</);
    expect(html).toMatch(/Correct the Reading/);
  });

  it("with no key set, nothing shows Apply", async () => {
    data.documents!.push(withCandidate(pendingDoc("doc-nokey-page", "claude-opus-5")));
    const html = await render("doc-nokey-page");
    expect(html).toMatch(/AI Key Not Set/);
    expect(html).not.toMatch(/>Apply</);
  });
});

// Planted: made updateExtracted skip the stand-in check: the first case
// failed with the correction stored. Planted: took the schema check out:
// "a correction the schema refuses" failed with a write. Reverted.
describe("LAW: a reading is corrected before it is applied, checked again, and never a stand-in's (crud F5)", () => {
  it("a stand-in's reading can not be corrected into something that looks real", async () => {
    data.documents!.push(pendingDoc("doc-stub-fix", "stub"));
    const { updateExtracted } = await import("@/lib/actions/documents");
    const r = await run(() => updateExtracted(ORG_WITH_MODULES, "doc-stub-fix", { errors: {} }, form({ gpa: "3.2", gpaScale: "4.0" })));
    expect(r.redirect).toBeNull();
    expect((r.state as { errors: Record<string, string> }).errors.form).toMatch(/stand-in/);
    expect(writes.filter((w) => w.table === "documents")).toEqual([]);
  });

  it("a real reading takes the correction, and only the fields the screen offers", async () => {
    data.documents!.push(pendingDoc("doc-fix", "claude-opus-5"));
    const { updateExtracted } = await import("@/lib/actions/documents");
    const r = await run(() => updateExtracted(ORG_WITH_MODULES, "doc-fix", { errors: {} }, form({ gpa: "3.1", gpaScale: "4.0", school: "Fixture High School", level: "college", courses: "[]" })));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/documents/doc-fix`);
    const saved = writes.find((w) => w.table === "documents" && w.op === "update")!;
    const next = saved.rows[0]!.extracted as Record<string, unknown>;
    expect(next.gpa).toBe(3.1);
    expect(next.school).toBe("Fixture High School");
    // Not offered on the screen, so a crafted post can not reach them.
    expect(next.level).toBe("high_school");
    expect((next.courses as unknown[]).length).toBe(1);
    expect(saved.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "org_id", value: bridge() }), expect.objectContaining({ column: "status", value: "pending" })]));
  });

  it("a correction the schema refuses is not stored", async () => {
    data.documents!.push(pendingDoc("doc-fix-bad", "claude-opus-5"));
    const { updateExtracted } = await import("@/lib/actions/documents");
    const r = await run(() => updateExtracted(ORG_WITH_MODULES, "doc-fix-bad", { errors: {} }, form({ gradYear: "1850", gpaScale: "4.0" })));
    expect(r.redirect).toBeNull();
    expect(Object.keys((r.state as { errors: Record<string, string> }).errors)).toContain("gradYear");
    expect(writes.filter((w) => w.table === "documents")).toEqual([]);
  });

  it("a member can not correct a reading", async () => {
    data.documents!.push(pendingDoc("doc-fix-member", "claude-opus-5"));
    currentUser = MEMBER_ID;
    const { updateExtracted } = await import("@/lib/actions/documents");
    const r = await run(() => updateExtracted(ORG_WITH_MODULES, "doc-fix-member", { errors: {} }, form({ gpa: "2.0", gpaScale: "4.0" })));
    expect(r.redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("the edit list and the parser agree: a list field is written at its own index", () => {
    const tests = { studentName: "A", tests: [{ type: "SAT", totalScore: 1100, testDate: "2026-03-01" }, { type: "ACT", totalScore: 24, testDate: null }] };
    const names = editableFields("test_scores", tests).map((f) => f.name);
    expect(names).toEqual(["studentName", "tests.0.totalScore", "tests.0.testDate", "tests.1.totalScore", "tests.1.testDate"]);
    const out = applyExtractedEdits("test_scores", tests, form({ studentName: "A", "tests.0.totalScore": "1110", "tests.0.testDate": "2026-03-01", "tests.1.totalScore": "25", "tests.1.testDate": "" }));
    expect(out.ok).toBe(true);
    expect((out.extracted.tests as { totalScore: number }[]).map((t) => t.totalScore)).toEqual([1110, 25]);
    // The stored reading is copied, never changed in place.
    expect(tests.tests[0]!.totalScore).toBe(1100);
  });
});

// Planted: took .eq("athlete_id", athleteId) off updateCourse: "scoped by
// org and athlete" failed. Planted: raised the credit cap in the schema to
// 150: "a credit the column can not hold" failed. Planted: made addCourse
// skip the roster check: the cross-org case failed with an insert.
// Reverted.
describe("LAW: a transcript row is staff's to correct, add and remove, in its own org and athlete (crud F5)", () => {
  const course = { title: "English 11", subject: "english", credit: "1", grade: "B+", term: "25-26 S1", schoolName: "Fixture High School", approval: "approved" };

  it("an edit is scoped by org and athlete as well as the row, and says what it settled", async () => {
    const { updateCourse } = await import("@/lib/actions/courses");
    const r = await run(() => updateCourse(ORG_WITH_MODULES, IDS.athlete, "ac1", { errors: {} }, form(course)));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/transcript`);
    const w = writes.find((x) => x.table === "athlete_courses" && x.op === "update")!;
    expect(w.rows[0]).toMatchObject({ grade: "B+", ncaa_approved: true, approval_source: "manual" });
    expect(w.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "id", value: "ac1" }), expect.objectContaining({ column: "org_id", value: bridge() }), expect.objectContaining({ column: "athlete_id", value: IDS.athlete })]));
  });

  it("a row that is not this athlete's is not changed, and the screen is told so", async () => {
    const { updateCourse } = await import("@/lib/actions/courses");
    const r = await run(() => updateCourse(ORG_WITH_MODULES, IDS.athleteNoGpa, "ac1", { errors: {} }, form(course)));
    expect(r.redirect).toBeNull();
    expect((r.state as { errors: Record<string, string> }).errors.form).toMatch(/no longer on this athlete/);
  });

  it("a course is added to this org's athlete only", async () => {
    const { addCourse } = await import("@/lib/actions/courses");
    const ok = await run(() => addCourse(ORG_WITH_MODULES, IDS.athlete, { errors: {} }, form(course)));
    expect(ok.redirect).toContain("/transcript");
    expect(writes.find((w) => w.table === "athlete_courses" && w.op === "insert")!.rows[0]).toMatchObject({ org_id: bridge(), athlete_id: IDS.athlete, document_id: null, credit: 1 });
    writes.length = 0;
    const foreign = await run(() => addCourse(ORG_WITH_MODULES, IDS.athleteElite, { errors: {} }, form(course)));
    expect(foreign.redirect).toBeNull();
    expect(writes).toEqual([]);
  });

  it("a remove is scoped the same way, and a member can do none of it", async () => {
    const { deleteCourse, updateCourse } = await import("@/lib/actions/courses");
    const r = await run(() => deleteCourse(ORG_WITH_MODULES, IDS.athlete, "ac1"));
    expect(r.redirect).toContain("/transcript");
    const del = writes.find((w) => w.table === "athlete_courses" && w.op === "delete")!;
    expect(del.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "org_id", value: bridge() }), expect.objectContaining({ column: "athlete_id", value: IDS.athlete })]));
    writes.length = 0;
    currentUser = MEMBER_ID;
    expect((await run(() => deleteCourse(ORG_WITH_MODULES, IDS.athlete, "ac1"))).redirect).toBe("/unauthorized");
    expect((await run(() => updateCourse(ORG_WITH_MODULES, IDS.athlete, "ac1", { errors: {} }, form(course)))).redirect).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });

  it("a credit the column can not hold is refused, and apply clamps to the same limit", () => {
    const bad = parseCourseForm(form({ ...course, credit: "150" }));
    expect(bad.ok).toBe(false);
    expect(bad.errors.credit).toBeTruthy();
    expect(parseCourseForm(form({ ...course, grade: "" })).errors.grade).toBeTruthy();
    expect(parseCourseForm(form({ ...course, subject: "gym" })).errors.subject).toBeTruthy();
    expect(clampCredit(150)).toBe(99.99);
    expect(clampCredit(-2)).toBe(0);
    expect(clampCredit("x")).toBe(0);
  });
});

// Piece 1 of the Doc AI rebuild: originals are permanent. There is no
// delete action, and the database would refuse one (rls_test.sql). This
// replaces the crud F19 delete-after-discard law. Planted: exported a
// deleteDocument again: "no action deletes a document" failed. Reverted.
describe("LAW: a document and its file are never deleted from the app", () => {
  it("the actions file exports no delete of a document", async () => {
    const actions = await import("@/lib/actions/documents");
    expect(Object.keys(actions).filter((k) => /delete/i.test(k))).toEqual([]);
  });

  it("a delete against documents is refused by the data layer the way the database refuses it", async () => {
    const { createFakeClient } = await import("@/testing/fakeSupabase");
    const client = createFakeClient(data, { userId: OWNER_ID });
    const { error } = await client.from("documents").delete().eq("id", IDS.document);
    expect(error).toBeTruthy();
    expect(data.documents!.some((d) => d.id === IDS.document)).toBe(true);
  });

  it("discarding archives the document and keeps it and its file", async () => {
    const { discardDocument } = await import("@/lib/actions/documents");
    data.documents!.push(pendingDoc("doc-keep", "claude-opus-5", { storage_paths: [`${bridge()}/req_fixture/1-transcript.pdf`], original_paths: [`${bridge()}/req_fixture/1-transcript.pdf`], lifecycle: "needs_review" }));
    const r = await discardDocument(ORG_WITH_MODULES, "doc-keep");
    expect(r.ok).toBe(true);
    const row = data.documents!.find((d) => d.id === "doc-keep")!;
    expect(row.status).toBe("discarded");
    expect(row.lifecycle).toBe("archived");
    expect(writes.filter((w) => w.table === "storage:documents" && w.op === "delete")).toEqual([]);
    expect(data.storage_objects!.some((o) => o.name === `${bridge()}/req_fixture/1-transcript.pdf`)).toBe(true);
  });
});

// Planted: made fillHighSchoolFromTranscript overwrite a typed school:
// "never over one somebody typed" failed. Planted: dropped the detail
// from applied_changes: the undo case failed. Reverted.
describe("LAW: a transcript fills a blank High School and a discard takes it back (design A8)", () => {
  const blankHs = () => {
    const a = data.athletes!.find((x) => x.id === IDS.athleteNoGpa) as Record<string, unknown>;
    a.detail = { kind: "hs" };
    a.home_state = "CT";
    return a;
  };
  const transcript = { ...INVENTED, school: "Fixture High School", courses: [] };

  it("the header school fills it, with the directory row it names", async () => {
    blankHs();
    data.documents!.push(pendingDoc("doc-hs", "claude-opus-5", { extracted: transcript }));
    const { applyDocument } = await import("@/lib/actions/documents");
    const r = await withKey(() => applyDocument(ORG_WITH_MODULES, "doc-hs", IDS.athleteNoGpa));
    expect(r.ok).toBe(true);
    const detailWrite = writes.find((w) => w.table === "athletes" && w.op === "update" && w.rows[0]?.detail !== undefined)!;
    expect(detailWrite.rows[0]!.detail).toMatchObject({ kind: "hs", highSchool: "Fixture High School", highSchoolId: IDS.highSchool });
    const changes = writes.find((w) => w.table === "documents" && w.op === "update" && w.rows[0]?.applied_changes !== undefined)!.rows[0]!.applied_changes as { detail: Record<string, unknown> };
    expect(changes.detail).toMatchObject({ highSchool: { before: null, after: "Fixture High School" } });

    // The undo reads what is on the athlete now.
    const athlete = blankHs();
    athlete.detail = detailWrite.rows[0]!.detail;
    const doc = data.documents!.find((d) => d.id === "doc-hs") as Record<string, unknown>;
    doc.status = "applied";
    doc.applied_changes = changes;
    writes.length = 0;
    const { discardDocument } = await import("@/lib/actions/documents");
    const u = await discardDocument(ORG_WITH_MODULES, "doc-hs");
    expect(u.ok).toBe(true);
    expect(u.undone!.join(" ")).toMatch(/previous high school/);
    const restored = writes.find((w) => w.table === "athletes" && w.op === "update" && w.rows[0]?.detail !== undefined)!;
    expect(restored.rows[0]!.detail).toEqual({ kind: "hs" });
  });

  it("never over one somebody typed", async () => {
    const a = blankHs();
    a.detail = { kind: "hs", highSchool: "Typed High School" };
    data.documents!.push(pendingDoc("doc-hs2", "claude-opus-5", { extracted: transcript }));
    const { applyDocument } = await import("@/lib/actions/documents");
    await withKey(() => applyDocument(ORG_WITH_MODULES, "doc-hs2", IDS.athleteNoGpa));
    expect(writes.some((w) => w.table === "athletes" && w.op === "update" && w.rows[0]?.detail !== undefined)).toBe(false);
  });

  it("a header the reading missed falls back to the athlete's own high school on the course rows", async () => {
    const a = blankHs();
    a.detail = { kind: "hs", highSchool: "Fixture High School" };
    data.documents!.push(pendingDoc("doc-hs3", "claude-opus-5", { extracted: { ...INVENTED, school: null, gradingScale: null } }));
    const { applyDocument } = await import("@/lib/actions/documents");
    await withKey(() => applyDocument(ORG_WITH_MODULES, "doc-hs3", IDS.athleteNoGpa));
    const rows = writes.find((w) => w.table === "athlete_courses" && w.op === "insert")!.rows;
    expect(rows[0]).toMatchObject({ school_name: "Fixture High School" });
  });
});

// The new screens render on the fixture, for the people they are for.
// Planted: dropped the isStaff check on the transcript's Add button: the
// family case failed. Planted: removed .eq("athlete_id", id) from the
// course screen's query: "another athlete's course is not found" failed.
// Reverted.
describe("LAW: the course and correction screens render, and only for staff", () => {
  async function render(modulePath: string, params: Record<string, string>): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: unknown) => Promise<unknown> };
    const tree = await mod.default({ params: Promise.resolve(params) });
    return renderToStaticMarkup(tree as never);
  }
  const TRANSCRIPT = "@/app/org/[slug]/roster/[id]/transcript/page";
  const COURSE = "@/app/org/[slug]/roster/[id]/transcript/[courseId]/page";
  const NEW_COURSE = "@/app/org/[slug]/roster/[id]/transcript/new/page";
  const CORRECT = "@/app/org/[slug]/documents/[id]/edit/page";

  it("staff open each course from the transcript and can add one; a family login can do neither", async () => {
    const staff = await render(TRANSCRIPT, { slug: ORG_WITH_MODULES, id: IDS.athlete });
    expect(staff).toContain(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/transcript/ac1`);
    expect(staff).toContain(`/org/${ORG_WITH_MODULES}/roster/${IDS.athlete}/transcript/new`);
    currentUser = FAMILY_ID;
    const family = await render(TRANSCRIPT, { slug: ORG_WITH_MODULES, id: IDS.athlete });
    expect(family).not.toContain("/transcript/ac1");
    expect(family).not.toContain("/transcript/new");
  });

  it("the course screen fills the form and offers a confirmed Remove", async () => {
    const html = await render(COURSE, { slug: ORG_WITH_MODULES, id: IDS.athlete, courseId: "ac1" });
    expect(html).toMatch(/Edit Course/);
    expect(html).toMatch(/value="English 11"/);
    expect(html).toMatch(/Remove Course/);
    const add = await render(NEW_COURSE, { slug: ORG_WITH_MODULES, id: IDS.athlete });
    expect(add).toMatch(/Add a Course/);
    expect(add).toMatch(/value="Fixture High School"/);
  });

  it("another athlete's course is not found, and a member or family login is turned away", async () => {
    await expect(render(COURSE, { slug: ORG_WITH_MODULES, id: IDS.athleteNoGpa, courseId: "ac1" })).rejects.toThrow(NOT_FOUND);
    for (const user of [MEMBER_ID, FAMILY_ID]) {
      currentUser = user;
      await expect(render(COURSE, { slug: ORG_WITH_MODULES, id: IDS.athlete, courseId: "ac1" })).rejects.toThrow(REDIRECT);
      await expect(render(NEW_COURSE, { slug: ORG_WITH_MODULES, id: IDS.athlete })).rejects.toThrow(REDIRECT);
    }
  });

  it("a real reading opens for correction; a stand-in's goes back to the review screen", async () => {
    const html = await render(CORRECT, { slug: ORG_WITH_MODULES, id: IDS.document });
    expect(html).toMatch(/Correct the Reading/);
    expect(html).toMatch(/name="gpa"/);
    await expect(render(CORRECT, { slug: ORG_WITH_MODULES, id: IDS.documentStub })).rejects.toThrow(`${REDIRECT}/org/${ORG_WITH_MODULES}/documents/${IDS.documentStub}`);
  });
});

// Planted: swapped one ConfirmButton for a plain Button on the course
// screen: this law failed naming the file. Reverted.
describe("LAW: every delete on the transcript screens asks first (a document has no delete)", () => {
  const APP = join(process.cwd(), "src/app/org/[slug]");
  const FILES = ["roster/[id]/transcript/[courseId]/page.tsx"];

  it("each Form posting a delete holds a ConfirmButton", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(join(APP, f), "utf8");
      const forms = [...src.matchAll(/<Form action=\{(delete\w*|deleteAction)[^}]*\}>([\s\S]*?)<\/Form>/g)];
      if (forms.length === 0) offenders.push(`${f}: no delete form found`);
      for (const m of forms) if (!/<ConfirmButton/.test(m[2]!)) offenders.push(`${f}: ${m[1]} without a ConfirmButton`);
    }
    expect(offenders).toEqual([]);
  });

  it("staff reach the course editor from the transcript, and a family login does not", () => {
    const src = readFileSync(join(APP, "roster/[id]/transcript/page.tsx"), "utf8");
    expect(src).toMatch(/href=\{isStaff \? `\/org\/\$\{slug\}\/roster\/\$\{id\}\/transcript\/\$\{c\.id\}`/);
    expect(src).toMatch(/isStaff = user\.role === "owner" \|\| user\.role === "staff"/);
  });
});

// ORG_WITHOUT_MODULES is imported so a later law about Elite's documents
// has the slug at hand; referenced here to keep the import honest.
void ORG_WITHOUT_MODULES;
