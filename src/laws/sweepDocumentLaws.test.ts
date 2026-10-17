// The document sweep (2026-10-13): defects found on the document screens,
// the Delete and Undo paths and the Word and Excel reader. Each law was
// planted and seen to fail; the plant is named beside it.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { CONTRADICTION_PREFIX } from "@/lib/docai/identity";

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
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes, serviceRole: true }) }));
// The stand-in reader, with a hook a law can run while a reading is in
// flight (a person discarding the document meanwhile).
vi.mock("@/lib/docai/stubCaller", async (importOriginal) => {
  const real = (await importOriginal()) as { createStubCaller: (o: unknown) => (c: unknown) => Promise<unknown> };
  return {
    ...real,
    createStubCaller: (opts: unknown) => {
      const call = real.createStubCaller(opts);
      return async (c: unknown) => {
        const hook = (globalThis as { __sweepDuringRead?: () => void }).__sweepDuringRead;
        if (hook) hook();
        return call(c);
      };
    },
  };
});

beforeEach(() => {
  writes = [];
  data = buildFixture();
  delete process.env.ANTHROPIC_API_KEY;
  delete (globalThis as { __sweepDuringRead?: () => void }).__sweepDuringRead;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
});

const P = <T>(v: T) => Promise.resolve(v);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const doc = (id: string) => data.documents.find((d) => d.id === id)!;
const bridge = () => data.orgs[0]!.id as string;
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
const page = (id: string) => render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id }), searchParams: P({}) }).then(text);
const listPage = () => render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }).then(text);

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

// A document waiting in review, read by the model, cloned off the
// fixture's own so every column the screen reads is there.
function addDoc(id: string, over: Record<string, unknown>): Record<string, unknown> {
  const base = structuredClone(doc(IDS.document)) as Record<string, unknown>;
  const row = { ...base, id, athlete_id: null, linked_athlete_id: null, read_by: "claude-opus-5", candidates: [], provenance: null, triage: null, review_reason: null, lifecycle: "needs_review", ...over };
  data.documents.push(row);
  return row;
}

// ── A zip built by hand, so a law can say exactly what is inside ─────

function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(entries: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, "utf8");
    const comp = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, comp);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + comp.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(entries).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

// Verified these laws bite: read word/document.xml only (header and
// footer missing), and restored the bare <w:br/> match (the page break
// joined the two lines); each failed, reverted.
describe("LAW: a Word file is read with its headers, its body and its footers, breaks kept", () => {
  it("headers come first, footers last, and an attributed break is a new line", async () => {
    const { docxToText } = await import("@/lib/vault/textExtract");
    const bytes = zip({
      "word/document.xml": `<w:document ${W}><w:body>${para("Body One")}<w:p><w:r><w:t>Before Break</w:t><w:br w:type="page"/><w:t>After Break</w:t></w:r></w:p></w:body></w:document>`,
      "word/header2.xml": `<w:hdr ${W}>${para("Second Header")}</w:hdr>`,
      "word/header1.xml": `<w:hdr ${W}>${para("Bridge Letterhead")}</w:hdr>`,
      "word/footer1.xml": `<w:ftr ${W}>${para("Page Footer")}</w:ftr>`,
    });
    const text = docxToText(bytes);
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toEqual(["Bridge Letterhead", "Second Header", "Body One", "Before Break", "After Break", "Page Footer"]);
  });
});

const sheetXml = (rows: string) => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

// Verified these laws bite: ignored the style index (the date came out
// as 45292), and mapped sheet names by position again (the names were
// swapped); each failed, reverted.
describe("LAW: an Excel date reads as a date, and every sheet keeps its own name", () => {
  it("built-in and custom date formats come out as YYYY-MM-DD; plain numbers and elapsed times stay numbers", async () => {
    const { xlsxToText } = await import("@/lib/vault/textExtract");
    const bytes = zip({
      "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Colleges" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/styles.xml": `<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="d\\-mmm\\-yy"/><numFmt numFmtId="165" formatCode="[h]:mm"/></numFmts><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="4"/></cellXfs></styleSheet>`,
      "xl/worksheets/sheet1.xml": sheetXml(`<row r="1"><c r="A1" s="1"><v>45292</v></c><c r="B1" s="2"><v>45306</v></c><c r="C1" s="3"><v>1.5</v></c><c r="D1" s="4"><v>1250</v></c><c r="E1"><v>3.8</v></c></row>`),
    });
    const text = xlsxToText(bytes);
    expect(text).toContain("2024-01-01 | 2024-01-15 | 1.5 | 1250 | 3.8");
  });

  it("the 1904 date system is honoured", async () => {
    const { excelSerialToDate } = await import("@/lib/vault/textExtract");
    expect(excelSerialToDate(0, true)).toBe("1904-01-01");
    expect(excelSerialToDate(1, false)).toBe("1900-01-01");
    expect(excelSerialToDate(61, false)).toBe("1900-03-01");
  });

  it("sheet names follow the workbook's relationships, not the file numbering", async () => {
    const { xlsxToText } = await import("@/lib/vault/textExtract");
    const bytes = zip({
      "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Summary" sheetId="2" r:id="rId7"/><sheet name="Raw Data" sheetId="1" r:id="rId3"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId3" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Target="/xl/worksheets/sheet2.xml" Id="rId7" Type="worksheet"/></Relationships>`,
      "xl/worksheets/sheet1.xml": sheetXml(`<row r="1"><c r="A1" t="inlineStr"><is><t>raw row</t></is></c></row>`),
      "xl/worksheets/sheet2.xml": sheetXml(`<row r="1"><c r="A1" t="inlineStr"><is><t>summary row</t></is></c></row>`),
    });
    expect(xlsxToText(bytes).split("\n")).toEqual(["Sheet: Summary", "summary row", "Sheet: Raw Data", "raw row"]);
  });
});

// ── The document screen ──────────────────────────────────────────────

// Verified this law bites: put the old CATEGORY_LABEL back (no Board
// Document or Other): the headline read "other Read" and the note "A
// other is read"; failed, reverted.
describe("LAW: Board Document and Other read as their names on the document screen", () => {
  it("the headline, the note and the suggested type use the type's label", async () => {
    addDoc("doc-other", { category: "other", requested_category: null, extracted: { summary: "A note.", suggestedType: "offer_letter", documentKind: "letter" } });
    const html = await page("doc-other");
    expect(html).toMatch(/Other Read/);
    expect(html).not.toMatch(/other Read|A other|a other/);
    expect(html).toMatch(/It looks like an Offer Letter: set File As to Offer Letter/);
    addDoc("doc-board", { category: "board_document", requested_category: "board_document", extracted: { summary: "Minutes.", documentKind: "minutes" } });
    expect(await page("doc-board")).toMatch(/Board Document Read/);
  });
});

// Verified this law bites: put the transcript copy back as the fallback
// for athlete_profile: the screen told a profile's reviewer it would put
// back a GPA and date of birth; failed, reverted.
describe("LAW: an applied Athlete Profile says what discarding it really does", () => {
  it("names the position, class year, major and high school, not a transcript's GPA", async () => {
    addDoc("doc-profile", { category: "athlete_profile", status: "applied", athlete_id: IDS.athlete, extracted: { position: "SS", gradYear: 2027 } });
    const html = await page("doc-profile");
    expect(html).toMatch(/clears the position, class year, desired major and high school/);
    expect(html).not.toMatch(/previous GPA, date of birth/);
  });
});

// Verified this law bites: dropped `|| !doc.extracted` and the category
// check (Apply came back on a re-typed reading), and separately the
// error redirect out of applyAction; each failed, reverted.
describe("LAW: Apply and Discard on the document screen never swallow a refusal, and a re-typed reading offers no Apply", () => {
  it("both form wrappers send the refusal back to the page as ?error=", () => {
    const src = readFileSync("src/app/org/[slug]/documents/[id]/page.tsx", "utf8");
    const apply = src.slice(src.indexOf("const applyAction"), src.indexOf("const discardAction"));
    const discard = src.slice(src.indexOf("const discardAction"), src.indexOf("const moveTo"));
    expect(apply).toMatch(/await applyDocument\(/);
    expect(apply).toMatch(/if \(!result\.ok\) redirect\([^)]*\?error=/);
    expect(discard).toMatch(/await discardDocument\(/);
    expect(discard).toMatch(/if \(!result\.ok\) redirect\([^)]*\?error=/);
  });

  it("a reading whose type was cleared shows no Apply, and File As clears the old candidates", async () => {
    // A key set, so the reading is one the screen would offer to apply.
    process.env.ANTHROPIC_API_KEY = "test-only";
    try {
      addDoc("doc-applyable", { category: "transcript", extracted: { gpa: 3.4 }, candidates: [{ athleteId: IDS.athlete, name: "Fixture Athlete", score: 0.9, reasons: ["Name"] }] });
      expect(await page("doc-applyable")).toMatch(/\bApply\b/);
      addDoc("doc-retyped", { category: null, requested_category: "transcript", extracted: { summary: "Old Other reading." }, candidates: [{ athleteId: IDS.athlete, name: "Fixture Athlete", score: 0.9, reasons: ["Name"] }] });
      expect(await page("doc-retyped")).not.toMatch(/\bApply\b/);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
    addDoc("doc-other2", { category: "other", extracted: { summary: "x" }, candidates: [{ athleteId: IDS.athlete, name: "Fixture Athlete", score: 0.9, reasons: [] }] });
    const { fileDocumentAs } = await import("@/lib/actions/documents");
    await run(() => fileDocumentAs(ORG_WITH_MODULES, "doc-other2", form({ filedAs: "transcript" })));
    expect(doc("doc-other2")).toMatchObject({ category: null, requested_category: "transcript", candidates: [] });
  });
});

// Verified this law bites: took the failed-and-unread case off
// fileDocumentAs and the page; the File As picker vanished and the save
// was refused; failed, reverted.
describe("LAW: a reading that failed as the wrong type can be re-typed", () => {
  it("File As shows on it and saves the new type", async () => {
    expect(doc("doc-mismatch")).toMatchObject({ status: "failed", extracted: null, category: "transcript" });
    expect(await page("doc-mismatch")).toMatch(/File As/);
    const { fileDocumentAs } = await import("@/lib/actions/documents");
    const to = await run(() => fileDocumentAs(ORG_WITH_MODULES, "doc-mismatch", form({ filedAs: "test_scores" })));
    expect(to).toMatch(/notice=Type set to Test Scores\./);
    expect(doc("doc-mismatch")).toMatchObject({ requested_category: "test_scores", category: null });
  });
});

// Verified these laws bite: put isStaleProcessing(doc.created_at) back
// on the page and in discardDocument (an old upload read again a minute
// ago was called cut off and could be discarded mid-read), and dropped
// the status condition from readAndFile's write (the discarded document
// came back as pending with a reading); each failed, reverted.
describe("LAW: a reading is stuck by when it went into Processing, and a late reading never revives a discarded document", () => {
  it("an old upload read again a minute ago is still being read, and cannot be discarded", async () => {
    addDoc("doc-reread", { status: "processing", lifecycle: "processing", created_at: "2026-09-01T12:00:00.000Z", lifecycle_changed_at: new Date(Date.now() - 60_000).toISOString(), extracted: null });
    const html = await page("doc-reread");
    expect(html).toMatch(/Still Being Read/);
    expect(html).not.toMatch(/Did Not Finish/);
    const { discardDocument } = await import("@/lib/actions/documents");
    expect(await discardDocument(ORG_WITH_MODULES, "doc-reread")).toMatchObject({ ok: false, error: "That document is still being read." });
  });

  it("a document discarded while it was being read stays discarded", async () => {
    const d = doc("doc-mismatch");
    Object.assign(d, { read_by: null, status: "pending", lifecycle: "needs_review" });
    data.storage_objects!.push({ bucket: "documents", name: (d.original_paths as string[])[0]!, base64: Buffer.from("%PDF-1.4\n%b\n1 0 obj << >> endobj\n%%EOF\n").toString("base64") });
    (globalThis as { __sweepDuringRead?: () => void }).__sweepDuringRead = () => {
      Object.assign(doc("doc-mismatch"), { status: "discarded", lifecycle: "archived" });
    };
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-mismatch"));
    expect(doc("doc-mismatch")).toMatchObject({ status: "discarded", lifecycle: "archived", extracted: null });
  });
});

// Verified this law bites: passed priorReading: doc.extracted again; the
// re-read transcript was flagged as contradicting the Other reading it
// replaced; failed, reverted.
describe("LAW: Read Again compares only against a reading of the same type", () => {
  it("a reading of another type is not called a contradiction", async () => {
    const d = doc("doc-mismatch");
    Object.assign(d, { read_by: null, status: "pending", lifecycle: "needs_review", category: null, requested_category: "transcript", extracted: { studentName: "Somebody Else Entirely", school: "Another School Altogether", summary: "An Other reading." } });
    data.storage_objects!.push({ bucket: "documents", name: (d.original_paths as string[])[0]!, base64: Buffer.from("%PDF-1.4\n%b\n1 0 obj << >> endobj\n%%EOF\n").toString("base64") });
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-mismatch"));
    const after = doc("doc-mismatch");
    expect(after.category).toBe("transcript");
    const warnings = ((after.extracted as { warnings?: string[] } | null)?.warnings ?? []).join(" ");
    expect(warnings).not.toContain(CONTRADICTION_PREFIX);
  });
});

// ── Undo ────────────────────────────────────────────────────────────

// Verified this law bites: put the fixed "gpa, gpa_verified,
// date_of_birth" select back in undoApply; the position was kept as
// "changed since"; failed, reverted.
describe("LAW: discarding an applied profile puts the position back", () => {
  it("re-reads exactly the columns the apply wrote", async () => {
    const athlete = data.athletes!.find((a) => a.id === IDS.athlete)!;
    athlete.position = "SS";
    addDoc("doc-profile-undo", { category: "athlete_profile", status: "applied", athlete_id: IDS.athlete, extracted: { position: "SS" }, applied_changes: { athleteId: IDS.athlete, athleteFields: { position: { before: null, after: "SS" } }, gradingScaleId: null, coursesSuperseded: 0 } });
    const { discardDocument } = await import("@/lib/actions/documents");
    const r = await discardDocument(ORG_WITH_MODULES, "doc-profile-undo");
    expect(r.ok).toBe(true);
    expect(r.undone!.join(" ")).toMatch(/previous position/);
    expect(data.athletes!.find((a) => a.id === IDS.athlete)!.position).toBeNull();
  });
});

// Verified this law bites: compared JSON.stringify of the two again; an
// aid that came back with its keys reordered was kept as changed;
// failed, reverted.
describe("LAW: undoing an award restores the aid whatever order Postgres keeps its keys in", () => {
  it("the same aid with its keys reordered is still what the document wrote", async () => {
    const after = { netCost: 21000, awards: [{ type: "grant", name: "Grant", amount: 5000, renewable: null }], documentId: "d1", academicYear: "2026-27" };
    const reordered = { academicYear: "2026-27", documentId: "d1", awards: [{ renewable: null, amount: 5000, name: "Grant", type: "grant" }], netCost: 21000 };
    const target = data.recruiting_targets!.find((t) => t.id === IDS.target)!;
    target.aid = reordered;
    const { undoTarget } = await import("@/lib/data/applyExtraction");
    const client = createFakeClient(data, { userId: OWNER_ID, recorded: writes });
    const done = await undoTarget(client as never, bridge(), { id: IDS.target, created: false, before: { aid: null }, after: { aid: after } });
    expect(done.join(" ")).toMatch(/Put back the college's previous aid/);
    expect(data.recruiting_targets!.find((t) => t.id === IDS.target)!.aid).toBeNull();
    const { sameJsonValue } = await import("@/lib/data/undoPlan");
    expect(sameJsonValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameJsonValue({ a: 1, b: [1, 2] }, { b: [2, 1], a: 1 })).toBe(false);
    expect(sameJsonValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});

// ── Delete ──────────────────────────────────────────────────────────

// Verified this law bites: dropped includeFamily from deleteDocument's
// cleanup; the family file stayed in the bucket; failed, reverted.
describe("LAW: deleting a family upload takes its file out of the family folder, and only this org's", () => {
  it("removes <org>/family/<request>/<file> and leaves another org's family file alone", async () => {
    const own = `${bridge()}/family/req_fam1/essay.pdf`;
    const other = `${data.orgs[1]!.id as string}/family/req_fam1/essay.pdf`;
    for (const name of [own, other]) data.storage_objects!.push({ bucket: "documents", name, base64: "eA==" });
    addDoc("doc-family", { status: "filed", storage_paths: [own, other], original_paths: [own] });
    const { deleteDocument } = await import("@/lib/actions/documents");
    expect(await run(() => deleteDocument(ORG_WITH_MODULES, "doc-family"))).toMatch(/notice=Deleted/);
    expect(data.storage_objects!.some((o) => o.name === own)).toBe(false);
    expect(data.storage_objects!.some((o) => o.name === other)).toBe(true);
  });
});

// ── Title Case and the list ──────────────────────────────────────────

// Verified this law bites: put "Not sure who this is", "Grad year",
// "Why it stopped" and "Medium confidence" back; failed, reverted. And
// put " · no match" back on a reference row; failed, reverted.
describe("LAW: the document screens' titles are Title Case, and a reference reading never says no match", () => {
  it("the headline, section labels, confidence row and field rows", async () => {
    addDoc("doc-nomatch", { category: "transcript", extracted: { gpa: 3.4, gradYear: 2027, courseLoad: "Honors" }, provenance: { confidence: 0.5 } });
    const html = await page("doc-nomatch");
    expect(html).toMatch(/Not Sure Who This Is/);
    expect(html).toMatch(/Grad Year/);
    expect(html).toMatch(/Course Load/);
    expect(html).toMatch(/Why It Stopped/);
    expect(html).toMatch(/Medium Confidence/);
    // Words stay apart (live test D2): "came from you. That is not enough".
    expect(html).toMatch(/and it came from [A-Za-z ]+\./);
    expect(html).not.toMatch(/That is not enough/);
    const { titleCase } = await import("@/lib/copy/titleCase");
    const src = readFileSync("src/app/org/[slug]/documents/[id]/page.tsx", "utf8");
    const labels = src.slice(src.indexOf("const FIELD_LABEL"), src.indexOf("};", src.indexOf("const FIELD_LABEL")));
    for (const m of labels.matchAll(/:\s*"([^"]+)"/g)) expect(titleCase(m[1]!)).toBe(m[1]);
  });

  it("a Board Document or Other row on the list carries no no-match tail", async () => {
    addDoc("doc-other-list", { category: "other", file_name: "notes.pdf", extracted: { summary: "x" } });
    const html = await listPage();
    expect(html).toMatch(/Other/);
    expect(html).not.toMatch(/Other · no match/i);
  });
});

// ── Smaller defects ─────────────────────────────────────────────────

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

describe("LAW: Read Again, Apply and the upload's reasons tell the truth", () => {
  // Verified: read original_paths again for a photo; the reread failed
  // when only the reader copy was there; failed, reverted.
  it("Read Again reads a photo from its reader copy", async () => {
    const orig = `${bridge()}/req_photo/1-scan.png`;
    const copy = `${bridge()}/req_photo/reader-1-scan.png`;
    data.storage_objects!.push({ bucket: "documents", name: copy, base64: JPEG.toString("base64") });
    addDoc("doc-photo", { file_name: "scan.png", media_type: "image/png", format: "png", category: "transcript", requested_category: "transcript", extracted: null, status: "pending", read_by: null, original_paths: [orig], storage_paths: [copy] });
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    const to = await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-photo"));
    expect(to).toBe(`/org/${ORG_WITH_MODULES}/documents/doc-photo`);
    expect(doc("doc-photo").extracted).not.toBeNull();
  });

  // Verified: removed the export; failed, reverted.
  it("the document page allows a model call's time, as the upload page does", async () => {
    const mod = (await import("@/app/org/[slug]/documents/[id]/page")) as { maxDuration?: number };
    expect(mod.maxDuration).toBe(300);
  });

  // Verified: removed the reference guard; the Other reading was claimed
  // as applied; failed, reverted.
  it("Apply refuses a Board Document or Other reading", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    try {
      addDoc("doc-other-apply", { category: "other", extracted: { summary: "x" } });
      const { applyDocument } = await import("@/lib/actions/documents");
      const r = await applyDocument(ORG_WITH_MODULES, "doc-other-apply", IDS.athlete);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/read for a person/);
      expect(doc("doc-other-apply").status).toBe("pending");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  // Verified: put "No type chosen." back; failed, reverted.
  it("an untyped photo the browser could not prepare is not said to have no type", async () => {
    const path = `${bridge()}/req_np/1-photo.jpg`;
    data.storage_objects!.push({ bucket: "documents", name: path, base64: JPEG.toString("base64") });
    const { processDocument } = await import("@/lib/actions/documents");
    const r = await processDocument(ORG_WITH_MODULES, { originals: [{ storagePath: path, name: "photo.jpg", reader: null }], sourceRole: "coordinator", requestedCategory: null } as never);
    expect(r.ok).toBe(true);
    const row = doc(r.documentId!);
    expect(row.review_reason).not.toBe("No type chosen.");
    expect(row.review_reason).toMatch(/Read Again/);
  });

  // Verified: put the extracted.studentName fallback back for a removed
  // linked athlete; the list named the person read off the page; failed,
  // reverted.
  it("a document linked to a removed athlete says so on the list, not the name read off it", async () => {
    const athlete = data.athletes!.find((a) => a.id === IDS.athleteNoGpa)!;
    athlete.deleted_at = "2026-10-01T00:00:00.000Z";
    addDoc("doc-linked-gone", { category: "transcript", linked_athlete_id: IDS.athleteNoGpa, extracted: { studentName: "Name Read Off The Page" } });
    const html = await listPage();
    expect(html).not.toMatch(/Name Read Off The Page/);
    expect(html).toMatch(/Transcript · Removed Athlete/);
  });
});
