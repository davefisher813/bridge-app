// The document vault (Doc AI rebuild, Piece 1; migration 0048).
//
// Seven formats checked by extension and bytes. Originals stored as they
// came and never deleted. No file without a row and no row without a file.
// Five states, seven moves, every move logged. A file that does not look
// like its type is kept, in Needs Review, with the reason. The old six
// types still read. These are the rules as executable checks; the same
// rules are proven against a real Postgres in scripts/rls_test.sql.
//
// Each law was proven to bite: the planted violation is named beside it,
// the law failed, and the code was put back.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID, OUTSIDER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { GOOD_NAMES, makeFile, type SyntheticKind } from "@/testing/vaultFiles";
import { LIFECYCLE_STATES, TRANSITIONS, LEGACY_STATUS_TO_LIFECYCLE } from "@/lib/vault/lifecycle";
import { VAULT_FORMATS_SENTENCE, VAULT_MAX_BYTES, VAULT_MEDIA_TYPES } from "@/lib/vault/format";

const SRC = join(process.cwd(), "src");
const MIGRATIONS = join(process.cwd(), "migrations");

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let failOn: (table: string, op: string) => string | null = () => null;
let serverWrites: RecordedWrite[] = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
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
// The service role: only the cleanup helper uses it here. Its writes are
// kept apart so a law can say which client removed a file.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: { push: (...w: RecordedWrite[]) => { serverWrites.push(...w); return writes.push(...w); } } as unknown as RecordedWrite[], failOn }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  serverWrites = [];
  data = buildFixture();
  failOn = () => null;
  delete process.env.ANTHROPIC_API_KEY;
});

const ORG = () => data.orgs[0]!.id as string;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

let counter = 0;
// Puts bytes in the bucket the way the browser's upload does, and returns
// the path. Each call is a new upload folder, like a new request id.
function put(name: string, bytes: Uint8Array): string {
  counter += 1;
  const path = `${ORG()}/req_vault_${counter}/1-${name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
  data.storage_objects!.push({ bucket: "documents", name: path, base64: b64(bytes) });
  return path;
}
const inBucket = (path: string) => data.storage_objects!.some((o) => o.bucket === "documents" && o.name === path);
const docs = () => data.documents!;
const rowOf = (id: string | undefined) => docs().find((d) => d.id === id)!;
const logs = () => writes.filter((w) => w.table === "activity_log" && w.op === "insert").map((w) => w.rows[0]!);

async function upload(items: Array<{ path: string; name: string; reader?: boolean }>, category: string | null = null, extra: Record<string, unknown> = {}) {
  const { processDocument } = await import("@/lib/actions/documents");
  const originals = items.map((i) => ({
    storagePath: i.path,
    name: i.name,
    reader: i.reader
      ? {
          originalName: i.name,
          originalSize: 40,
          originalMime: "application/pdf",
          kind: "pdf" as const,
          sourceRole: "coordinator" as const,
          ingestedAt: "2026-10-08T00:00:00.000Z",
          requestId: "req_vault",
          mediaType: "application/pdf",
          blockType: "document" as const,
          storagePath: i.path,
        }
      : null,
  }));
  return processDocument(ORG_WITH_MODULES, { originals, sourceRole: "coordinator", requestedCategory: category as never, ...extra });
}

// ── 1. The seven formats ─────────────────────────────────────────────

describe("LAW: the seven formats are accepted, from their bytes, and stored as they are", () => {
  // Planted: removed the signature check from checkVaultFile (extension
  // alone decides): the mismatch laws below failed. Reverted.
  const kinds = Object.keys(GOOD_NAMES) as Array<keyof typeof GOOD_NAMES>;
  const FORMAT: Record<string, string> = { pdf: "pdf", docx: "word", doc: "word", xlsx: "excel", xls: "excel", csv: "csv", jpg: "jpg", png: "png", txt: "txt" };

  for (const kind of kinds) {
    it(`${kind}: one upload, one document in Needs Review, the bytes and their SHA-256 untouched`, async () => {
      const bytes = makeFile(kind);
      const path = put(GOOD_NAMES[kind], bytes);
      const r = await upload([{ path, name: GOOD_NAMES[kind] }]);
      expect(r.ok).toBe(true);
      const row = rowOf(r.documentId);
      expect(row).toMatchObject({
        lifecycle: "needs_review",
        format: FORMAT[kind],
        file_name: GOOD_NAMES[kind],
        file_size: bytes.length,
        content_hash: sha(bytes),
        original_paths: [path],
        uploaded_by: OWNER_ID,
        org_id: ORG(),
      });
      expect(VAULT_MEDIA_TYPES).toContain(row.media_type);
      // Not one byte of the stored object changed, and nothing was written
      // to the bucket by the server at all.
      const stored = data.storage_objects!.find((o) => o.name === path)!;
      expect(sha(Buffer.from(String(stored.base64), "base64"))).toBe(sha(bytes));
      expect(writes.filter((w) => w.table === "storage:documents")).toEqual([]);
    });
  }

  it("a large PNG the old path would have shrunk is stored exactly as uploaded", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set(makeFile("png").subarray(0, 8));
    for (let i = 8; i < big.length; i++) big[i] = (i * 31) & 0xff;
    const path = put("camera-shot.png", big);
    const r = await upload([{ path, name: "camera-shot.png" }]);
    expect(r.ok).toBe(true);
    expect(rowOf(r.documentId)).toMatchObject({ file_size: big.length, content_hash: sha(big), media_type: "image/png" });
    expect(sha(Buffer.from(String(data.storage_objects!.find((o) => o.name === path)!.base64), "base64"))).toBe(sha(big));
  });

  it("the file picker, the bucket and the server all name the same nine types", () => {
    const sql = readFileSync(join(MIGRATIONS, "0048_document_vault.sql"), "utf8").replace(/^\s*--.*$/gm, "");
    const listed = [...sql.match(/allowed_mime_types = array\[([\s\S]*?)\]/)![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...VAULT_MEDIA_TYPES]);
    // The size limit is the bucket's own (migration 0029) and 0048 does not touch it.
    expect(sql).not.toMatch(/file_size_limit/);
    expect(readFileSync(join(MIGRATIONS, "0029_document_hash_and_bucket_size.sql"), "utf8")).toMatch(/10485760/);
    expect(VAULT_MAX_BYTES).toBe(10485760);
    const uploader = readFileSync(join(SRC, "components/DocumentUploader.tsx"), "utf8");
    expect(uploader).toMatch(/accept=\{VAULT_ACCEPT\}/);
    expect(uploader).not.toMatch(/image\/gif|image\/webp/);
  });
});

// ── 2. Refusals ──────────────────────────────────────────────────────

describe("LAW: a file that is not one of the seven, or does not match its name, is refused plainly and leaves nothing behind", () => {
  // Planted: made the server skip checkVaultFile: every case below
  // inserted a row. Planted: dropped the cleanup call from refuse(): the
  // "no loose object" assertion failed. Reverted.
  const big = (() => {
    const b = new Uint8Array(VAULT_MAX_BYTES + 1);
    b.set([0x25, 0x50, 0x44, 0x46]);
    return b;
  })();
  const cases: Array<[string, string, Uint8Array]> = [
    ["a PNG named .jpg", "photo.jpg", makeFile("png")],
    ["a text file named .pdf", "notes.pdf", makeFile("txt")],
    ["a plain zip named .docx", "letter.docx", makeFile("zip")],
    ["a docx named .xlsx", "sheet.xlsx", makeFile("docx")],
    ["binary named .txt", "log.txt", makeFile("binary")],
    ["binary named .csv", "list.csv", makeFile("binary")],
    ["a GIF", "move.gif", makeFile("gif")],
    ["a WebP", "pic.webp", makeFile("webp")],
    ["a HEIC photo", "iphone.heic", makeFile("heic")],
    ["an empty file", "empty.pdf", makeFile("empty")],
    ["a file over 10 MB", "huge.pdf", big],
    ["a file with no extension", "README", makeFile("txt")],
  ];
  for (const [label, name, bytes] of cases) {
    it(`${label} is refused, names the seven, writes no row, and its object does not stay in the bucket`, async () => {
      const path = put(name, bytes);
      const r = await upload([{ path, name }]);
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
      if (label !== "an empty file" && label !== "a file over 10 MB") expect(r.error).toContain(VAULT_FORMATS_SENTENCE);
      expect(r.error).not.toContain(String.fromCharCode(0x2014));
      expect(writes.filter((w) => w.table === "documents")).toEqual([]);
      expect(inBucket(path)).toBe(false);
    });
  }

  it("one bad file refuses the whole selection and removes every upload of it, naming the file", async () => {
    const good = put("good.pdf", makeFile("pdf"));
    const bad = put("slide.gif", makeFile("gif"));
    const r = await upload([{ path: good, name: "good.pdf" }, { path: bad, name: "slide.gif" }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("slide.gif");
    expect(writes.filter((w) => w.table === "documents")).toEqual([]);
    expect(inBucket(good)).toBe(false);
    expect(inBucket(bad)).toBe(false);
  });

  it("the same refusal is the one the browser runs before it sends anything", () => {
    const uploader = readFileSync(join(SRC, "components/DocumentUploader.tsx"), "utf8");
    expect(uploader.indexOf("checkVaultFile(")).toBeGreaterThan(-1);
    expect(uploader.indexOf("checkVaultFile(")).toBeLessThan(uploader.indexOf(".upload("));
  });
});

// ── 3. No orphans, in either direction ───────────────────────────────

describe("LAW: no row without a file, no file without a row", () => {
  // Planted: let the insert go ahead when the read-back failed: the first
  // test failed. Planted: removed the referenced-by-a-row check from
  // removeUnregisteredUploads: the last test failed. Reverted.
  it("an upload that never arrived leaves no row", async () => {
    const r = await upload([{ path: `${ORG()}/req_never/1-lost.pdf`, name: "lost.pdf" }]);
    expect(r.ok).toBe(false);
    expect(writes.filter((w) => w.table === "documents")).toEqual([]);
  });

  it("a row pointing at a missing file is refused by the data layer the way the database refuses it", async () => {
    const client = createFakeClient(data, { userId: OWNER_ID });
    const { error } = await client.from("documents").insert({ org_id: ORG(), file_name: "x.pdf", file_size: 1, media_type: "application/pdf", source_role: "coordinator", status: "pending", lifecycle: "uploaded", storage_paths: [`${ORG()}/req_gone/1-x.pdf`], original_paths: [`${ORG()}/req_gone/1-x.pdf`] });
    expect((error as { message?: string } | null)?.message).toMatch(/is not in storage/);
    expect(docs().some((d) => d.file_name === "x.pdf")).toBe(false);
  });

  it("a refused file leaves no object in the bucket", async () => {
    const path = put("bad.pdf", makeFile("txt"));
    await upload([{ path, name: "bad.pdf" }]);
    expect(inBucket(path)).toBe(false);
    expect(serverWrites.every((w) => w.table === "storage:documents" || w.table === "documents")).toBe(true);
  });

  it("an object that has a row is never removed, by a later refused upload that names it", async () => {
    const kept = put("kept.pdf", makeFile("pdf"));
    const first = await upload([{ path: kept, name: "kept.pdf" }]);
    expect(first.ok).toBe(true);
    // A second selection that names the same path plus a file that fails.
    const bad = put("bad.gif", makeFile("gif"));
    const again = await upload([{ path: kept, name: "kept.pdf" }, { path: bad, name: "bad.gif" }]);
    expect(again.ok).toBe(false);
    expect(inBucket(kept)).toBe(true);
    expect(inBucket(bad)).toBe(false);
    expect(rowOf(first.documentId).original_paths).toEqual([kept]);
  });

  it("the cleanup stays inside this org's folder and the three part upload path", async () => {
    const elsewhere = `${data.orgs[1]!.id as string}/req_x/1-theirs.pdf`;
    data.storage_objects!.push({ bucket: "documents", name: elsewhere, base64: b64(makeFile("pdf")) });
    const nested = `${ORG()}/family/req_f/1-theirs.pdf`;
    data.storage_objects!.push({ bucket: "documents", name: nested, base64: b64(makeFile("pdf")) });
    const bad = put("bad.gif", makeFile("gif"));
    await upload([{ path: bad, name: "bad.gif" }, { path: elsewhere, name: "theirs.pdf" }, { path: nested, name: "theirs.pdf" }]);
    expect(inBucket(elsewhere)).toBe(true);
    expect(inBucket(nested)).toBe(true);
  });
});

// ── 4. Five states, seven moves ──────────────────────────────────────

describe("LAW: five statuses, enforced on the server, every move logged with who", () => {
  // Planted: let moveLifecycle skip canMove: the disallowed-pair test
  // failed. Planted: dropped the logActivity call: the log test failed.
  it("an untagged file goes Uploaded to Needs Review by itself and is logged; no reader runs", async () => {
    const path = put("note.txt", makeFile("txt"));
    const r = await upload([{ path, name: "note.txt" }]);
    expect(rowOf(r.documentId).lifecycle).toBe("needs_review");
    expect(logs().map((l) => l.action)).toEqual(["document_uploaded", "document_needs_review"]);
    expect(writes.filter((w) => w.table === "docai_usage")).toEqual([]);
    expect(rowOf(r.documentId).read_by).toBeNull();
  });

  it("a file in a format the reader cannot read, even tagged, is stored with the reason and not read", async () => {
    const path = put("letter.docx", makeFile("docx"));
    const r = await upload([{ path, name: "letter.docx" }], "transcript");
    expect(r.ok).toBe(true);
    expect(rowOf(r.documentId)).toMatchObject({ lifecycle: "needs_review", requested_category: "transcript", review_reason: "The reader reads PDF, JPG and PNG. Stored as is.", read_by: null });
  });

  it("a tagged PDF goes Uploaded, Processing, Needs Review, each logged", async () => {
    const path = put("transcript.pdf", makeFile("pdf"));
    const r = await upload([{ path, name: "transcript.pdf", reader: true }], "transcript");
    expect(r.ok).toBe(true);
    expect(rowOf(r.documentId).lifecycle).toBe("needs_review");
    expect(logs().map((l) => l.action)).toEqual(["document_uploaded", "document_reading", "document_needs_review"]);
  });

  it("every allowed move is made by the function, logs the actor and a time, and every other pair is refused", async () => {
    const { moveDocument } = await import("@/lib/actions/documents");
    const base = { org_id: ORG(), athlete_id: null, file_name: "m.pdf", file_size: 1, media_type: "application/pdf", status: "pending", storage_paths: [], original_paths: [] };
    const targets = ["ready", "archived", "needs_review"] as const;
    const staffPairs = new Set(TRANSITIONS.filter((t) => t.by === "staff").map((t) => `${t.from}>${t.to}`));
    let n = 0;
    for (const from of LIFECYCLE_STATES) {
      for (const to of targets) {
        n += 1;
        const id = `00000000-0000-0000-0000-00000000f${String(n).padStart(3, "0")}`;
        docs().push({ ...base, id, lifecycle: from, lifecycle_changed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
        writes.length = 0;
        const r = await moveDocument(ORG_WITH_MODULES, id, to);
        // Processing to Needs Review is staff-allowed only when stale; it is, an hour old.
        const allowed = staffPairs.has(`${from}>${to}`) || (from === "processing" && to === "needs_review");
        expect(r.ok, `${from} to ${to}`).toBe(allowed);
        if (allowed) {
          expect(rowOf(id).lifecycle).toBe(to);
          const log = logs();
          expect(log).toHaveLength(1);
          expect(log[0]).toMatchObject({ actor_id: OWNER_ID, subject_type: "document", subject_id: id });
          expect(String(rowOf(id).lifecycle_changed_at)).toBeTruthy();
        } else {
          expect(rowOf(id).lifecycle).toBe(from);
          expect(logs()).toEqual([]);
        }
      }
    }
  });

  it("Ready is only ever a person's tap: only the document screen's button asks for it, and the server never does", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && !p.includes("/testing/")) {
          const src = readFileSync(p, "utf8");
          // A call that passes Ready as the destination, or a row written as Ready.
          if (/(?<!function )\b(moveDocument|moveDocumentAndStay|moveLifecycle)\([^)]*"ready"/.test(src) || /moveTo\("ready"\)/.test(src) || /lifecycle: "ready"/.test(src)) hits.push(p.replace(SRC + "/", ""));
        }
      }
    };
    walk(SRC);
    expect(hits).toEqual(["app/org/[slug]/documents/[id]/page.tsx"]);
    // And the server's own moves, the system's, never include Ready.
    const actions = readFileSync(join(SRC, "lib/actions/documents.ts"), "utf8");
    expect(actions).not.toMatch(/moveLifecycle\([^)]*to: "ready"/);
  });

  it("the database and the app agree on the seven moves and the mapping of old rows", () => {
    const sql = readFileSync(join(MIGRATIONS, "0048_document_vault.sql"), "utf8").replace(/^\s*--.*$/gm, "");
    const pairs = [...sql.match(/from \(values([\s\S]*?)\) as allowed/)![1].matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    expect(pairs).toEqual(TRANSITIONS.map((t) => `${t.from}>${t.to}`).sort());
    const enumValues = [...sql.match(/create type doc_lifecycle as enum \(([\s\S]*?)\)/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(enumValues).toEqual([...LIFECYCLE_STATES]);
    // Only discarded becomes Archived; everything else Needs Review; nothing becomes Ready.
    expect(sql).toMatch(/case status when 'discarded' then 'archived' else 'needs_review' end/);
    expect(Object.entries(LEGACY_STATUS_TO_LIFECYCLE).filter(([, v]) => v === "archived").map(([k]) => k)).toEqual(["discarded"]);
  });
});

// ── 5. A mismatch or a reader failure keeps the file ─────────────────

describe("LAW: a file that does not look like its type, or that the reader cannot read, is kept in Needs Review with the reason", () => {
  // Planted: made finishReading set failure rows to archived and drop the
  // reason: both tests failed. Reverted.
  it("a transcript that is not a transcript: Needs Review, Did not look like Transcript, the file intact", async () => {
    const bytes = makeFile("pdf");
    const path = put("offtype-scores.pdf", bytes);
    const r = await upload([{ path, name: "offtype-scores.pdf", reader: true }], "transcript");
    expect(r.ok).toBe(true);
    const row = rowOf(r.documentId);
    expect(row).toMatchObject({ lifecycle: "needs_review", review_reason: "Did not look like Transcript", failure_stage: "triage_wrong_category" });
    expect(inBucket(path)).toBe(true);
    expect(row.original_paths).toEqual([path]);
    expect(writes.filter((w) => w.op === "delete")).toEqual([]);
    expect(row.lifecycle).not.toBe("archived");
  });

  it("the same for each of the six types", async () => {
    // Each file is different bytes: the same bytes twice would be a duplicate, not a mismatch.
    let filler = 100;
    for (const [category, label] of [["test_scores", "Test Scores"], ["offer_letter", "Offer Letter"], ["recommendation", "Recommendation"], ["financial_aid", "Financial Aid"], ["metrics", "Metrics Report"]] as const) {
      filler += 7;
      const path = put(`offtype-${category}.pdf`, makeFile("pdf", filler));
      const r = await upload([{ path, name: `offtype-${category}.pdf`, reader: true }], category);
      expect(rowOf(r.documentId).review_reason).toBe(`Did not look like ${label}`);
    }
  });

  it("a reader that stops unexpectedly ends in Needs Review with its reason, never stuck in Processing", async () => {
    const path = put("crash.pdf", makeFile("pdf"));
    const athletes = data.athletes;
    delete (data as Record<string, unknown>).athletes;
    let r;
    try {
      r = await upload([{ path, name: "crash.pdf", reader: true }], "transcript");
    } finally {
      data.athletes = athletes;
    }
    expect(r.ok).toBe(true);
    const row = rowOf(r.documentId);
    expect(row.lifecycle).toBe("needs_review");
    expect(String(row.review_reason)).toMatch(/^Reading stopped unexpectedly/);
    expect(inBucket(path)).toBe(true);
  });

  it("a reader error (here, a model that answers with an error) ends the same way, with the reader's own words", async () => {
    process.env.ANTHROPIC_API_KEY = "test-only";
    try {
      const path = put("model-error.pdf", makeFile("pdf", 77));
      const r = await upload([{ path, name: "model-error.pdf", reader: true }], "transcript");
      expect(r.ok).toBe(true);
      expect(rowOf(r.documentId).lifecycle).toBe("needs_review");
      expect(String(rowOf(r.documentId).review_reason)).toMatch(/could not be read/);
      expect(inBucket(path)).toBe(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("the same bytes again are stored and say so, and the reader does not run a second time", async () => {
    const bytes = makeFile("pdf");
    const a = put("first.pdf", bytes);
    const first = await upload([{ path: a, name: "first.pdf" }]);
    const b = put("second.pdf", bytes);
    const second = await upload([{ path: b, name: "second.pdf" }], "transcript", {});
    expect(first.documentId).not.toBe(second.documentId);
    expect(rowOf(second.documentId).review_reason).toMatch(/^Same file as first\.pdf uploaded /);
    expect(inBucket(a) && inBucket(b)).toBe(true);
  });
});

// ── 6. The old path ─────────────────────────────────────────────────

describe("LAW: the six types still read, review, apply and undo as before", () => {
  it("a transcript through the stand-in reader ends in review on the old status and Needs Review on the new", async () => {
    const path = put("fall-transcript.pdf", makeFile("pdf"));
    const r = await upload([{ path, name: "fall-transcript.pdf", reader: true }], "transcript", { athleteId: IDS.athlete });
    expect(r.ok).toBe(true);
    const row = rowOf(r.documentId);
    expect(["pending", "applied", "failed"]).toContain(row.status);
    expect(row.lifecycle).toBe("needs_review");
    expect(row.category).toBe("transcript");
    expect(row.read_by).toBe("stub");
    expect(row.requested_category).toBe("transcript");
  });

  it("Discard still undoes an apply, and now also archives, keeping the file", async () => {
    const { discardDocument } = await import("@/lib/actions/documents");
    const r = await discardDocument(ORG_WITH_MODULES, IDS.document);
    expect(r.ok).toBe(true);
    expect(rowOf(IDS.document)).toMatchObject({ status: "discarded", lifecycle: "archived" });
    expect(logs().map((l) => l.action)).toEqual(["document_discarded", "document_archived"]);
  });
});

// ── 7. Nothing is deleted ───────────────────────────────────────────

describe("LAW: nothing in the app deletes a document or its file", () => {
  // Planted: added `.remove(paths)` to a new action: this failed naming
  // the file. Planted: re-created the documents_delete policy in a later
  // migration: the migration law failed. Reverted.
  const files = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) files(p, out);
      else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
    return out;
  };

  it("no storage remove on the documents bucket outside the one cleanup helper", () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\.remove\(/g)) {
        const around = src.slice(Math.max(0, m.index! - 200), m.index!);
        if (!/storage[\s\S]{0,60}from\("documents"\)/.test(around) && !/from\("documents"\)\s*;?\s*$/.test(around)) continue;
        const inHelper = f.endsWith("lib/actions/documents.ts") && src.lastIndexOf("async function removeUnregisteredUploads", m.index!) > src.lastIndexOf("\nexport async function", m.index!);
        if (!inHelper) offenders.push(f.replace(SRC + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no delete on the documents table anywhere in the app", () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      if (/\.from\("documents"\)\s*\.delete\(/.test(src) || /\.from\("documents"\)[\s\S]{0,120}?\.delete\(\)/.test(src)) offenders.push(f.replace(SRC + "/", ""));
    }
    expect(offenders).toEqual([]);
  });

  it("the cleanup helper is reached only from processDocument and only removes unreferenced uploads", () => {
    const src = readFileSync(join(SRC, "lib/actions/documents.ts"), "utf8");
    expect(src.match(/removeUnregisteredUploads\(/g)!.length).toBeGreaterThan(1);
    const body = src.slice(src.indexOf("async function removeUnregisteredUploads"), src.indexOf("async function readStoredRecords"));
    expect(body).toMatch(/referenced/);
    expect(body).toMatch(/STORAGE_PATH\.test\(p\)/);
    expect(body).toMatch(/startsWith\(`\$\{orgId\}\//);
  });

  it("migrations leave no delete policy on documents or on the bucket", () => {
    let policies = new Set<string>();
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8").replace(/^\s*--.*$/gm, "");
      for (const m of sql.matchAll(/create policy (documents_delete|documents_bucket_delete)\b/g)) policies.add(m[1]!);
      for (const m of sql.matchAll(/drop policy (?:if exists )?(documents_delete|documents_bucket_delete)\b/g)) policies.delete(m[1]!);
    }
    expect([...policies]).toEqual([]);
    const sql = readFileSync(join(MIGRATIONS, "0048_document_vault.sql"), "utf8");
    expect(sql).toMatch(/revoke delete on documents from anon, authenticated/);
  });
});

// ── 8. The download route ────────────────────────────────────────────

describe("LAW: a stored original is downloaded by staff only, as the bytes that were stored, never through a public link", () => {
  // Planted: let any signed-in member through: the Viewer case failed.
  async function get(id: string, query = "?n=1", slug = ORG_WITH_MODULES) {
    const { GET } = await import("@/app/org/[slug]/documents/[id]/download/route");
    return GET(new NextRequest(`http://localhost/org/${slug}/documents/${id}/download${query}`), { params: Promise.resolve({ slug, id }) });
  }

  it("returns the stored bytes as an attachment, with the stored type and nosniff", async () => {
    const bytes = makeFile("docx");
    const path = put("team-letter.docx", bytes);
    const r = await upload([{ path, name: "team-letter.docx" }]);
    const res = await get(r.documentId!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="team-letter\.docx"/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(sha(new Uint8Array(await res.arrayBuffer()))).toBe(sha(bytes));
  });

  it("a Viewer, an Athlete login, another org's Admin and nobody signed in all get the same 404", async () => {
    const path = put("note.txt", makeFile("txt"));
    const r = await upload([{ path, name: "note.txt" }]);
    for (const who of [MEMBER_ID, FAMILY_ID, OUTSIDER_ID, null]) {
      currentUser = who;
      expect((await get(r.documentId!)).status, String(who)).toBe(404);
    }
  });

  it("another page number, a missing document and another org's slug are 404", async () => {
    const path = put("note.txt", makeFile("txt"));
    const r = await upload([{ path, name: "note.txt" }]);
    expect((await get(r.documentId!, "?n=2")).status).toBe(404);
    expect((await get(r.documentId!, "?n=0")).status).toBe(404);
    expect((await get("00000000-0000-0000-0000-00000000dead")).status).toBe(404);
    expect((await get(r.documentId!, "?n=1", "no-such-org")).status).toBe(404);
  });
});

// ── 9. The screens ──────────────────────────────────────────────────

describe("LAW: every row and every document screen shows its status, Archived is hidden until asked for, nothing says Delete", () => {
  async function html(modulePath: string, props: unknown): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = await import(/* @vite-ignore */ modulePath);
    return renderToStaticMarkup(await mod.default(props));
  }
  const LIST = "@/app/org/[slug]/documents/page";
  const DOC = "@/app/org/[slug]/documents/[id]/page";
  const listProps = (q: Record<string, string> = {}) => ({ params: Promise.resolve({ slug: ORG_WITH_MODULES }), searchParams: Promise.resolve(q) });
  const docProps = (id: string) => ({ params: Promise.resolve({ slug: ORG_WITH_MODULES, id }), searchParams: Promise.resolve({}) });

  it("the list shows all four working states, each row carries its status, and Archived is behind Show Archived", async () => {
    const out = await html(LIST, listProps());
    for (const state of ["Uploaded", "Processing", "Needs Review", "Ready"]) expect(out).toContain(`text-muted">${state}<`);
    expect(out).not.toContain("old-notes.txt");
    expect(out).toMatch(/Show Archived \(1\)/);
    const rows = out.split('data-kit="row"').length - 1;
    const chips = (out.match(/inline-flex items-center gap-2 text-label font-bold text-ink[^>]*>(?:<svg[\s\S]*?<\/svg>)?(Uploaded|Processing|Needs Review|Ready|Archived)</g) ?? []).length;
    expect(chips).toBe(rows);
    const shown = await html(LIST, listProps({ archived: "1" }));
    expect(shown).toContain("old-notes.txt");
    expect(shown).toContain('text-muted">Archived<');
    expect(shown).toMatch(/Hide Archived/);
  });

  it("a row says why it is in Needs Review", async () => {
    const out = await html(LIST, listProps());
    expect(out).toContain("Did not look like Transcript");
    expect(out).toContain("Reading did not finish.");
  });

  it("the document screen shows the original file's facts, the SHA-256, a download, and the moves for its state", async () => {
    const needs = await html(DOC, docProps("doc-word"));
    for (const t of ["Original File", "team-letter.docx", "Word", "47 KB", "SHA-256", "3f786850", "Mark Ready", "Archive", "Needs Review"]) expect(needs, t).toContain(t);
    expect(needs).toContain("/documents/doc-word/download?n=1");
    expect(needs).not.toMatch(/Delete|Remove/);
    const ready = await html(DOC, docProps("doc-ready"));
    expect(ready).toContain("Archive");
    expect(ready).not.toContain("Mark Ready");
    const archived = await html(DOC, docProps("doc-archived"));
    expect(archived).toContain("Unarchive");
    expect(archived).not.toContain("Mark Ready");
    const reading = await html(DOC, docProps("doc-reading"));
    expect(reading).toContain("Processing");
    expect(reading).not.toContain("Move to Needs Review");
    const uploaded = await html(DOC, docProps("doc-uploaded"));
    expect(uploaded).toContain("Uploaded");
    expect(uploaded).not.toContain("Mark Ready");
  });

  it("a mismatched file reads as kept, not rejected", async () => {
    const out = await html(DOC, docProps("doc-mismatch"));
    expect(out).toContain("Did not look like Transcript");
    expect(out).toContain("Kept for Review");
    expect(out).not.toMatch(/Not Used|Could Not Use|Delete/);
  });

  it("no non-image file shows a preview: only the name, the format, the size and a download", async () => {
    const out = await html(DOC, docProps("doc-word"));
    expect(out).not.toMatch(/<img|<iframe|<embed|<object/);
  });
});
