// Doc AI rebuild, Piece 2 (migration 0073): who a document is about and
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

  // Migration 0058's athlete link is what the athlete's page reads, so a
  // confirmation and the link must not disagree (merge of Piece 2, 2026-10-15).
  it("Confirm also links the document when nobody linked it, and Undo takes only that link back", async () => {
    const id = await proposed();
    expect(rowOf(id).linked_athlete_id ?? null).toBeNull();
    await setIdentity(id, IDS.athlete);
    expect(rowOf(id)).toMatchObject({ subject_athlete_id: IDS.athlete, linked_athlete_id: IDS.athlete });
    await setIdentity(id, "");
    expect(rowOf(id).linked_athlete_id ?? null).toBeNull();
  });

  it("a link a person set to someone else is never moved by Confirm or Undo", async () => {
    const id = await proposed();
    rowOf(id).linked_athlete_id = "00000000-0000-0000-0000-00000000beef";
    await setIdentity(id, IDS.athlete);
    expect(rowOf(id)).toMatchObject({ subject_athlete_id: IDS.athlete, linked_athlete_id: "00000000-0000-0000-0000-00000000beef" });
    await setIdentity(id, "");
    expect(rowOf(id).linked_athlete_id).toBe("00000000-0000-0000-0000-00000000beef");
  });

  it("Not About an Athlete removes a link only its own confirmation made", async () => {
    const id = await proposed();
    await setIdentity(id, IDS.athlete);
    await setIdentity(id, "none");
    expect(rowOf(id)).toMatchObject({ identity_status: "not_an_athlete", subject_athlete_id: null });
    expect(rowOf(id).linked_athlete_id ?? null).toBeNull();
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

describe("LAW: Suggest Who and What in bulk", () => {
  // The fake client numbers rows "fake-documents-3"; the action only takes UUIDs.
  const uuid = (docId: string, n: number) => {
    const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    rowOf(docId).id = id;
    return id;
  };
  async function suggestMany(ids: string[]) {
    const { bulkSuggestDocuments } = await import("@/lib/actions/documentsBulk");
    const form = new FormData();
    for (const id of ids) form.append("ids", id);
    return bulkSuggestDocuments(ORG_WITH_MODULES, form).catch((e: Error) => e.message);
  }

  it("refreshes the suggestions of every selected document and says how many", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const b = await upload("Fixture_Athlete_report.txt", "x");
    rowOf(a.documentId!).identity_status = null;
    rowOf(a.documentId!).suggested_type = null;
    const ia = uuid(a.documentId!, 901);
    const ib = uuid(b.documentId!, 902);
    const out = await suggestMany([ia, ib]);
    expect(decodeURIComponent(out as string)).toContain("Suggested for 2 documents.");
    expect(data.documents!.find((d) => d.id === ia)).toMatchObject({ identity_status: "proposed", suggested_type: "transcript" });
  });

  it("never overwrites a confirmed athlete or a decision of none", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    await setIdentity(a.documentId!, IDS.athlete);
    const ia = uuid(a.documentId!, 903);
    await suggestMany([ia]);
    expect(data.documents!.find((d) => d.id === ia)).toMatchObject({ identity_status: "confirmed", subject_athlete_id: IDS.athlete });
  });

  it("another org's id is untouched and counted", async () => {
    const out = await suggestMany(["00000000-0000-0000-0000-00000000dead"]);
    expect(decodeURIComponent(out as string)).toMatch(/Nothing was changed\. Skipped 1: 1 no longer here/);
  });

  it("a Viewer is refused before anything is read or written", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const ia = uuid(a.documentId!, 904);
    const before = JSON.stringify(data.documents!.find((d) => d.id === ia));
    currentUser = MEMBER_ID;
    await suggestMany([ia]);
    currentUser = OWNER_ID;
    expect(JSON.stringify(data.documents!.find((d) => d.id === ia))).toBe(before);
  });

  it("a selection past the cap is refused and does none of it", async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const out = await suggestMany(ids);
    expect(decodeURIComponent(out as string)).toContain("Suggest for 40 or fewer at a time");
  });
});

// Undo for a bulk Suggest (Alfred, 2026-10-15): a bulk run that changes state
// is reversible in one action, as a single Confirm is. Planted: restored
// only the first document; restored over a confirmation; left the
// remembered state behind. Each failed a test below, then was reverted.
describe("LAW: a bulk Suggest can be undone", () => {
  const uuid = (docId: string, n: number) => {
    const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    rowOf(docId).id = id;
    return id;
  };
  async function suggestMany(ids: string[]): Promise<string> {
    const { bulkSuggestDocuments } = await import("@/lib/actions/documentsBulk");
    const form = new FormData();
    for (const id of ids) form.append("ids", id);
    return decodeURIComponent((await bulkSuggestDocuments(ORG_WITH_MODULES, form).catch((e: Error) => e.message)) as unknown as string);
  }
  const tokenOf = (url: string) => url.match(/undo=([^&]+)/)?.[1] ?? null;
  async function undo(token: string | null): Promise<string> {
    const { undoBulkSuggest } = await import("@/lib/actions/documentsBulk");
    const form = new FormData();
    if (token) form.append("undo", token);
    return decodeURIComponent((await undoBulkSuggest(ORG_WITH_MODULES, form).catch((e: Error) => e.message)) as unknown as string);
  }
  const FIELDS = ["suggested_type", "suggested_type_confidence", "suggested_type_reasons", "identity_status", "identity_candidates", "suggested_at"] as const;
  const pick = (id: string) => {
    const r = data.documents!.find((d) => d.id === id)!;
    return Object.fromEntries(FIELDS.map((f) => [f, JSON.parse(JSON.stringify(r[f] ?? null))]));
  };

  it("the notice carries an Undo for exactly the documents that run refreshed", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const b = await upload("Fixture_Athlete_report.txt", "x");
    const ia = uuid(a.documentId!, 911);
    const ib = uuid(b.documentId!, 912);
    const out = await suggestMany([ia, ib]);
    expect(out).toContain("Suggested for 2 documents.");
    const token = tokenOf(out);
    expect(token).toMatch(/^[0-9a-f-]{36}\.[0-9a-f-]{36},[0-9a-f-]{36}$/);
  });

  it("Undo returns every document to its prior suggestion, a mixed set included", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x"); // unconfirmed, custom prior
    const b = await upload("Fixture_Athlete_report.txt", "x"); // confirmed by a person
    const c = await upload("Plain_notes.txt", "x"); // never suggested before
    await setIdentity(b.documentId!, IDS.athlete);
    const ra = rowOf(a.documentId!);
    ra.suggested_type = "course_plan";
    ra.suggested_type_confidence = 0.4;
    ra.suggested_type_reasons = ["Prior reason"];
    ra.identity_status = "ambiguous";
    ra.identity_candidates = [{ athleteId: IDS.athlete, name: "Prior", score: 0.5 }];
    ra.suggested_at = "2026-10-01T00:00:00.000Z";
    const rc = rowOf(c.documentId!);
    rc.suggested_type = null;
    rc.suggested_type_confidence = null;
    rc.suggested_type_reasons = [];
    rc.identity_status = null;
    rc.identity_candidates = [];
    rc.suggested_at = null;
    const ia = uuid(a.documentId!, 913);
    const ib = uuid(b.documentId!, 914);
    const ic = uuid(c.documentId!, 915);
    const priorA = pick(ia);
    const priorB = pick(ib);
    const priorC = pick(ic);
    const linkB = data.documents!.find((d) => d.id === ib)!.linked_athlete_id;

    const out = await suggestMany([ia, ib, ic]);
    expect(pick(ia)).not.toEqual(priorA);
    expect(pick(ic)).not.toEqual(priorC);

    const done = await undo(tokenOf(out));
    expect(done).toContain("Suggestions restored for 3 documents.");
    expect(pick(ia)).toEqual(priorA);
    expect(pick(ib)).toEqual({ ...priorB, ...pick(ib) });
    expect(pick(ic)).toEqual(priorC);
    // The confirmed document keeps its person and its link throughout.
    expect(data.documents!.find((d) => d.id === ib)).toMatchObject({ identity_status: "confirmed", subject_athlete_id: IDS.athlete, linked_athlete_id: linkB });
    for (const id of [ia, ib, ic]) expect(data.documents!.find((d) => d.id === id)!.suggestion_before ?? null).toBeNull();
  });

  it("Undo works when the database writes the same instant in its own format", async () => {
    // Production hands "...123+00:00" back where the app wrote "...123Z".
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const ia = uuid(a.documentId!, 930);
    const prior = pick(ia);
    const out = await suggestMany([ia]);
    const row = data.documents!.find((d) => d.id === ia)!;
    row.suggested_at = String(row.suggested_at).replace("Z", "+00:00");
    const before = row.suggestion_before as { replaced_at: string };
    expect(before.replaced_at.endsWith("Z")).toBe(true);
    expect(await undo(tokenOf(out))).toContain("Suggestions restored for 1 document.");
    expect(pick(ia)).toEqual(prior);
  });

  it("a bulk run links and confirms nothing, so Undo unlinks nothing", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const ia = uuid(a.documentId!, 916);
    const row = data.documents!.find((d) => d.id === ia)!;
    const linkBefore = row.linked_athlete_id ?? null;
    const out = await suggestMany([ia]);
    expect(row.linked_athlete_id ?? null).toBe(linkBefore);
    expect(row.subject_athlete_id ?? null).toBeNull();
    await undo(tokenOf(out));
    expect(row.linked_athlete_id ?? null).toBe(linkBefore);
  });

  it("a document a person confirmed after the run keeps their word", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const b = await upload("Fixture_Athlete_report.txt", "x");
    const ia = uuid(a.documentId!, 917);
    const ib = uuid(b.documentId!, 918);
    const out = await suggestMany([ia, ib]);
    await setIdentity(ia, IDS.athlete);
    const done = await undo(tokenOf(out));
    expect(done).toContain("Suggestions restored for 1 document.");
    expect(done).toContain("1 document left as it is, changed since.");
    expect(data.documents!.find((d) => d.id === ia)).toMatchObject({ identity_status: "confirmed", subject_athlete_id: IDS.athlete });
  });

  it("a document suggested again by a later run is not rolled back by the earlier Undo", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const ia = uuid(a.documentId!, 919);
    const first = await suggestMany([ia]);
    await new Promise((r) => setTimeout(r, 5));
    await suggestMany([ia]);
    const after = pick(ia);
    const done = await undo(tokenOf(first));
    expect(done).toContain("Nothing was restored.");
    expect(pick(ia)).toEqual(after);
  });

  it("running Undo twice restores once and then says nothing was restored", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const ia = uuid(a.documentId!, 920);
    const token = tokenOf(await suggestMany([ia]));
    expect(await undo(token)).toContain("Suggestions restored for 1 document.");
    expect(await undo(token)).toContain("Nothing was restored.");
  });

  it("a token that is not valid, or names another run's documents, changes nothing", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const ia = uuid(a.documentId!, 921);
    await suggestMany([ia]);
    const before = JSON.stringify(data.documents!.find((d) => d.id === ia));
    expect(await undo("drop table documents")).toContain("That Undo is not valid any more.");
    expect(await undo(`00000000-0000-0000-0000-00000000beef.${ia}`)).toContain("Nothing was restored.");
    expect(JSON.stringify(data.documents!.find((d) => d.id === ia))).toBe(before);
  });

  it("a Viewer is refused", async () => {
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const ia = uuid(a.documentId!, 922);
    const token = tokenOf(await suggestMany([ia]));
    const before = JSON.stringify(data.documents!.find((d) => d.id === ia));
    currentUser = MEMBER_ID;
    await undo(token);
    currentUser = OWNER_ID;
    expect(JSON.stringify(data.documents!.find((d) => d.id === ia))).toBe(before);
  });

  it("the Documents screen shows the Undo while the address carries it, and not otherwise", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = await import("@/app/org/[slug]/documents/page");
    const a = await upload("Fixture_Athlete_transcript.txt", "x");
    const ia = uuid(a.documentId!, 923);
    const token = tokenOf(await suggestMany([ia]))!;
    const render = async (undoParam?: string) => renderToStaticMarkup(await mod.default({ params: Promise.resolve({ slug: ORG_WITH_MODULES }), searchParams: Promise.resolve({ notice: "Suggested for 1 document.", undo: undoParam }) }));
    const withUndo = await render(token);
    // The confirm sheet opens on tap, so the markup carries the form and its token.
    expect(withUndo).toContain(`name="undo" value="${token}"`);
    expect(withUndo).toContain(">Undo</button>");
    expect(await render()).not.toContain('name="undo"');
    expect(await render("junk")).not.toContain('name="undo"');
  });
});

// Needs Review is what waits on a person (Alfred, 2026-10-15): a Ready
// document whose suggested athlete nobody confirmed appears there, keeping
// its Ready state, until somebody decides.
describe("LAW: an unconfirmed suggestion is in Needs Review", () => {
  async function list(view: string): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = await import("@/app/org/[slug]/documents/page");
    return renderToStaticMarkup(await mod.default({ params: Promise.resolve({ slug: ORG_WITH_MODULES }), searchParams: Promise.resolve({ view }) }));
  }

  it("a Ready document with a proposed athlete shows in Needs Review and keeps its state", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    const row = rowOf(r.documentId!);
    row.lifecycle = "ready";
    expect(row.identity_status).toBe("proposed");
    const inReview = await list("needs_review");
    expect(inReview).toContain("Fixture_Athlete_transcript.txt");
    expect(inReview).toContain("Maybe Fixture Athlete?");
    expect(row.lifecycle).toBe("ready");
    // Not duplicated into the Ready view's own section count when asked for Ready: it is still Ready.
    expect(await list("ready")).toContain("Fixture_Athlete_transcript.txt");
  });

  it("a machine file name reads as a title, and an archived row carries no second Archived label (D6, V5)", async () => {
    const r = await upload("browser-download-20261009T014437.089730450Z-11-fiscal-policy.txt", "x");
    const row = rowOf(r.documentId!);
    row.category = null;
    row.requested_category = null;
    row.suggested_type = null;
    row.review_reason = "No type chosen.";
    row.lifecycle = "archived";
    const out = (await list("archived")).replace(/<script>[\s\S]*?<\/script>/g, "");
    expect(out).toContain("Fiscal Policy");
    expect(out).not.toMatch(/line-clamp-2 text-body font-semibold text-ink">browser-download/); // the title; the file name stays in the details line
    expect(out).not.toContain("No type chosen.");
    expect((out.match(/>Archived</g) ?? []).length).toBe(2); // the tile and the section, not the row
  });

  it("confirming takes it out of Needs Review", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    rowOf(r.documentId!).lifecycle = "ready";
    await setIdentity(r.documentId!, IDS.athlete);
    expect(await list("needs_review")).not.toContain("Fixture_Athlete_transcript.txt");
  });

  it("a Ready document with no candidate to confirm is not pulled into Needs Review", async () => {
    const r = await upload("Plain_notes.txt", "x");
    const row = rowOf(r.documentId!);
    row.lifecycle = "ready";
    expect(["unmatched", null]).toContain(row.identity_status ?? null);
    expect(await list("needs_review")).not.toContain("Plain_notes.txt");
  });
});

describe("LAW: the document screen shows the suggestion and asks", () => {
  async function html(id: string): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const mod = await import("@/app/org/[slug]/documents/[id]/page");
    return renderToStaticMarkup(await mod.default({ params: Promise.resolve({ slug: ORG_WITH_MODULES, id }), searchParams: Promise.resolve({}) }));
  }

  it("the original file shows its fingerprint as one string and always says who uploaded it (D3, D7)", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    const row = rowOf(r.documentId!);
    row.content_hash = "a3f1c2d4e5b6a7980123456789abcdef0123456789abcdef0123456789abcdef";
    row.uploaded_by = null;
    const out = await html(r.documentId!);
    expect(out).toContain("a3f1c2d4e5b6a7980123456789abcdef0123456789abcdef0123456789abcdef");
    expect(out).toContain("Uploaded By");
    expect(out).toContain("Not recorded");
  });

  it("a document that is gone sends the person to the library, not an error screen (live test O2)", async () => {
    await expect(html("00000000-0000-0000-0000-00000000dead")).rejects.toThrow("NEXT_REDIRECT:/org/" + ORG_WITH_MODULES + "/documents");
  });

  it("a reading never shows field talk: a sentence about a null or a column is left out", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    const row = rowOf(r.documentId!);
    row.extracted = { summary: "A recruiting tracker with 40 rows. The ADVISOR column is blank, so studentName is null.", keyFacts: ["Updated in March", "studentName is null"], warnings: ["The scan was dim.", "studentName is null."] };
    const out = await html(r.documentId!);
    expect(out).toContain("A recruiting tracker with 40 rows.");
    expect(out).toContain("Updated in March");
    expect(out).toContain("The scan was dim.");
    expect(out.replace(/<script>[\s\S]*?<\/script>/g, "")).not.toMatch(/studentName|ADVISOR column|\bnull\b/);
  });

  it("stored reasons and issues from an older reading are cleaned too", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    const row = rowOf(r.documentId!);
    row.status = "failed";
    row.lifecycle = "needs_review";
    row.extracted = null;
    row.failure_reason = "The sheet has no student, so studentName is null.";
    row.review_reason = "The ADVISOR column is blank for all athletes. Check the sheet.";
    row.triage = { legibilityScore: 0.9, issues: ["It does not fit the schema.", "The scan is dim."] };
    const out = (await html(r.documentId!)).replace(/<script>[\s\S]*?<\/script>/g, "");
    expect(out).not.toMatch(/studentName|ADVISOR column|\bnull\b|schema/);
    expect(out).toContain("It could not be read.");
    expect(out).toContain("Check the sheet.");
    expect(out).toContain("The scan is dim.");
  });

  it("a proposal shows the candidate, the reason, and Confirm, and says nothing is linked yet", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    const out = await html(r.documentId!);
    for (const t of ["Who and What", "Likely Transcript", "Fixture Athlete", "Name in the file name", "Confirm Fixture Athlete", "Nothing is linked until you confirm", "Someone Else"]) expect(out, t).toContain(t);
  });

  it("possible matches sit under a Maybe heading", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    const out = await html(r.documentId!);
    expect(out).toMatch(/Maybe[\s\S]*Possible match\. Nothing is linked until you confirm/);
  });

  it("a close second type is its own group under Maybe, not only a phrase in the reasons", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    rowOf(r.documentId!).suggested_type_reasons = ["Word in the file name", "Could also be Course Plan"];
    const out = await html(r.documentId!);
    expect(out).toMatch(/Likely Transcript[\s\S]*Maybe[\s\S]*Course Plan/);
    expect(out).not.toContain("Could also be");
  });

  it("after Confirm there is a visible Undo that says what it takes back", async () => {
    const r = await upload("Fixture_Athlete_transcript.txt", "x");
    expect(await html(r.documentId!)).not.toContain("Undo This Confirmation");
    await setIdentity(r.documentId!, IDS.athlete);
    const out = await html(r.documentId!);
    expect(out).toContain("Confirmed");
    expect(out).toContain("Undo");
    // The confirm sheet is rendered closed, so the question is checked by the source.
    expect(readFileSync("src/components/DocumentSuggestions.tsx", "utf8")).toContain('title="Undo This Confirmation?"');
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
