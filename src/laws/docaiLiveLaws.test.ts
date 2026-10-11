// Doc AI defects from the Oct 11 live test. Each law was planted and
// seen to fail; the plant is named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const REDIRECT = "NEXT_REDIRECT:";
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(REDIRECT + url);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }) }));

beforeEach(() => {
  writes = [];
  data = buildFixture();
  delete process.env.ANTHROPIC_API_KEY;
});

const P = <T>(v: T) => Promise.resolve(v);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const doc = (id: string) => data.documents.find((d) => d.id === id)!;
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}

async function run(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return decodeURIComponent(m.slice(REDIRECT.length));
    throw e;
  }
}

// Verified this law bites: put the old category ?? requested_category
// back in readDocumentAgain, watched the profile case fail, reverted.
describe("LAW: an Athlete Profile can be read and read again", () => {
  it("a profile filed before it was a reading type gets Read Again, and reads", async () => {
    const d = doc("doc-mismatch");
    Object.assign(d, { category: null, requested_category: null, filed_as: "athlete_profile", extracted: null, status: "pending", lifecycle: "needs_review", read_by: null });
    data.storage_objects!.push({ bucket: "documents", name: (d.original_paths as string[])[0]!, base64: Buffer.from("%PDF-1.4\n%p\n1 0 obj << >> endobj\n%%EOF\n").toString("base64") });
    const html = await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-mismatch" }), searchParams: P({}) });
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Read Again<\/button>/);
    expect(text(html)).toMatch(/Read Again/);
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    expect(await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-mismatch"))).toBe(`/org/${ORG_WITH_MODULES}/documents/doc-mismatch`);
    expect(doc("doc-mismatch").category).toBe("athlete_profile");
    expect(doc("doc-mismatch").filed_as ?? null).toBeNull();
    expect((doc("doc-mismatch").extracted as { studentName?: string } | null)?.studentName).toBeTruthy();
  });

  it("Athlete Profile is a reading type on the upload form and File As", async () => {
    const { READER_TYPES, isFileType } = await import("@/lib/documents/fileTypes");
    expect(READER_TYPES.map((t) => t.id)).toContain("athlete_profile");
    expect(isFileType("athlete_profile")).toBe(false);
  });
});

const TRIAGE = JSON.stringify({ readable: true, legibilityScore: 0.95, detectedType: "recommendation", typeMatchesExpected: true, pagesDetected: 1, issues: [], recommendation: "proceed", reason: "ok" });
const scripted = (extract: string, triage = TRIAGE) => async (o: { requestId: string }) => (o.requestId.endsWith("_triage") ? triage : extract);
const record = { originalName: "x.pdf", originalSize: 10, originalMime: "application/pdf", kind: "pdf", sourceRole: "coordinator", ingestedAt: "2026-10-11T00:00:00.000Z", requestId: "r", mediaType: "application/pdf", blockType: "document", base64: "JVBERi0=" };
const run2 = async (categoryId: string, extract: string, extra: Record<string, unknown> = {}, triage?: string) => {
  const { runExtractionPipeline } = await import("@/lib/docai/pipeline");
  return runExtractionPipeline({ categoryId, records: [record], sourceRole: "coordinator", roster: [{ id: "a1", name: "Anessa Cruz" }], rosterContext: [], priorVersions: [], callModel: scripted(extract, triage), ...extra } as never);
};

// Verified this law bites: made recommenderName required again, watched
// the letter fail on the null, reverted.
describe("LAW: a letter with no readable recommender is a reviewable reading, not a failure", () => {
  it("recommenderName null reads, and is kept for review", async () => {
    const r = await run2("recommendation", JSON.stringify({ studentName: "Anessa Cruz", recommenderName: null, recommenderTitle: "Teacher", recType: "academic", tone: "strong", themes: ["effort"], summary: "A strong letter.", evidence: { studentName: "Re: Anessa Cruz" }, confidence: 0.9, warnings: [] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extracted.recommenderName).toBeNull();
  });

  it("a field the schema refuses is emptied, the rest kept, and it never auto-applies", async () => {
    const r = await run2("recommendation", JSON.stringify({ studentName: "Anessa Cruz", recommenderName: { first: "?" }, summary: "Letter.", evidence: { studentName: "Re: Anessa Cruz" }, confidence: 0.99, warnings: [] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.route).not.toBe("auto_apply");
      expect((r.extracted.warnings as string[]).join(" ")).toMatch(/partial reading/);
    }
  });
});

// Verified this law bites: dropped the contradictions() call from the
// pipeline, watched the re-read case go through with no flag, reverted.
describe("LAW: a reading is held to the page, and a re-read that contradicts the last one is flagged", () => {
  const TRANSCRIPT_TRIAGE = TRIAGE.replace('"recommendation","typeMatchesExpected"', '"transcript","typeMatchesExpected"');
  const reading = (over: Record<string, unknown>) => JSON.stringify({ studentName: "Anessa Cruz", school: "Westminster School", gradYear: 2027, gpa: 3.4, gpaScale: "4.0", evidence: { studentName: "Student: Anessa Cruz", school: "Westminster School Transcript" }, confidence: 0.95, warnings: [], ...over });

  it("a school the model cannot quote costs confidence and goes to review", async () => {
    const r = await run2("transcript", reading({ evidence: { studentName: "Student: Anessa Cruz" } }), {}, TRANSCRIPT_TRIAGE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.route).not.toBe("auto_apply");
      expect((r.extracted.warnings as string[]).join(" ")).toMatch(/Not quoted from the page.*school/);
      expect(r.extracted.confidence).toBeLessThan(0.95);
    }
  });

  it("a re-read naming another school says so first and never replaces the last reading quietly", async () => {
    const r = await run2("transcript", reading({}), { priorReading: { studentName: "Anessa Cruz", school: "Bishop Hendricken High School" } }, TRANSCRIPT_TRIAGE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const w = r.extracted.warnings as string[];
      expect(w[0]).toMatch(/^Contradicts the earlier reading: the school was "Bishop Hendricken High School", this reading says "Westminster School"/);
      expect(r.route).not.toBe("auto_apply");
    }
  });

  it("a recommender's role flipping between readings is flagged", async () => {
    const { contradictions } = await import("@/lib/docai/identity");
    expect(contradictions({ recommenderTitle: "Mentor" }, { recommenderTitle: "Other" }).map((c) => c.field)).toEqual(["recommenderTitle"]);
    expect(contradictions({ school: "Saint Frances Academy" }, { school: null })).toHaveLength(1);
    expect(contradictions(null, { school: "X" })).toEqual([]);
  });

  it("the document page puts the contradiction at the top", async () => {
    const d = doc("doc-mismatch");
    d.extracted = { ...(d.extracted as object), warnings: ['Contradicts the earlier reading: the school was "A", this reading says "B". Check the page before applying.'] };
    const html = text(await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-mismatch" }), searchParams: P({}) }));
    expect(html).toMatch(/This Reading Disagrees With the Last One/);
  });

  it("the reading prompt carries no roster of names, and never asks for a name from outside the page", async () => {
    const { buildExtractionSystemPrompt } = await import("@/lib/docai/categories");
    const p = buildExtractionSystemPrompt("transcript", [{ id: "a1", name: "Jayden Batista" }], "Elijah Batista");
    expect(p).not.toContain("Jayden Batista");
    expect(p).toMatch(/never copy it into any field/);
    expect(p).toMatch(/come ONLY from text printed on these pages/);
  });
});
