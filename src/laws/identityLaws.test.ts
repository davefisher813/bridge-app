// Doc AI rebuild, Piece 2 (migration 0049): who a document is about and
// what it is. Suggestions at upload; a person decides.
//
// The rules, as executable checks:
//   - an upload carries a provisional type and identity candidates, with
//     reasons, and links nobody
//   - an upload started from an athlete's page is about that athlete,
//     unless the file names somebody else, then nobody is decided
//   - only an Admin of the document's org says who it is about, only to
//     an athlete of that org; the database holds the same line
//   - Suggest Again never overwrites a person's decision
//   - a suggestion that cannot be made never stops an upload
//   - only the two Piece 2 modules ever write subject_athlete_id
//
// Planted to fail: dropped the org check in setDocumentIdentity (the
// other-org law failed); made suggestionFor link the top candidate (the
// "links nobody" law failed); let suggestDocumentAgain write
// identity_status unconditionally (the "never overwrites" law failed).
// Each reverted.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { suggestionFor } from "@/lib/data/documentSuggestions";
import { makeZip } from "@/testing/vaultFiles";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();

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
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  delete process.env.ANTHROPIC_API_KEY;
});

const enc = new TextEncoder();
const ORG = () => data.orgs[0]!.id as string;
const rowOf = (id: string | undefined) => data.documents!.find((d) => d.id === id)!;
const logs = () => writes.filter((w) => w.table === "activity_log" && w.op === "insert").map((w) => w.rows[0]!);

let counter = 0;
function put(name: string, content: string | Uint8Array): string {
  counter += 1;
  const path = `${ORG()}/req_id_${counter}/1-${name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
  const bytes = typeof content === "string" ? enc.encode(content) : content;
  data.storage_objects!.push({ bucket: "documents", name: path, base64: Buffer.from(bytes).toString("base64") });
  return path;
}

async function upload(name: string, text: string, extra: Record<string, unknown> = {}) {
  const { processDocument } = await import("@/lib/actions/documents");
  return processDocument(ORG_WITH_MODULES, { originals: [{ storagePath: put(name, text), name, reader: null }], sourceRole: "coordinator", requestedCategory: null, ...extra });
}

async function setIdentity(documentId: string, value: string) {
  const { setDocumentIdentity } = await import("@/lib/actions/documentIdentity");
  const form = new FormData();
  form.set("athleteId", value);
  return setDocumentIdentity(ORG_WITH_MODULES, documentId, form).catch((e: Error) => e.message);
}

describe("LAW: an upload is suggested, never linked", () => {
  it("a file naming an athlete gets that athlete as a candidate, with a reason, and nobody is linked", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "Official transcript for the student");
    expect(r.ok).toBe(true);
    const row = rowOf(r.documentId);
    expect(row).toMatchObject({ suggested_type: "transcript", identity_status: "proposed" });
    expect((row.identity_candidates as { athleteId: string; reasons: string[] }[])[0]).toMatchObject({ athleteId: IDS.athlete, reasons: ["Name in the file name"] });
    expect(row.subject_athlete_id ?? null).toBeNull();
    expect(row.athlete_id ?? null).toBeNull();
    expect(row.suggested_type_reasons).toContain('File name says "transcript"');
  });

  it("a family email shared by siblings is ambiguous, not a pick", async () => {
    const r = await upload("contact-sheet.csv", "Name,Email\nParent,parent@example.test");
    const row = rowOf(r.documentId);
    expect(row.identity_status).toBe("ambiguous");
    expect((row.identity_candidates as unknown[]).length).toBeGreaterThan(1);
    expect(row.subject_athlete_id ?? null).toBeNull();
  });

  it("a file that names nobody is unmatched and kept as Other", async () => {
    const r = await upload("IMG_0042.txt", "lorem ipsum");
    expect(rowOf(r.documentId)).toMatchObject({ identity_status: "unmatched", suggested_type: "other", identity_candidates: [] });
  });

  it("from an athlete's page, the upload is about that athlete", async () => {
    const r = await upload("scan.txt", "notes", { athleteId: IDS.athlete });
    expect(rowOf(r.documentId)).toMatchObject({ identity_status: "confirmed", subject_athlete_id: IDS.athlete, identity_confirmed_by: OWNER_ID });
  });

  it("from an athlete's page, a file naming someone else decides nobody", async () => {
    const r = await upload("Fixture_Transfer_offer.txt", "offer", { athleteId: IDS.athlete });
    const row = rowOf(r.documentId);
    expect(row.identity_status).toBe("ambiguous");
    expect((row.identity_candidates as { athleteId: string }[]).map((c) => c.athleteId)).toEqual([IDS.athlete, IDS.athleteTransfer]);
    expect(row.subject_athlete_id ?? null).toBeNull();
  });

  it("a suggestion that cannot be made leaves the upload exactly as it was", () => {
    const exploding = new Proxy([], { get: () => { throw new Error("roster unavailable"); } });
    const s = suggestionFor({ fileName: "a.txt", format: "txt", bytes: enc.encode("x"), pickedType: null, roster: exploding as never, actorId: OWNER_ID });
    expect(s).toMatchObject({ suggested_type: null, identity_status: null, identity_candidates: [] });
  });
});

describe("LAW: a person says who it is about", () => {
  async function proposed() {
    const r = await upload("Fixture_Athlete_report.txt", "x");
    return r.documentId!;
  }

  it("Confirm sets the athlete, says who and when, and logs it", async () => {
    const id = await proposed();
    const out = await setIdentity(id, IDS.athlete);
    expect(out).toBe(`NEXT_REDIRECT:/org/${ORG_WITH_MODULES}/documents/${id}`);
    expect(rowOf(id)).toMatchObject({ identity_status: "confirmed", subject_athlete_id: IDS.athlete, identity_confirmed_by: OWNER_ID });
    expect(logs().at(-1)).toMatchObject({ action: "document_identity_confirmed", athlete_id: IDS.athlete, subject_id: id });
    expect(String(logs().at(-1)!.summary)).toMatch(/is about Fixture Athlete/);
  });

  it("an athlete from another org is refused and nothing changes", async () => {
    const id = await proposed();
    const out = await setIdentity(id, IDS.athleteElite);
    expect(out).toMatch(/error=That%20athlete%20is%20not%20on%20this%20roster/);
    expect(rowOf(id)).toMatchObject({ identity_status: "proposed" });
    expect(rowOf(id).subject_athlete_id ?? null).toBeNull();
  });

  it("Not About an Athlete is a decision too", async () => {
    const id = await proposed();
    await setIdentity(id, "none");
    expect(rowOf(id)).toMatchObject({ identity_status: "not_an_athlete", subject_athlete_id: null, identity_confirmed_by: OWNER_ID });
    expect(String(logs().at(-1)!.summary)).toMatch(/not about an athlete/);
  });

  it("Undo goes back to the suggestion it had, not a new guess", async () => {
    const id = await proposed();
    await setIdentity(id, IDS.athlete);
    await setIdentity(id, "");
    expect(rowOf(id)).toMatchObject({ identity_status: "proposed", subject_athlete_id: null, identity_confirmed_by: null });
    expect(logs().at(-1)).toMatchObject({ action: "document_identity_cleared" });
  });

  it("a Viewer cannot decide", async () => {
    const id = await proposed();
    currentUser = MEMBER_ID;
    await setIdentity(id, IDS.athlete);
    expect(rowOf(id).subject_athlete_id ?? null).toBeNull();
  });

  it("Suggest Again refreshes the suggestions and never overwrites a decision", async () => {
    const id = await proposed();
    await setIdentity(id, IDS.athlete);
    const { suggestDocumentAgain } = await import("@/lib/actions/documentIdentity");
    await suggestDocumentAgain(ORG_WITH_MODULES, id).catch(() => null);
    expect(rowOf(id)).toMatchObject({ identity_status: "confirmed", subject_athlete_id: IDS.athlete });
    expect(rowOf(id).suggested_at).toBeTruthy();
  });

  it("Suggest Again gives an old document its first suggestion", async () => {
    const old = data.documents!.find((d) => d.identity_status == null && (d.original_paths as string[] | null)?.length);
    expect(old, "the fixture has a document from before Piece 2").toBeTruthy();
    if (!old) return;
    const { suggestDocumentAgain } = await import("@/lib/actions/documentIdentity");
    await suggestDocumentAgain(ORG_WITH_MODULES, old.id as string).catch(() => null);
    expect(rowOf(old.id as string).suggested_type).toBeTruthy();
  });
});

describe("LAW: nothing else decides who a document is about", () => {
  const SRC = join(process.cwd(), "src");
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
    });
  }
  it("only the Piece 2 action and the upload's own page pin write subject_athlete_id", () => {
    const writers = walk(SRC)
      // A write: an object key with a value, or an assignment. A type
      // declaration ("subject_athlete_id: string | null") is not one.
      .filter((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .some((line) => (/subject_athlete_id\??\s*:/.test(line) && !/subject_athlete_id\??\s*:\s*(string|null|undefined)\b[^?]*;?\s*$/.test(line)) || /\.subject_athlete_id\s*=[^=]/.test(line))
      )
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(writers).toEqual(["lib/actions/documentIdentity.ts", "lib/data/documentSuggestions.ts"]);
  });

  it("the suggester's module reads no model and no network", () => {
    const src = readFileSync(join(SRC, "lib/docai/suggest.ts"), "utf8");
    expect(src).not.toMatch(/import .* from "(next|@supabase|@anthropic-ai|node:)/);
    expect(src).not.toMatch(/fetch\(/);
  });
});

describe("LAW: the document screen shows the suggestion and asks", () => {
  async function html(id: string): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = await import("@/app/org/[slug]/documents/[id]/page");
    return renderToStaticMarkup(await mod.default({ params: Promise.resolve({ slug: ORG_WITH_MODULES, id }), searchParams: Promise.resolve({}) }));
  }

  it("a proposal shows the candidate, the reason, and Confirm, and says nothing is linked yet", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    const out = await html(r.documentId!);
    for (const t of ["Who and What", "Likely Transcript", "Fixture Athlete", "Name in the file name", "Confirm Fixture Athlete", "Nothing is linked until you confirm", "Someone Else"]) expect(out, t).toContain(t);
  });

  it("a picked type the file disagrees with is said out loud, and the file is kept", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const name = "Assignment 2 instructions.docx";
    const docx = makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document><w:p><w:t>Assignment directions: complete the steps below</w:t></w:p></w:document>" });
    const r = await processDocument(ORG_WITH_MODULES, { originals: [{ storagePath: put(name, docx), name, reader: null }], sourceRole: "coordinator", requestedCategory: "transcript" });
    expect(r.ok).toBe(true);
    expect(rowOf(r.documentId).suggested_type).toBe("assignment_instructions");
    const out = await html(r.documentId!);
    expect(out).toContain("This Looks Like Assignment Instructions");
    expect(out).toContain("It was uploaded as Transcript");
  });

  it("an old document offers Suggest instead of pretending", async () => {
    const old = data.documents!.find((d) => d.identity_status == null);
    expect(old, "the fixture has a document from before Piece 2").toBeTruthy();
    if (!old) return;
    const out = await html(old.id as string);
    expect(out).toContain("Suggest Who and What");
  });
});
