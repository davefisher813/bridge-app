// The second access sweep (2026-10-13): who may fetch a person's photo,
// what an Athlete login may write in the documents bucket, the database
// functions an audit suspected, where Not Authorized sends a signed-in
// person, Read Again and Download on a document of mixed files, and the
// Excel reader on a namespace-prefixed workbook. The database half of
// items 2 to 4 is proven against a real Postgres in scripts/rls_test.sql
// (the 0068 block). Each law was planted and seen to fail; the plant is
// named beside it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { FIXTURE_PHOTO_BASE64 } from "@/testing/fixturePhoto";
import { makeZip } from "@/testing/vaultFiles";
import { xlsxToText } from "@/lib/vault/textExtract";
import { familyStoragePath, isFamilyStoragePathFor } from "@/lib/data/assignments";

const REDIRECT = "NEXT_REDIRECT:";
const MIGRATIONS = join(process.cwd(), "migrations");
let currentUser: string | null = OWNER_ID;
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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes, serviceRole: true }) }));
// The stand-in reader, recording the blocks each reading was handed.
vi.mock("@/lib/docai/stubCaller", async (importOriginal) => {
  const real = (await importOriginal()) as { createStubCaller: (o: unknown) => (c: { records?: { kind: string; mediaType: string; blockType: string; base64: string }[] }) => Promise<unknown> };
  return {
    ...real,
    createStubCaller: (opts: unknown) => {
      const call = real.createStubCaller(opts);
      return async (c: { records?: { kind: string; mediaType: string; blockType: string; base64: string }[] }) => {
        (globalThis as { __sweep2Blocks?: unknown[] }).__sweep2Blocks = (c.records ?? []).map((r) => ({ kind: r.kind, mediaType: r.mediaType, blockType: r.blockType, base64: r.base64 }));
        return call(c);
      };
    },
  };
});

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  delete process.env.ANTHROPIC_API_KEY;
  delete (globalThis as { __sweep2Blocks?: unknown[] }).__sweep2Blocks;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
});

const BRIDGE = () => data.orgs[0]!.id as string;
const P = <T>(v: T) => Promise.resolve(v);

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

// Each migration that defines a thing, in order; the last one is what a
// database built from migrations/ runs.
function lastDefinition(pattern: RegExp, until: RegExp): { file: string; text: string } {
  let found: { file: string; text: string } | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const m of sql.matchAll(new RegExp(pattern.source, "g"))) {
      const rest = sql.slice(m.index!);
      const end = rest.search(until);
      found = { file, text: end < 0 ? rest : rest.slice(0, end) };
    }
  }
  if (!found) throw new Error(`no migration defines ${pattern}`);
  return found;
}

// ── 1. A person's photo ─────────────────────────────────────────────

// Planted: put back "any signed-in member of the org" in the photo
// route: the Viewer and Athlete login fetching each other's photo got a
// 200; failed, reverted.
describe("LAW: a Viewer or Athlete login fetches only its own photo and the Admins'; an Admin fetches anyone's", () => {
  function givePhoto(userId: string): void {
    const path = `${BRIDGE()}/${userId}/1791800000.jpg`;
    data.org_members!.find((m) => m.org_id === BRIDGE() && m.user_id === userId)!.photo_path = path;
    data.storage_objects!.push({ bucket: "member-photos", name: path, base64: FIXTURE_PHOTO_BASE64 });
  }
  async function get(userId: string) {
    const { GET } = await import("@/app/org/[slug]/members/[userId]/photo/route");
    return (await GET(new NextRequest(`http://localhost/org/${ORG_WITH_MODULES}/members/${userId}/photo`), { params: P({ slug: ORG_WITH_MODULES, userId }) })).status;
  }
  beforeEach(() => {
    givePhoto(MEMBER_ID);
    givePhoto(FAMILY_ID);
  });

  it("an Admin fetches the photo of an Admin, a Viewer and an Athlete login", async () => {
    currentUser = OWNER_ID;
    for (const who of [OWNER_ID, MEMBER_ID, FAMILY_ID]) expect(await get(who), String(who)).toBe(200);
  });

  it("a Viewer and an Athlete login fetch their own photo and the Admin's (Who to Ask)", async () => {
    for (const me of [MEMBER_ID, FAMILY_ID]) {
      currentUser = me;
      expect(await get(me), `${me} own`).toBe(200);
      expect(await get(OWNER_ID), `${me} admin`).toBe(200);
    }
  });

  it("a Viewer cannot fetch an Athlete login's photo, nor the other way round, and the answer is the same 404", async () => {
    currentUser = MEMBER_ID;
    expect(await get(FAMILY_ID)).toBe(404);
    currentUser = FAMILY_ID;
    expect(await get(MEMBER_ID)).toBe(404);
  });
});

// ── 2. applied_migrations ───────────────────────────────────────────

// Not a defect: 0057 already answers no rows unless the caller is owner
// or staff of some org. Planted: removed the private._staff_org_ids()
// check from the function body: failed, reverted. The RLS suite proves
// it on Postgres against a stand-in history table.
describe("LAW: applied_migrations answers an Admin of some org and nobody else", () => {
  it("the function the migrations build checks the caller is owner or staff before reading anything", () => {
    const def = lastDefinition(/create or replace function public\.applied_migrations\(\)/, /\nend \$\$;/);
    const check = def.text.indexOf("private._staff_org_ids()");
    const read = def.text.indexOf("supabase_migrations.schema_migrations");
    expect(check, def.file).toBeGreaterThan(-1);
    expect(check).toBeLessThan(read);
    expect(def.text).toMatch(/if not exists \(select 1 from private\._staff_org_ids\(\)\) then\s+return;/);
  });
});

// ── 3. log_family_message ───────────────────────────────────────────

// Not a defect: 0044 already requires a message from the caller on the
// athlete newer than their last logged one. Planted: removed the
// athlete_messages check: failed, reverted.
describe("LAW: log_family_message writes a line only for a message that exists and is not yet logged", () => {
  it("the function the migrations build refuses a caller with no unlogged message", () => {
    const def = lastDefinition(/create or replace function public\.log_family_message\(/, /\nend \$\$;/);
    expect(def.text).toMatch(/if not exists \(\s*select 1 from public\.athlete_messages m\s+where m\.athlete_id = p_athlete and m\.author_id = caller/);
    expect(def.text).toMatch(/l\.action = 'message_sent'/);
    expect(def.text).toMatch(/raise exception 'log_family_message: no unlogged message/);
    // No text parameter: nothing the caller sends reaches the summary.
    expect(def.text).toMatch(/log_family_message\(p_athlete uuid\)/);
  });
});

// ── 4. The family upload folder ─────────────────────────────────────

// Planted: dropped the _family_upload_folders clause from 0068's policy:
// the policy law failed (and the RLS suite's made-up folder was written);
// put newRequestId() back in AssignmentSubmitForm: the form law failed;
// reverted.
describe("LAW: an Athlete login uploads only into a folder it can account for", () => {
  it("the family insert policy the migrations build ties the folder to the caller's own assignment or athlete", () => {
    const def = lastDefinition(/create policy documents_bucket_family_insert on storage\.objects/, /\);\n/);
    expect(def.file >= "0068").toBe(true);
    expect(def.text).toMatch(/private\._family_upload_folders\(\)/);
    expect(def.text).toMatch(/f\.org_id::text = \(storage\.foldername\(name\)\)\[1\]/);
    expect(def.text).toMatch(/f\.folder = \(storage\.foldername\(name\)\)\[3\]/);
    // What 0048 required stays.
    expect(def.text).toMatch(/\(storage\.foldername\(name\)\)\[2\] = 'family'/);
    expect(def.text).toMatch(/\\\.\(pdf\|jpe\?g\|png\)\$/);
    const helper = lastDefinition(/create or replace function private\._family_upload_folders\(\)/, /\n\$\$;/).text;
    expect(helper).toMatch(/from public\.assignments a/);
    expect(helper).toMatch(/private\._family_athlete_ids\(\)/);
    expect(helper).toMatch(/deleted_at is null/);
  });

  it("the assignment form uploads under the assignment's own id, with a stamp so a resubmission does not collide", () => {
    const src = readFileSync(join(process.cwd(), "src/components/AssignmentSubmitForm.tsx"), "utf8");
    expect(src).toMatch(/familyStoragePath\(orgId, assignmentId, file\.name, newUploadStamp\(\)\)/);
    const org = "00000000-0000-0000-0000-000000000010";
    const a = familyStoragePath(org, IDS.athlete, "Report Card.pdf", "1791800000_ab12cd");
    expect(a).toBe(`${org}/family/${IDS.athlete}/1791800000_ab12cd-Report_Card.pdf`);
    expect(isFamilyStoragePathFor(a!, org)).toBe(true);
    expect(familyStoragePath(org, IDS.athlete, "a.pdf", "../x")).toBeNull();
  });
});

// ── 5. Not Authorized ───────────────────────────────────────────────

// Planted: put back the one "Back to the Start" link to "/": the Viewer
// and Athlete login hrefs were missing; failed, reverted.
describe("LAW: Not Authorized sends a signed-in person to their own home, and still works signed out", () => {
  async function html(): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = await import("@/app/unauthorized/page");
    return renderToStaticMarkup(await mod.default());
  }

  it("an Athlete login is offered its family home", async () => {
    currentUser = FAMILY_ID;
    const out = await html();
    expect(out).toContain(`href="/org/${ORG_WITH_MODULES}/family"`);
    expect(out).not.toContain('href="/"');
  });

  it("a Viewer in two orgs is offered the Viewer home in each", async () => {
    currentUser = MEMBER_ID;
    const out = await html();
    expect(out).toContain(`href="/org/${ORG_WITH_MODULES}/member"`);
    expect(out).toContain('href="/org/elite-fixture/member"');
  });

  it("an Admin is offered Today; nobody signed in is offered the start", async () => {
    currentUser = OWNER_ID;
    expect(await html()).toContain(`href="/org/${ORG_WITH_MODULES}"`);
    currentUser = null;
    expect(await html()).toContain('href="/"');
  });
});

// ── 6. Read Again and Download on a document of mixed files ─────────

const PDF = Buffer.from("%PDF-1.4\n%b\n1 0 obj << >> endobj\n%%EOF\n");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const DOCX = Buffer.from(makeZip({ "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Mixed Letter Body</w:t></w:r></w:p></w:body></w:document>' }));

function storeDoc(id: string, fileName: string, format: string, mediaType: string, pages: Array<{ name: string; bytes: Buffer; reader?: string }>): void {
  const original = pages.map((p) => `${BRIDGE()}/req_mixed_${id}/${p.name}`);
  const reader = pages.map((p, i) => (p.reader ? `${BRIDGE()}/req_mixed_${id}/${p.reader}` : original[i]!));
  pages.forEach((p, i) => {
    data.storage_objects!.push({ bucket: "documents", name: original[i]!, base64: p.bytes.toString("base64") });
    if (p.reader) data.storage_objects!.push({ bucket: "documents", name: reader[i]!, base64: p.bytes.toString("base64") });
  });
  const base = structuredClone(data.documents!.find((d) => d.id === IDS.document)!) as Record<string, unknown>;
  data.documents!.push({
    ...base, id, athlete_id: null, linked_athlete_id: null, read_by: null, candidates: [], provenance: null, triage: null, review_reason: null,
    lifecycle: "needs_review", status: "pending", category: "recommendation", requested_category: "recommendation", extracted: null,
    file_name: fileName, format, media_type: mediaType, original_paths: original, storage_paths: reader,
  });
}

type Block = { kind: string; mediaType: string; blockType: string; base64: string };
const blocks = () => ((globalThis as { __sweep2Blocks?: Block[] }).__sweep2Blocks ?? []);

// Planted: built every page from doc.format and doc.media_type again:
// the PDF and JPG group came back with an error and the docx and PDF
// group ran the text reader on the PDF; failed, reverted.
describe("LAW: Read Again builds each page of a document from that page's own bytes", () => {
  it("a PDF and a JPG are read as a document block and an image block", async () => {
    storeDoc("doc-mixed-photo", "letter.pdf", "pdf", "application/pdf", [
      { name: "1-letter.pdf", bytes: PDF },
      { name: "2-page.jpg", bytes: JPEG, reader: "reader-2-page.jpg" },
    ]);
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    const to = await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-mixed-photo"));
    expect(to).toBe(`/org/${ORG_WITH_MODULES}/documents/doc-mixed-photo`);
    expect(blocks().map((b) => [b.kind, b.mediaType, b.blockType])).toEqual([
      ["pdf", "application/pdf", "document"],
      ["image", "image/jpeg", "image"],
    ]);
  });

  it("a Word file and a PDF are read as the Word file's text and the PDF as a document", async () => {
    storeDoc("doc-mixed-word", "letter.docx", "word", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", [
      { name: "1-letter.docx", bytes: DOCX },
      { name: "2-scan.pdf", bytes: PDF },
    ]);
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    const to = await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-mixed-word"));
    expect(to).toBe(`/org/${ORG_WITH_MODULES}/documents/doc-mixed-word`);
    expect(blocks().map((b) => [b.kind, b.blockType])).toEqual([
      ["text", "text"],
      ["pdf", "document"],
    ]);
    expect(Buffer.from(blocks()[0]!.base64, "base64").toString("utf8")).toContain("Mixed Letter Body");
  });
});

// Planted: sent doc.media_type for every page again: page two of the
// PDF and JPG group went as application/pdf; failed, reverted.
describe("LAW: Download sends each page with its own type", () => {
  it("page one of a PDF and JPG group is a PDF, page two a JPEG", async () => {
    storeDoc("doc-mixed-download", "letter.pdf", "pdf", "application/pdf", [
      { name: "1-letter.pdf", bytes: PDF },
      { name: "2-page.jpg", bytes: JPEG },
    ]);
    const { GET } = await import("@/app/org/[slug]/documents/[id]/download/route");
    const get = (n: number) => GET(new NextRequest(`http://localhost/org/${ORG_WITH_MODULES}/documents/doc-mixed-download/download?n=${n}`), { params: P({ slug: ORG_WITH_MODULES, id: "doc-mixed-download" }) });
    const one = await get(1);
    const two = await get(2);
    expect(one.status).toBe(200);
    expect(one.headers.get("content-type")).toBe("application/pdf");
    expect(two.status).toBe(200);
    expect(two.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await two.arrayBuffer()).equals(JPEG)).toBe(true);
  });
});

// ── 7. A namespace-prefixed workbook ────────────────────────────────

// Planted: took the optional prefix back out of the row and cell
// patterns: the prefixed workbook read as its sheet name only; failed,
// reverted.
describe("LAW: the Excel reader reads a workbook whose elements carry a namespace prefix", () => {
  it("<x:si>, <x:row>, <x:c> and <x:v> read the same as the unprefixed ones", () => {
    const ns = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const bytes = makeZip({
      "xl/workbook.xml": `<x:workbook ${ns}><x:workbookPr date1904="0"/><x:sheets><x:sheet name="Grades" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`,
      "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/sharedStrings.xml": `<x:sst ${ns}><x:si><x:t>Course</x:t></x:si><x:si><x:r><x:t>Alge</x:t></x:r><x:r><x:t xml:space="preserve">bra II</x:t></x:r></x:si></x:sst>`,
      "xl/styles.xml": `<x:styleSheet ${ns}><x:cellXfs count="2"><x:xf numFmtId="0"/><x:xf numFmtId="14"/></x:cellXfs></x:styleSheet>`,
      "xl/worksheets/sheet1.xml": `<x:worksheet ${ns}><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Grade</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2"><x:v>93</x:v></x:c><x:c r="C2" s="1"><x:v>45658</x:v></x:c></x:row></x:sheetData></x:worksheet>`,
    });
    const text = xlsxToText(bytes);
    expect(text).toBe(["Sheet: Grades", "Course | Grade", "Algebra II | 93 | 2025-01-01"].join("\n"));
  });
});
