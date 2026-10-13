// Doc AI Pieces 5 and 6 (2026-10-13).
//
// Piece 5: an Athlete login sends a document for its own athlete outside
// any assignment. It is filed (status filed, Needs Review, an Athlete
// Upload), never applied and never read on its own; an Admin can Read
// Again it, charged like any reading. The one write is
// family_send_document (migration 0066), mirrored in src/testing/fakeRpc.ts.
//
// Piece 6: the document screen shows what a stored file holds: a photo on
// the page, a PDF opened in the browser, the reader's text of a Word,
// Excel, CSV or text file, page by page. Staff only, as the screen and the
// download route already are.
//
// Each law was planted and seen to fail; the plant is named beside it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFixture, FAMILY_ID, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { activitySummary } from "@/lib/data/activity";
import { FAMILY_SEND_TYPES, familySendPath, isFamilySendPathFor } from "@/lib/data/familySend";
import { capPreviewText, inlineMediaTypeOf, previewKindOf, storedFormatOf } from "@/lib/vault/preview";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");
const M66 = join(ROOT, "migrations/0066_family_sends_document.sql");
const ACTION = join(SRC, "lib/actions/familyDocuments.ts");
const FORM = join(SRC, "components/FamilyDocumentForm.tsx");
const read = (f: string) => readFileSync(f, "utf8");
const stripLineComments = (src: string) => src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, "");

// ── The harness ──────────────────────────────────────────────────────

const NOT_FOUND = "NEXT_NOT_FOUND";
const REDIRECT = "NEXT_REDIRECT:";
const BRIDGE_ID = "00000000-0000-0000-0000-0000000000a1";

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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, serviceRole: true }) }));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  delete process.env.ANTHROPIC_API_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
});

async function run(fn: () => Promise<unknown>): Promise<{ redirect: string | null; notFound: boolean; state: { errors: Record<string, string> } | null }> {
  try {
    return { redirect: null, notFound: false, state: (await fn()) as never };
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return { redirect: decodeURIComponent(m.slice(REDIRECT.length)), notFound: false, state: null };
    if (m === NOT_FOUND) return { redirect: null, notFound: true, state: null };
    throw e;
  }
}

const P = <T,>(v: T) => Promise.resolve(v);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
async function render(modulePath: string, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = (await import(/* @vite-ignore */ modulePath)) as { default: (p: Record<string, unknown>) => Promise<unknown> };
  return renderToStaticMarkup((await mod.default(props)) as never);
}
const docPage = (id: string) => render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id }), searchParams: P({}) });

const PDF = Buffer.from("%PDF-1.4\n%a family's fall report\n1 0 obj << >> endobj\n%%EOF\n");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const SEND_PATH = familySendPath(BRIDGE_ID, IDS.athlete, "req_law", "fall-report.pdf")!;
const codeOf = (r: unknown) => (r as { error?: { code?: string } | null }).error?.code;

function putFile(name: string, bytes: Buffer = PDF, owner: string | null = FAMILY_ID) {
  data.storage_objects!.push({ bucket: "documents", name, owner, base64: bytes.toString("base64") });
  return name;
}

function sendForm(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}
const sendPdf = (path = SEND_PATH, extra: Record<string, string> = {}) => sendForm({ storagePath: path, fileName: "fall-report.pdf", mediaType: "application/pdf", note: "  The fall report.  ", docType: "transcript", ...extra });

async function send(athleteId: string, fd: FormData) {
  const { sendFamilyDocument } = await import("@/lib/actions/familyDocuments");
  return run(() => sendFamilyDocument(ORG_WITH_MODULES, athleteId, { errors: {} }, fd));
}

// A document added for a screen law, cloned off the fixture's own so
// every column the screen reads is there.
function addDoc(id: string, over: Record<string, unknown>): Record<string, unknown> {
  const base = structuredClone(data.documents.find((d) => d.id === IDS.document)!) as Record<string, unknown>;
  const row = { ...base, id, athlete_id: null, linked_athlete_id: null, read_by: null, extracted: null, category: null, candidates: [], provenance: null, triage: null, review_reason: null, lifecycle: "needs_review", status: "pending", ...over };
  data.documents.push(row);
  return row;
}

// ── Piece 5 ──────────────────────────────────────────────────────────

describe("LAW: an Athlete login sends a document for its own athlete, filed for an Admin and never read", () => {
  // Planted: the fake function filed the row as "pending" instead of
  // "filed"; the status assertion failed. Reverted.
  it("files the PDF on its athlete, in Needs Review, unread, with its type, its note and one literal log line", async () => {
    currentUser = FAMILY_ID;
    putFile(SEND_PATH);
    const r = await send(IDS.athlete, sendPdf());
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/family/${IDS.athlete}`);
    const docs = writes.filter((w) => w.op === "insert" && w.table === "documents");
    expect(docs.map((w) => w.via)).toEqual(["rpc:family_send_document"]);
    expect(docs[0]!.rows[0]).toMatchObject({
      status: "filed",
      lifecycle: "needs_review",
      source_role: "parent",
      athlete_id: IDS.athlete,
      linked_athlete_id: IDS.athlete,
      uploaded_by: FAMILY_ID,
      media_type: "application/pdf",
      format: "pdf",
      requested_category: "transcript",
      family_note: "The fall report.",
      read_by: null,
      extracted: null,
      storage_paths: [SEND_PATH],
      original_paths: [SEND_PATH],
      content_hash: createHash("sha256").update(PDF).digest("hex"),
    });
    const logs = writes.filter((w) => w.op === "insert" && w.table === "activity_log");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.rows[0]).toMatchObject({ action: "document_uploaded", actor_id: FAMILY_ID, athlete_id: IDS.athlete, summary: activitySummary("document_uploaded", { kind: "document" }) });
    // No reading, no model ledger row, no write the caller made itself.
    expect(writes.some((w) => w.table === "docai_usage")).toBe(false);
    expect(writes.filter((w) => !w.via && !w.table.startsWith("storage:"))).toEqual([]);
  });

  // Planted: dropped the isFamilySendPathFor check from the action; the
  // other-folder case came back as the function's refusal, not the
  // action's, and the file error was missing. Reverted.
  it("refuses another athlete's folder, a staff folder, bytes that are not a PDF or photo, and the same bytes twice, writing nothing", async () => {
    currentUser = FAMILY_ID;
    for (const bad of [familySendPath(BRIDGE_ID, IDS.athleteTransfer, "req_law", "x.pdf")!, `${BRIDGE_ID}/req_fixture/1-x.pdf`, `${BRIDGE_ID}/family/req_law/x.pdf`]) {
      putFile(bad);
      const r = await send(IDS.athlete, sendPdf(bad));
      expect(r.redirect, bad).toBeNull();
      expect(r.state?.errors.file, bad).toBeTruthy();
    }
    const fake = putFile(familySendPath(BRIDGE_ID, IDS.athlete, "req_text", "x.pdf")!, Buffer.from("just text, not a pdf"));
    expect((await send(IDS.athlete, sendPdf(fake))).state?.errors.file).toBeTruthy();
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);

    putFile(SEND_PATH);
    expect((await send(IDS.athlete, sendPdf())).redirect).toBeTruthy();
    const again = putFile(familySendPath(BRIDGE_ID, IDS.athlete, "req_again", "fall-report.pdf")!);
    const r = await send(IDS.athlete, sendPdf(again));
    expect(r.state?.errors.file).toMatch(/already sent on .* as fall-report\.pdf/);
    expect(writes.filter((w) => w.op === "insert" && w.table === "documents")).toHaveLength(1);
  });

  // Planted: swapped requireFamily for a plain sign-in check; the Admin
  // got through to the function. Reverted.
  it("only an Athlete login, only for an athlete it is linked to: an Admin and a Viewer are sent away, another athlete is not found", async () => {
    putFile(SEND_PATH);
    for (const who of [OWNER_ID, MEMBER_ID]) {
      currentUser = who;
      expect((await send(IDS.athlete, sendPdf())).redirect, who).toBe("/unauthorized");
    }
    currentUser = FAMILY_ID;
    expect((await send(IDS.athleteTransfer, sendPdf())).notFound).toBe(true);
    expect(writes).toEqual([]);
  });

  // Planted: imported runExtractionPipeline into the action; the import
  // check failed. Reverted.
  it("the action writes only through family_send_document and imports no model, pipeline or budget", () => {
    const src = stripLineComments(read(ACTION));
    expect(src).toMatch(/\.rpc\(\s*"family_send_document"/);
    // The bucket is read back (storage.from); the table is never touched.
    expect(src).not.toMatch(/(?<!storage)\.from\(\s*"documents"\s*\)/);
    expect(src).not.toMatch(/\.(insert|upsert|delete)\(|\.update\(\s*\{/);
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(imports.filter((i) => i.includes("docai/"))).toEqual(["@/lib/docai/acceptance"]);
    for (const i of [...imports, ...[...stripLineComments(read(FORM)).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!)]) {
      expect(i).not.toMatch(/docai\/pipeline|stubCaller|anthropicCaller|docaiUsage|docaiBudget|applyExtraction|actions\/documents/);
    }
  });

  // Planted: added board_document to the list the SQL accepts; the two
  // lists disagreed. Reverted.
  it("the SQL function and the app agree: the family's types, the folder, the owner, the link, filed and Needs Review, signed in only", () => {
    const sql = stripSqlComments(read(M66));
    const fn = sql.match(/create or replace function public\.family_send_document\([\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/p_athlete not in \(select private\._family_athlete_ids\(\)\)/);
    expect(fn).toMatch(/o\.owner = caller/);
    expect(fn).toMatch(/'filed', 'needs_review'/);
    expect(fn).toMatch(/perform private\.log_family_document_sent\(doc_id\)/);
    expect(fn).not.toMatch(/insert into public\.activity_log/);
    const listed = fn.match(/clean_type not in \(([^)]*)\)/)?.[1]?.match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
    expect(listed).toEqual(FAMILY_SEND_TYPES.map((t) => t.id));
    expect(listed).not.toContain("board_document");
    expect(fn).toContain("'/family/' || p_athlete::text || '_[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$'");
    expect(sql).toMatch(/revoke execute on function public\.family_send_document\([^)]*\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.family_send_document\([^)]*\) to authenticated;/);
    expect(sql).toMatch(/revoke execute on function private\.log_family_document_sent\(uuid\) from public, anon, authenticated;/);
    // The family folder: the request folder starts with a linked athlete.
    const policy = sql.match(/create policy documents_bucket_family_insert on storage\.objects\s+for insert\s+with check\s*\(([\s\S]*?)\);/)?.[1] ?? "";
    expect(policy).toMatch(/split_part\(\(storage\.foldername\(name\)\)\[3\], '_', 1\) in \(select athlete_id::text from private\._family_athlete_ids\(\)/);
    // The app's path rule is the same shape.
    expect(isFamilySendPathFor(SEND_PATH, BRIDGE_ID, IDS.athlete)).toBe(true);
    expect(isFamilySendPathFor(SEND_PATH, BRIDGE_ID, IDS.athleteTransfer)).toBe(false);
    expect(isFamilySendPathFor(`${BRIDGE_ID}/family/req_law/x.pdf`, BRIDGE_ID, IDS.athlete)).toBe(false);
    expect(isFamilySendPathFor(familySendPath(BRIDGE_ID, IDS.athlete, "r", "x.docx") ?? "", BRIDGE_ID, IDS.athlete)).toBe(false);
  });

  // Planted: dropped the owner check from the fake; the stranger's file
  // was filed. Reverted.
  it("the function's mirror refuses with the database's codes and writes nothing", async () => {
    const client = (who: string | null) => createFakeClient(data, { userId: who, recorded: writes });
    const call = (who: string | null, args: Record<string, unknown>) =>
      client(who).rpc("family_send_document", { p_athlete: IDS.athlete, p_file_name: "x.pdf", p_file_size: 100, p_media_type: "application/pdf", p_storage_path: SEND_PATH, ...args });
    putFile(SEND_PATH);
    const theirs = putFile(familySendPath(BRIDGE_ID, IDS.athlete, "req_theirs", "x.pdf")!, PDF, OWNER_ID);
    expect(codeOf(await call(null, {}))).toBe("42501");
    expect(codeOf(await call(OWNER_ID, {}))).toBe("42501");
    expect(codeOf(await call(FAMILY_ID, { p_athlete: IDS.athleteTransfer }))).toBe("42501");
    expect(codeOf(await call(FAMILY_ID, { p_storage_path: theirs }))).toBe("23514");
    expect(codeOf(await call(FAMILY_ID, { p_storage_path: `${BRIDGE_ID}/family/req_law/x.pdf` }))).toBe("23514");
    expect(codeOf(await call(FAMILY_ID, { p_type: "board_document" }))).toBe("23514");
    expect(codeOf(await call(FAMILY_ID, { p_media_type: "text/plain" }))).toBe("23514");
    expect(codeOf(await call(FAMILY_ID, { p_note: "x".repeat(4001) }))).toBe("23514");
    expect(writes).toEqual([]);
  });
});

describe("LAW: Read Again reads an Athlete's upload when an Admin asks, and charges as usual", () => {
  // Planted: put the filed refusal back into readDocumentAgain; the
  // filed assignment file was refused. Reverted.
  it("a filed assignment file, with no format or original_paths on its row, is read again into Needs Review", async () => {
    const filed = data.documents.find((d) => d.id === IDS.documentFiled)!;
    expect(filed.status).toBe("filed");
    const html = text(await docPage(IDS.documentFiled));
    expect(html).toMatch(/Athlete Upload/);
    expect(html).toMatch(/Read Again/);
    expect(html).not.toMatch(/filed, not read/);
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    const r = await run(() => readDocumentAgain(ORG_WITH_MODULES, IDS.documentFiled));
    expect(r.redirect).toBe(`/org/${ORG_WITH_MODULES}/documents/${IDS.documentFiled}`);
    expect(filed.status).not.toBe("filed");
    expect(filed.lifecycle).toBe("needs_review");
    expect(writes.some((w) => w.table === "activity_log" && (w.rows[0] as { action?: string }).action === "document_reading")).toBe(true);
  });

  // Planted: skipped the budget check for a filed document; the reading
  // went ahead with the month's budget used up. Reverted.
  it("with a model connected, a filed upload goes through the month's budget like any reading", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    try {
      data.orgs[0]!.docai_budget_cents = 0;
      const { readDocumentAgain } = await import("@/lib/actions/documents");
      const r = await run(() => readDocumentAgain(ORG_WITH_MODULES, IDS.documentFiled));
      expect(r.redirect).toMatch(/reading budget .* is used up/);
      expect(data.documents.find((d) => d.id === IDS.documentFiled)!.status).toBe("filed");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe("LAW: the screens offer the send to the Athlete login and nobody else, and show staff what was sent", () => {
  // Planted: removed the Send a Document row from the athlete page; the
  // link check failed. Reverted.
  it("the Athlete login's athlete page links to the send screen, which carries the file, the type and the note", async () => {
    currentUser = FAMILY_ID;
    const home = await render("@/app/org/[slug]/family/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(home).toContain(`href="/org/${ORG_WITH_MODULES}/family/${IDS.athlete}/documents/new"`);
    expect(home).not.toMatch(/<form/);
    const screen = await render("@/app/org/[slug]/family/[id]/documents/new/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }) });
    expect(screen).toMatch(/type="file"[^>]*accept="application\/pdf,image\/jpeg,image\/png"|accept="application\/pdf,image\/jpeg,image\/png"[^>]*type="file"/);
    expect(screen).toMatch(/name="docType"/);
    expect(screen).toMatch(/name="note"/);
    expect(screen).not.toMatch(/value="board_document"/);
  });

  // Planted: dropped requireFamily from the send screen; the Admin saw it.
  // Reverted.
  it("the send screen is not an Admin's or a Viewer's, and not for another athlete", async () => {
    for (const who of [OWNER_ID, MEMBER_ID]) {
      currentUser = who;
      const r = await run(() => render("@/app/org/[slug]/family/[id]/documents/new/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }) }));
      expect(r.redirect, who).toBe("/unauthorized");
    }
    currentUser = FAMILY_ID;
    expect((await run(() => render("@/app/org/[slug]/family/[id]/documents/new/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athleteTransfer }) }))).notFound).toBe(true);
  });

  // Planted: removed the note from the document screen; "Their Note"
  // was missing. Reverted.
  it("a document sent outside an assignment reads as an Athlete Upload, sent by the Athlete login, with its note and Read Again", async () => {
    currentUser = FAMILY_ID;
    putFile(SEND_PATH);
    await send(IDS.athlete, sendPdf());
    const id = String(data.documents.at(-1)!.id);
    currentUser = OWNER_ID;
    const html = text(await docPage(id));
    expect(html).toMatch(/Athlete Upload/);
    expect(html).toMatch(/Sent by the Athlete Login/);
    expect(html).toMatch(/Their Note The fall report\./);
    expect(html).toMatch(/Read Again/);
    expect(html).toMatch(/Transcript/);
  });
});

// ── Piece 6 ──────────────────────────────────────────────────────────

describe("LAW: the document screen shows what a stored file holds, page by page, to staff", () => {
  // Planted: let inlineMediaTypeOf answer for every known format; the
  // Word case failed here and in the route law. Reverted.
  it("the pure rules: which pages show how, what is served inline, and the cap", () => {
    expect(previewKindOf("jpg", "a.jpg")).toBe("photo");
    expect(previewKindOf("png", "a.png")).toBe("photo");
    expect(previewKindOf("pdf", "a.pdf")).toBe("pdf");
    for (const n of ["a.docx", "a.xlsx", "a.csv", "a.txt"]) expect(previewKindOf(null, n), n).toBe("text");
    for (const n of ["a.doc", "a.xls"]) expect(previewKindOf(null, n), n).toBe("none");
    expect(inlineMediaTypeOf("o/r/1-a.pdf")).toBe("application/pdf");
    expect(inlineMediaTypeOf("o/r/1-a.JPEG")).toBe("image/jpeg");
    expect(inlineMediaTypeOf("o/r/1-a.png")).toBe("image/png");
    for (const n of ["o/r/1-a.docx", "o/r/1-a.csv", "o/r/1-a.txt", "o/r/1-a.html", "o/r/noext"]) expect(inlineMediaTypeOf(n), n).toBeNull();
    expect(storedFormatOf(null, "application/pdf")).toBe("pdf");
    expect(storedFormatOf("word", "application/pdf")).toBe("word");
    const long = capPreviewText("x".repeat(5000));
    expect(long.cut).toBe(true);
    expect(long.total).toBe(5000);
    expect(capPreviewText("short").cut).toBe(false);
  });

  // Planted: made inline unconditional; the Word file was served inline.
  // Reverted.
  it("the download route serves a PDF or a photo inline only when asked, never anything else, and still only to staff", async () => {
    const { GET } = await import("@/app/org/[slug]/documents/[id]/download/route");
    const get = (id: string, query: string) => GET(new NextRequest(`http://localhost/org/${ORG_WITH_MODULES}/documents/${id}/download${query}`), { params: P({ slug: ORG_WITH_MODULES, id }) });
    const pdf = await get("doc-mismatch", "?n=1&inline=1");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toMatch(/^inline; /);
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await get("doc-mismatch", "?n=1")).headers.get("content-disposition")).toMatch(/^attachment; /);
    expect((await get("doc-word", "?n=1&inline=1")).headers.get("content-disposition")).toMatch(/^attachment; /);
    for (const who of [MEMBER_ID, FAMILY_ID, null]) {
      currentUser = who;
      expect((await get("doc-mismatch", "?n=1&inline=1")).status, String(who)).toBe(404);
    }
  });

  // Planted: removed the previews from the Original File section; every
  // case below failed. Reverted.
  it("a photo shows on the page, a PDF opens in the browser, a Word file shows the reader's text, each page its own", async () => {
    const photo = putFile(`${BRIDGE_ID}/req_photo/1-scan.jpg`, JPEG, OWNER_ID);
    addDoc("doc-photo-law", { file_name: "scan.jpg", media_type: "image/jpeg", format: "jpg", original_paths: [photo], storage_paths: [photo] });
    const photoHtml = await docPage("doc-photo-law");
    expect(photoHtml).toMatch(new RegExp(`<img src="/org/${ORG_WITH_MODULES}/documents/doc-photo-law/download\\?n=1&amp;inline=1" alt="scan\\.jpg"`));

    const pdfHtml = await docPage("doc-mismatch");
    expect(pdfHtml).toMatch(new RegExp(`<a href="/org/${ORG_WITH_MODULES}/documents/doc-mismatch/download\\?n=1&amp;inline=1" target="_blank" rel="noopener noreferrer"[^>]*>Open the File</a>`));

    const wordHtml = text(await docPage("doc-word"));
    expect(wordHtml).toMatch(/What the Reader Sees/);

    const second = putFile(`${BRIDGE_ID}/req_pages/2-page.pdf`, PDF, OWNER_ID);
    const first = putFile(`${BRIDGE_ID}/req_pages/1-page.jpg`, JPEG, OWNER_ID);
    addDoc("doc-pages-law", { file_name: "page.jpg", media_type: "image/jpeg", format: "jpg", original_paths: [first, second], storage_paths: [first, second] });
    const pages = await docPage("doc-pages-law");
    expect(pages).toMatch(/<img src="[^"]*download\?n=1&amp;inline=1" alt="page\.jpg Page 1"/);
    expect(pages).toMatch(/download\?n=2&amp;inline=1"[^>]*>Open Page 2</);
  });

  // Planted: raised the cap past the file's length so the whole text
  // went out; the characters line was missing. Reverted.
  it("a long text file is capped on the screen and says how much is shown", async () => {
    const long = Array.from({ length: 600 }, (_, i) => `Line ${i} of the old notes.`).join("\n");
    const path = putFile(`${BRIDGE_ID}/req_long/1-long.txt`, Buffer.from(long), OWNER_ID);
    addDoc("doc-long-law", { file_name: "long.txt", media_type: "text/plain", format: "txt", original_paths: [path], storage_paths: [path] });
    const html = text(await docPage("doc-long-law"));
    expect(html).toMatch(/What the Reader Sees/);
    expect(html).toMatch(/The first 4,000 of [\d,]+ characters\. Download for the rest\./);
    expect(html).not.toMatch(/Line 599 of the old notes/);
  });

  // Planted: dropped requireRole from the document screen; the Viewer
  // saw the previews. Reverted.
  it("the document screen is staff only: a Viewer and an Athlete login are sent away", async () => {
    for (const who of [MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      const r = await run(() => docPage("doc-word"));
      expect(r.redirect, who).toBe("/unauthorized");
    }
  });
});

// The shape of the files this law reads, so a rename is caught here.
it("the files named above exist", () => {
  for (const f of [M66, ACTION, FORM]) expect(statSync(f).isFile()).toBe(true);
  expect(readdirSync(join(ROOT, "scripts/down"))).toContain("0066_family_sends_document_down.sql");
});
