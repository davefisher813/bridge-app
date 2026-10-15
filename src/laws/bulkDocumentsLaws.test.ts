// Bulk actions on the Documents list (Dave, 2026-10-13). Held to:
//
//   - the page wraps the list in one BulkSelect, its rows carry a
//     checkbox, and every action posts to a bulk server action;
//   - every action refuses a Viewer before any write, takes only ids
//     that are this org's (another org's id is untouched and counted),
//     writes ONE log row per document that changed, and never a title or
//     a file name;
//   - Approve honours the approver gate per document and skips, never
//     forces; a document in the wrong state is skipped;
//   - Archive is the soft put-away: nothing is deleted;
//   - the notice names how many changed and how many were skipped, why;
//   - no document is read and no model is called.
//
// Verified each law bites: see the "planted" note beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { bulkNotice, SkipTally } from "@/lib/bulk/notice";

const REDIRECT = "NEXT_REDIRECT:";
const APPROVER = "00000000-0000-0000-0000-0000000000a7";
const D = (n: number) => `00000000-0000-0000-0000-0000000bd${String(n).padStart(3, "0")}`;

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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

const bridge = () => data.orgs.find((o) => o.slug === ORG_WITH_MODULES)!.id as string;
const elite = () => data.orgs.find((o) => o.slug !== ORG_WITH_MODULES)!.id as string;

function doc(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: D(n),
    org_id: bridge(),
    file_name: `secret-file-${n}.pdf`,
    title: `Secret Title ${n}`,
    file_size: 10,
    media_type: "application/pdf",
    source_role: "coordinator",
    status: "pending",
    category: null,
    requested_category: null,
    filed_as: null,
    athlete_id: null,
    linked_athlete_id: null,
    extracted: null,
    review_reason: null,
    lifecycle: "needs_review",
    lifecycle_changed_at: "2026-10-01T00:00:00Z",
    approved_by: null,
    approved_at: null,
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

const rowOf = (n: number) => data.documents.find((d) => d.id === D(n))!;

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  data.users.push({ id: APPROVER, email: "approver@example.test", full_name: "Pat Approver", last_sign_in_at: "2026-09-01T12:00:00.000Z" });
  data.org_members.push({ id: "m-approver", user_id: APPROVER, org_id: bridge(), role: "owner" });
});

async function run(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith(REDIRECT)) return m.slice(REDIRECT.length);
    throw e;
  }
  throw new Error("the action did not redirect");
}

function form(values: Record<string, string>, ids: string[]): FormData {
  const fd = new FormData();
  for (const id of ids) fd.append("ids", id);
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

const logs = (action?: string) => writes.filter((w) => w.table === "activity_log" && w.op === "insert").map((w) => w.rows[0] as Record<string, unknown>).filter((r) => !action || r.action === action);
const docWrites = () => writes.filter((w) => w.table === "documents");
const noticeOf = (url: string) => new URL(url, "http://x").searchParams.get("notice") ?? new URL(url, "http://x").searchParams.get("error") ?? "";

// ── The notice sentence ──────────────────────────────────────────────
describe("the bulk notice", () => {
  it("names applied and skipped counts and reasons", () => {
    const t = new SkipTally();
    t.add("waiting on their approver");
    t.add("waiting on their approver");
    t.add("not in Needs Review");
    expect(bulkNotice({ verb: "Approved", noun: "document", applied: 4, skipped: t.map }).text).toBe("Approved 4 documents. Skipped 3: 2 waiting on their approver, 1 not in Needs Review.");
    expect(bulkNotice({ verb: "Approved", noun: "document", applied: 1, skipped: new Map() })).toEqual({ text: "Approved 1 document.", changed: true });
    expect(bulkNotice({ verb: "Approved", noun: "document", applied: 0, skipped: t.map })).toEqual({ text: "Nothing was changed. Skipped 3: 2 waiting on their approver, 1 not in Needs Review.", changed: false });
  });
});

// ── Every action: Viewer refused, org scoped, nothing selected ──────
const ACTIONS: { name: "bulkApproveDocuments" | "bulkArchiveDocuments" | "bulkRestoreDocuments" | "bulkLinkDocumentsToAthlete" | "bulkSetDocumentType"; extra: Record<string, string> }[] = [
  { name: "bulkApproveDocuments", extra: {} },
  { name: "bulkArchiveDocuments", extra: {} },
  { name: "bulkRestoreDocuments", extra: {} },
  { name: "bulkLinkDocumentsToAthlete", extra: { linkedAthleteId: IDS.athlete } },
  { name: "bulkSetDocumentType", extra: { filedAs: "other" } },
];

// Planted: removed requireRole from open(), watched the Viewer test fail.
describe("LAW: every bulk document action is Admins only, org scoped, and needs a selection", () => {
  for (const a of ACTIONS) {
    it(`${a.name} refuses a Viewer before any write`, async () => {
      data.documents.push(doc(1), doc(2, { lifecycle: "archived" }));
      currentUser = MEMBER_ID;
      const mod = await import("@/lib/actions/documentsBulk");
      await run(() => mod[a.name](ORG_WITH_MODULES, form(a.extra, [D(1), D(2)]))).catch(() => "");
      expect(docWrites()).toHaveLength(0);
      expect(logs()).toHaveLength(0);
    });

    it(`${a.name} leaves another org's document untouched and counts it`, async () => {
      data.documents.push(doc(1, { org_id: elite() }), doc(2));
      const mod = await import("@/lib/actions/documentsBulk");
      const url = await run(() => mod[a.name](ORG_WITH_MODULES, form(a.extra, [D(1), D(2)])));
      expect(rowOf(1)).toEqual(doc(1, { org_id: elite() }));
      expect(docWrites().every((w) => (w.filters ?? []).some((f) => f.column === "org_id" && f.value === bridge()))).toBe(true);
      expect(logs().every((l) => l.subject_id !== D(1))).toBe(true);
      expect(noticeOf(url)).toMatch(/Skipped \d+: .*1 no longer here/);
    });

    it(`${a.name} with nothing selected writes nothing and says so`, async () => {
      const mod = await import("@/lib/actions/documentsBulk");
      const url = await run(() => mod[a.name](ORG_WITH_MODULES, form(a.extra, ["not-an-id"])));
      expect(noticeOf(url)).toBe("Nothing was selected.");
      expect(docWrites()).toHaveLength(0);
    });

    it(`${a.name} comes back to the same view and search`, async () => {
      const mod = await import("@/lib/actions/documentsBulk");
      const url = await run(() => mod[a.name](ORG_WITH_MODULES, form({ ...a.extra, view: "ready", q: "plan" }, [D(9)])));
      expect(url).toMatch(/^\/org\/bridge-fixture\/documents\?view=ready&q=plan&(notice|error)=/);
    });
  }
});

// ── Approve ──────────────────────────────────────────────────────────
// Planted: dropped the moveBlock call from moveMany, watched the gate test fail.
describe("LAW: bulk Approve moves Needs Review to Ready and honours the approver gate", () => {
  beforeEach(() => {
    data.documents.push(
      doc(1, { category: "metrics" }), // no area
      doc(2, { category: "transcript" }), // academic
      doc(3, { category: "metrics", lifecycle: "archived" }), // wrong state
      doc(4, { category: "metrics" }),
      doc(5, { category: "metrics", lifecycle: "processing", lifecycle_changed_at: new Date().toISOString() }), // still being read
    );
  });

  it("with nobody named, every Needs Review document is approved, one log row each, and others are skipped by state", async () => {
    const mod = await import("@/lib/actions/documentsBulk");
    const url = await run(() => mod.bulkApproveDocuments(ORG_WITH_MODULES, form({}, [D(1), D(2), D(3), D(4), D(5)])));
    expect([1, 2, 4].map((n) => rowOf(n).lifecycle)).toEqual(["ready", "ready", "ready"]);
    expect(rowOf(1).approved_by).toBe(OWNER_ID);
    expect(rowOf(3).lifecycle).toBe("archived");
    expect(rowOf(5).lifecycle).toBe("processing");
    expect(logs("document_ready")).toHaveLength(3);
    expect(logs()).toHaveLength(3);
    expect(noticeOf(url)).toBe("Approved 3 documents. Skipped 2: 1 not in Needs Review, 1 still being read.");
  });

  it("a document whose area has another named approver is skipped, not forced, and the notice says why", async () => {
    data.doc_approvers.push({ org_id: bridge(), area: "academic", user_id: APPROVER, set_by: OWNER_ID });
    const mod = await import("@/lib/actions/documentsBulk");
    const url = await run(() => mod.bulkApproveDocuments(ORG_WITH_MODULES, form({}, [D(1), D(2), D(4)])));
    expect(rowOf(2).lifecycle).toBe("needs_review");
    expect(rowOf(2).approved_by).toBe(null);
    expect([1, 4].map((n) => rowOf(n).lifecycle)).toEqual(["ready", "ready"]);
    expect(logs("document_ready").map((l) => l.subject_id).sort()).toEqual([D(1), D(4)]);
    expect(noticeOf(url)).toBe("Approved 2 documents. Skipped 1: 1 waiting on their approver.");
  });

  it("the named approver's own bulk Approve moves their area's documents", async () => {
    data.doc_approvers.push({ org_id: bridge(), area: "academic", user_id: APPROVER, set_by: OWNER_ID });
    currentUser = APPROVER;
    const mod = await import("@/lib/actions/documentsBulk");
    const url = await run(() => mod.bulkApproveDocuments(ORG_WITH_MODULES, form({}, [D(2)])));
    expect(rowOf(2).lifecycle).toBe("ready");
    expect(rowOf(2).approved_by).toBe(APPROVER);
    expect(noticeOf(url)).toBe("Approved 1 document.");
  });

  it("when everything is skipped the notice is an error and nothing is written", async () => {
    data.doc_approvers.push({ org_id: bridge(), area: "academic", user_id: APPROVER, set_by: OWNER_ID });
    const mod = await import("@/lib/actions/documentsBulk");
    const url = await run(() => mod.bulkApproveDocuments(ORG_WITH_MODULES, form({}, [D(2)])));
    expect(url).toContain("error=");
    expect(noticeOf(url)).toBe("Nothing was changed. Skipped 1: 1 waiting on their approver.");
    expect(docWrites()).toHaveLength(0);
    expect(logs()).toHaveLength(0);
  });
});

// ── Archive and Restore ──────────────────────────────────────────────
// Planted: made archive call a delete, watched the no-delete test fail.
describe("LAW: bulk Archive is the soft put-away and Restore its undo", () => {
  it("archives Needs Review and Ready, skips Archived, deletes nothing, logs one row each", async () => {
    data.documents.push(doc(1), doc(2, { lifecycle: "ready" }), doc(3, { lifecycle: "archived" }));
    const mod = await import("@/lib/actions/documentsBulk");
    const url = await run(() => mod.bulkArchiveDocuments(ORG_WITH_MODULES, form({}, [D(1), D(2), D(3)])));
    expect([1, 2, 3].map((n) => rowOf(n).lifecycle)).toEqual(["archived", "archived", "archived"]);
    expect(writes.filter((w) => w.op === "delete")).toHaveLength(0);
    expect(logs("document_archived")).toHaveLength(2);
    expect(noticeOf(url)).toBe("Archived 2 documents. Skipped 1: 1 not in Needs Review or Ready.");
  });

  it("restores Archived to Needs Review, skips the rest, one log row each", async () => {
    data.documents.push(doc(1, { lifecycle: "archived" }), doc(2, { lifecycle: "archived" }), doc(3));
    const mod = await import("@/lib/actions/documentsBulk");
    const url = await run(() => mod.bulkRestoreDocuments(ORG_WITH_MODULES, form({}, [D(1), D(2), D(3)])));
    expect([1, 2, 3].map((n) => rowOf(n).lifecycle)).toEqual(["needs_review", "needs_review", "needs_review"]);
    expect(logs("document_unarchived")).toHaveLength(2);
    expect(noticeOf(url)).toBe("Restored 2 documents. Skipped 1: 1 not archived.");
  });
});

// ── Link to Athlete ──────────────────────────────────────────────────
describe("LAW: bulk Link to Athlete uses the single action's rules", () => {
  it("links to an athlete of this org, skips ones already linked, one log row each", async () => {
    data.documents.push(doc(1), doc(2, { linked_athlete_id: IDS.athlete }), doc(3, { lifecycle: "archived" }));
    const mod = await import("@/lib/actions/documentsBulk");
    const url = await run(() => mod.bulkLinkDocumentsToAthlete(ORG_WITH_MODULES, form({ linkedAthleteId: IDS.athlete }, [D(1), D(2), D(3)])));
    expect([1, 2, 3].map((n) => rowOf(n).linked_athlete_id)).toEqual([IDS.athlete, IDS.athlete, IDS.athlete]);
    expect(logs("document_linked").map((l) => l.subject_id).sort()).toEqual([D(1), D(3)]);
    expect(logs("document_linked").every((l) => l.athlete_id === IDS.athlete)).toBe(true);
    expect(noticeOf(url)).toBe("Linked 2 documents. Skipped 1: 1 already linked to them.");
  });

  // Planted: skipped the orgAthleteName check, watched this fail.
  it("refuses an athlete of another org, or none, before any write", async () => {
    data.documents.push(doc(1));
    const mod = await import("@/lib/actions/documentsBulk");
    const other = await run(() => mod.bulkLinkDocumentsToAthlete(ORG_WITH_MODULES, form({ linkedAthleteId: IDS.athleteElite }, [D(1)])));
    expect(noticeOf(other)).toBe("That athlete is not on this organization's roster.");
    const none = await run(() => mod.bulkLinkDocumentsToAthlete(ORG_WITH_MODULES, form({ linkedAthleteId: "" }, [D(1)])));
    expect(noticeOf(none)).toBe("Pick an athlete to link to.");
    expect(docWrites()).toHaveLength(0);
    expect(logs()).toHaveLength(0);
  });
});

// ── Set Type ─────────────────────────────────────────────────────────
describe("LAW: bulk Set Type uses the single action's rules", () => {
  it("types unread documents, skips read ones, one log row each", async () => {
    data.documents.push(doc(1), doc(2, { category: "transcript" }), doc(3, { requested_category: "metrics" }));
    const mod = await import("@/lib/actions/documentsBulk");
    const url = await run(() => mod.bulkSetDocumentType(ORG_WITH_MODULES, form({ filedAs: "test_scores" }, [D(1), D(2), D(3)])));
    expect(rowOf(1).requested_category).toBe("test_scores");
    expect(rowOf(3).requested_category).toBe("test_scores");
    expect(rowOf(2).category).toBe("transcript");
    expect(rowOf(2).requested_category).toBe(null);
    expect(logs("document_typed").map((l) => l.subject_id).sort()).toEqual([D(1), D(3)]);
    expect(noticeOf(url)).toBe("Typed 2 documents as Test Scores. Skipped 1: 1 read already, so they keep their type.");
  });

  it("refuses a type that is not listed, or none", async () => {
    data.documents.push(doc(1));
    const mod = await import("@/lib/actions/documentsBulk");
    expect(noticeOf(await run(() => mod.bulkSetDocumentType(ORG_WITH_MODULES, form({ filedAs: "passport" }, [D(1)]))))).toBe("Pick one of the types listed.");
    expect(noticeOf(await run(() => mod.bulkSetDocumentType(ORG_WITH_MODULES, form({ filedAs: "" }, [D(1)]))))).toBe("Pick one of the types listed.");
    expect(docWrites()).toHaveLength(0);
  });
});

// ── The log never carries a title or a file name ─────────────────────
describe("LAW: a bulk log row says the kind of document, never its title or file name", () => {
  it("across every action", async () => {
    data.documents.push(doc(1, { category: "metrics" }), doc(2, { category: "metrics" }), doc(3, { lifecycle: "archived" }), doc(4));
    const mod = await import("@/lib/actions/documentsBulk");
    await run(() => mod.bulkApproveDocuments(ORG_WITH_MODULES, form({}, [D(1)])));
    await run(() => mod.bulkArchiveDocuments(ORG_WITH_MODULES, form({}, [D(2)])));
    await run(() => mod.bulkRestoreDocuments(ORG_WITH_MODULES, form({}, [D(3)])));
    await run(() => mod.bulkLinkDocumentsToAthlete(ORG_WITH_MODULES, form({ linkedAthleteId: IDS.athlete }, [D(4)])));
    await run(() => mod.bulkSetDocumentType(ORG_WITH_MODULES, form({ filedAs: "other" }, [D(4)])));
    const all = logs();
    expect(all).toHaveLength(5);
    for (const l of all) {
      expect(String(l.summary)).not.toMatch(/Secret|secret-file/);
      expect(l.subject_type).toBe("document");
      expect(l.actor_id).toBe(OWNER_ID);
    }
  });
});

// ── The screen and the module are wired as the law says ──────────────
const read = (p: string) => readFileSync(p, "utf8");

describe("LAW: the Documents page carries the bulk kit; the actions touch nothing else", () => {
  const page = read("src/app/org/[slug]/documents/page.tsx");
  const actions = read("src/lib/actions/documentsBulk.ts");

  // Planted: unwrapped the list from BulkSelect, watched this fail.
  it("one BulkSelect wraps the list, naming document, over every id in the view", () => {
    expect(page.match(/<BulkSelect/g)).toHaveLength(1);
    expect(page).toMatch(/ids=\{rows\.map\(\(r\) => r\.id\)\}\s+noun="document"/);
    expect(page).toContain("select={<BulkCheck id={doc.id} label={title} />}");
  });

  it("each action is bound to its server action and confirms through a sheet that names the count", () => {
    for (const fn of ["bulkApproveDocuments", "bulkArchiveDocuments", "bulkRestoreDocuments", "bulkLinkDocumentsToAthlete", "bulkSetDocumentType", "bulkSuggestDocuments"]) {
      expect(page).toContain(`${fn}.bind(null, slug)`);
    }
    expect(page.match(/question="[^"]*\{n\}/g)).toHaveLength(6);
    // Archive is a soft put-away, so no action here is a delete.
    expect(page).not.toMatch(/deleteDocument|discardDocument/);
  });

  it("every action starts by requiring Admin, scoping by org, and parsing the ids", () => {
    expect(actions).toMatch(/requireRole\(org\.id, STAFF_ROLES\)/);
    expect(actions).toContain("parseBulkIds(formData)");
    expect(actions).toMatch(/\.eq\("org_id", org\.id\)\s*\.in\("id", parsed\.ids\)/);
    expect(actions.match(/await open\(slug, formData\)/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("no model is called, no file is touched in this module (Suggest reads through the shared helper), and nothing is deleted", () => {
    expect(actions).not.toMatch(/docai\/pipeline|anthropicCaller|createAdminClient|\.delete\(|\.storage|readStoredRecords/i);
  });

  it("Suggest Who and What is capped, never overwrites a decision, and writes no decision of its own", () => {
    expect(actions).toContain("SUGGEST_CAP");
    expect(actions).toContain("refreshSuggestion(");
    const helper = read("src/lib/data/documentSuggestions.ts");
    expect(helper).toMatch(/decided \? \{\} : \{ identity_status/);
    expect(helper).not.toMatch(/subject_athlete_id: s\./);
  });

  it("the shared rules live in one place the single actions also use", () => {
    const single = read("src/lib/actions/documents.ts");
    expect(single).toContain("moveBlock(doc, to, approvers, user.id)");
    expect(single).toContain("typeBlock(doc)");
    expect(single).toContain("typePatch(raw, doc)");
    expect(actions).toContain("moveBlock(doc, to, approvers, user.id)");
    expect(actions).toContain("typeBlock(doc)");
    expect(actions).toContain("typePatch(raw, doc)");
  });
});
