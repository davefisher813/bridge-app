// Every document runs through Doc AI (Dave, Oct 11): Board Document,
// Other and No Type have readings, Word, Excel, CSV and text are read as
// their text, and a format that cannot be read says so before upload.
// Each law was planted and seen to fail; the plant is named beside it.

import { readFileSync } from "node:fs";
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

// Checked against files the real tools wrote (python-docx, openpyxl): a
// table row split over lines was found this way and fixed.
describe("LAW: Word and Excel files are turned into their text, made by the real tools", () => {
  it("a .docx made by python-docx reads with its heading, paragraph and table", async () => {
    const { readerText } = await import("@/lib/vault/textExtract");
    const r = readerText("sample.docx", new Uint8Array(readFileSync("src/testing/samples/sample.docx")));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("Harbor Scholarship Proposal");
      expect(r.text).toContain("Prepared for the Bridge Foundation board, March 2026.");
      expect(r.text).toMatch(/Award \| \$5,000/);
      expect(r.text).toMatch(/Deadline \| April 30, 2026/);
    }
  });

  it("a .xlsx made by openpyxl reads sheet by sheet, row by row, columns lined up", async () => {
    const { readerText } = await import("@/lib/vault/textExtract");
    const r = readerText("sample.xlsx", new Uint8Array(readFileSync("src/testing/samples/sample.xlsx")));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toContain("Sheet: College List");
      expect(r.text).toContain("School | Division | Notes");
      expect(r.text).toContain("Fairfield University | D1 | Visit in May");
      expect(r.text).toMatch(/Trinity College \| 3/);
      expect(r.text).toMatch(/\|\s+\|\s+\|\s+\|\s+far cell/);
    }
  });

  it("an old .doc or .xls is refused with what to do, said before upload", async () => {
    const { readerTextBlocker } = await import("@/lib/vault/format");
    expect(readerTextBlocker("minutes.doc")).toMatch(/Save it as \.docx/);
    expect(readerTextBlocker("list.xls")).toMatch(/Save it as \.xlsx/);
    expect(readerTextBlocker("list.xlsx")).toBeNull();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { DocumentUploader } = await import("@/components/DocumentUploader");
    const html = renderToStaticMarkup(createElement(DocumentUploader, { slug: ORG_WITH_MODULES, orgId: data.orgs[0]!.id as string }));
    expect(html).toMatch(/Old \.doc and \.xls files are stored but not read/);
  });
});

const record = { originalName: "x.txt", originalSize: 10, originalMime: "text/plain", kind: "text", sourceRole: "coordinator", ingestedAt: "2026-10-11T00:00:00.000Z", requestId: "r", mediaType: "text/plain", blockType: "text", base64: Buffer.from("Bylaws of the Sample Foundation").toString("base64") };
const pipe = async (categoryId: string, extract: string, detected = "other") => {
  const { runExtractionPipeline } = await import("@/lib/docai/pipeline");
  const triage = JSON.stringify({ readable: true, legibilityScore: 0.95, detectedType: detected, typeMatchesExpected: false, pagesDetected: 1, issues: [], recommendation: "wrong_category", reason: "ok" });
  return runExtractionPipeline({ categoryId, records: [record], sourceRole: "coordinator", roster: [{ id: "a1", name: "Anessa Cruz" }], rosterContext: [], priorVersions: [], callModel: async (o: { requestId: string }) => (o.requestId.endsWith("_triage") ? triage : extract) } as never);
};

// Verified this law bites: took the reference check off the triage
// mismatch, watched a board document get refused as the wrong type,
// reverted.
describe("LAW: a board document and anything else are read for a person and never applied", () => {
  it("a Board Document reads its kind, people, figures and actions, and is held for review", async () => {
    const r = await pipe("board_document", JSON.stringify({ documentKind: "bylaws", title: "Bylaws", organization: "Sample Foundation", adoptionDate: "2024-12-10", people: [{ name: "Pat Chair", role: "Chair" }], amounts: [{ amount: 500, what: "annual dues" }], deadlines: [], actionItems: ["Adopt the bylaws."], summary: "The bylaws.", evidence: { organization: "Bylaws of the Sample Foundation" }, confidence: 0.95, warnings: [] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.route).not.toBe("auto_apply");
      expect(r.extracted).toMatchObject({ documentKind: "bylaws", organization: "Sample Foundation", people: [{ name: "Pat Chair", role: "Chair" }], amounts: [{ amount: 500, what: "annual dues" }] });
      expect((r.extracted.warnings as string[]).join(" ")).not.toMatch(/No athlete on this roster|does not name the student/);
    }
  });

  it("Other reads a summary and the type it should be filed as", async () => {
    const r = await pipe("other", JSON.stringify({ suggestedType: "board_document", documentKind: "minutes", keyFacts: ["Met in May."], summary: "Minutes.", confidence: 0.9, warnings: [] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.extracted.suggestedType).toBe("board_document");
      expect(r.route).not.toBe("auto_apply");
    }
  });

  it("the text of a Word file reaches the model as a text document", async () => {
    const { contentFor } = await import("@/lib/ai/anthropicCaller");
    const blocks = contentFor({ records: [record], userText: "read it" } as never) as { type: string; source?: { type: string; data: string } }[];
    expect(blocks[0]).toMatchObject({ type: "document", source: { type: "text", data: "Bylaws of the Sample Foundation" } });
  });
});

// Verified this law bites: took .docx off isTextReadable, watched the
// Board Document upload go unread, reverted. (No Type being read is held
// in actionRun.test.ts.)
describe("LAW: every upload is read, and every reading waits for a person", () => {
  const stored = (path: string, name: string) => ({ originalName: name, originalSize: 10, originalMime: "x", kind: "pdf", sourceRole: "coordinator", ingestedAt: "2026-10-11T00:00:00.000Z", requestId: "req_x", mediaType: "application/pdf", blockType: "document", storagePath: path });
  it("a .docx filed as Board Document reads on upload and lands in Needs Review, not applied", async () => {
    const orgId = data.orgs[0]!.id as string;
    const path = `${orgId}/req_bd/1-proposal.docx`;
    data.storage_objects!.push({ bucket: "documents", name: path, base64: readFileSync("src/testing/samples/sample.docx").toString("base64") });
    const { processDocument } = await import("@/lib/actions/documents");
    const r = await processDocument(ORG_WITH_MODULES, { originals: [{ storagePath: path, name: "proposal.docx", reader: null }], sourceRole: "coordinator", requestedCategory: "board_document" } as never);
    expect(r.ok).toBe(true);
    const row = data.documents.find((d) => d.id === r.documentId)!;
    expect(row).toMatchObject({ category: "board_document", lifecycle: "needs_review" });
    expect(row.status).not.toBe("applied");
    expect(row.read_by).not.toBeNull();
    void stored;
  });

  it("a filed Board Document or Other from before gets a working Read Again", async () => {
    const d = doc("doc-mismatch");
    Object.assign(d, { category: null, requested_category: null, filed_as: "board_document", extracted: null, status: "pending", lifecycle: "needs_review", read_by: null });
    data.storage_objects!.push({ bucket: "documents", name: (d.original_paths as string[])[0]!, base64: Buffer.from("%PDF-1.4\n%b\n1 0 obj << >> endobj\n%%EOF\n").toString("base64") });
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    expect(await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-mismatch"))).toBe(`/org/${ORG_WITH_MODULES}/documents/doc-mismatch`);
    expect(doc("doc-mismatch").category).toBe("board_document");
    const html = text(await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-mismatch" }), searchParams: P({}) }));
    expect(html).toMatch(/Nothing Goes on an Athlete/);
    expect(html).toMatch(/Kind of Document/);
    expect(html).not.toMatch(/Pick the Athlete/i);
  });
});
