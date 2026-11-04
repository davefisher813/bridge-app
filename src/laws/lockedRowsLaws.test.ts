// Locked documents on the screens (migration 0078; Dave, 2026-11-03: "show
// as locked", design A, "locked rows are view-only"). An Admin who cannot
// open a document's file sees that it exists and nothing about it.
//
// The database half is proved by scripts/proof/0078_proofs.sql; this is the
// app's half: what the stubs are, what the list does with them, the download
// answer, and the bulk and link actions on a document the person cannot open.
//
// Verified these laws bite: gave a locked row a checkbox, let the download
// route answer 200 for a stub, and let bulk Approve treat a stub as "no
// longer here", watched each fail, reverted.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ADMIN_TWO_ID, buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID, withSecondAdmin } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { fakeLinkDocument, fakeRpc } from "@/testing/fakeRpc";

const REDIRECT = "NEXT_REDIRECT:";
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
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, serviceRole: true }) }));

const bridge = () => (data.orgs as { id: string; slug: string }[]).find((o) => o.slug === ORG_WITH_MODULES)!.id;
const P = <T,>(v: T) => Promise.resolve(v);
const noticeOf = (url: string) => decodeURIComponent((url.match(/[?&](?:notice|error)=([^&]*)/) ?? [])[1] ?? "");

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

beforeEach(() => {
  currentUser = ADMIN_TWO_ID;
  writes = [];
  data = withSecondAdmin(buildFixture());
});

describe("LAW: documents_locked hands an Admin the stubs they cannot open, and only those columns", () => {
  it("the second Admin gets the two stubs; the master and a Viewer get none", () => {
    const stubs = fakeRpc(data, ADMIN_TWO_ID, "documents_locked", { p_org: bridge() }).data as Record<string, unknown>[];
    expect(stubs.map((s) => s.id).sort()).toEqual([IDS.lockedDocument, IDS.lockedDocumentReady].sort());
    for (const s of stubs) expect(Object.keys(s).sort()).toEqual(["created_at", "id", "lifecycle", "org_id", "status"]);
    expect(fakeRpc(data, OWNER_ID, "documents_locked", { p_org: bridge() }).data).toEqual([]);
    expect(fakeRpc(data, MEMBER_ID, "documents_locked", { p_org: bridge() }).data).toEqual([]);
  });
});

describe("LAW: the list draws a locked row without a checkbox, counted with the rest", () => {
  const page = readFileSync("src/app/org/[slug]/documents/page.tsx", "utf8");

  it("LockedRow is a plain kit Row: a lock, the one title, the state and the date, and no BulkCheck", () => {
    const start = page.indexOf("function LockedRow");
    const body = page.slice(start, page.indexOf("function lockedState", start));
    expect(body).toContain('kind="lock"');
    expect(body).toContain("LOCKED_TITLE");
    expect(body).toContain("LifecycleChip");
    expect(body).not.toContain("BulkCheck");
    expect(body).not.toMatch(/file_name|title=\{doc\./);
  });

  it("the tiles, the header and each section count locked rows with the others", () => {
    expect(page).toContain("value={inView(v.id).length + lockedIn(v.id).length}");
    expect(page).toContain("count={files.length + lockedHere.length}");
    expect(page).toContain("rows.length + lockedIn(view).length");
  });

  it("a search never lists a locked row, and the selection bar covers only rows that can be acted on", () => {
    expect(page).toContain("const lockedMatched = q ? [] : lockedAll;");
    expect(page).toMatch(/ids=\{rows\.map\(\(r\) => r\.id\)\}/);
  });
});

describe("LAW: the download answer for a locked document is 403 Locked, anything else gone is 404", () => {
  it("403 for a stub, 404 for an id nobody has, and no bytes either way", async () => {
    const { GET } = await import("@/app/org/[slug]/documents/[id]/download/route");
    const get = (id: string) => GET(new NextRequest(`http://localhost/org/${ORG_WITH_MODULES}/documents/${id}/download`), { params: P({ slug: ORG_WITH_MODULES, id }) });
    const locked = await get(IDS.lockedDocument);
    expect(locked.status).toBe(403);
    expect(await locked.text()).toBe("Locked");
    const gone = await get("00000000-0000-0000-0000-00000000dead");
    expect(gone.status).toBe(404);
  });

  it("a Viewer gets the same 404 as ever, not the locked answer", async () => {
    currentUser = MEMBER_ID;
    const { GET } = await import("@/app/org/[slug]/documents/[id]/download/route");
    const res = await GET(new NextRequest(`http://localhost/x`), { params: P({ slug: ORG_WITH_MODULES, id: IDS.lockedDocument }) });
    expect(res.status).toBe(404);
  });
});

describe("LAW: a bulk action counts a locked document as locked, and never writes to it", () => {
  it("Approve, Archive, Restore, Link and Set Type say 'locked to you' for a stub", async () => {
    const mod = await import("@/lib/actions/documentsBulk");
    const calls: [string, () => Promise<void>][] = [
      ["Approve", () => mod.bulkApproveDocuments(ORG_WITH_MODULES, form({}, [IDS.lockedDocument]))],
      ["Archive", () => mod.bulkArchiveDocuments(ORG_WITH_MODULES, form({}, [IDS.lockedDocument]))],
      ["Restore", () => mod.bulkRestoreDocuments(ORG_WITH_MODULES, form({}, [IDS.lockedDocument]))],
      ["Link", () => mod.bulkLinkDocumentsToAthlete(ORG_WITH_MODULES, form({ linkedAthleteId: IDS.athlete }, [IDS.lockedDocument]))],
      ["Set Type", () => mod.bulkSetDocumentType(ORG_WITH_MODULES, form({ filedAs: "other" }, [IDS.lockedDocument]))],
    ];
    for (const [name, call] of calls) {
      const url = await run(call);
      expect(noticeOf(url), name).toMatch(/1 locked to you/);
    }
    expect(writes.filter((w) => w.table === "documents" || w.table === "activity_log")).toHaveLength(0);
  });
});

describe("LAW: linking goes through document_link_athlete and never moves a document that has an athlete", () => {
  const call = (user: string | null, doc: string, athlete: string | null) => fakeLinkDocument(data, user, { p_doc: doc, p_athlete: athlete }, writes, () => null);

  it("any Admin links an unlinked document; the same call for the same athlete again changes nothing", () => {
    data.documents.push({ id: "d-open", org_id: bridge(), file_name: "open.pdf", file_size: 1, media_type: "application/pdf", status: "pending", lifecycle: "needs_review", athlete_id: null, linked_athlete_id: null, subject_athlete_id: null });
    expect(call(ADMIN_TWO_ID, "d-open", IDS.athlete).error).toBeNull();
    expect((data.documents.find((d) => d.id === "d-open") as Record<string, unknown>).linked_athlete_id).toBe(IDS.athlete);
    expect(call(ADMIN_TWO_ID, "d-open", IDS.athlete).error).toBeNull();
    expect(call(ADMIN_TWO_ID, "d-open", IDS.athleteNoGpa).error?.message).toMatch(/already belongs to an athlete/);
    expect(call(ADMIN_TWO_ID, "d-open", null).error?.message).toMatch(/already belongs to an athlete/);
    expect(writes.filter((w) => w.table === "documents")).toHaveLength(1);
  });

  it("refuses a locked document, a Viewer, a signed-out caller and an athlete not on the roster", () => {
    data.documents.push({ id: IDS.lockedDocument, org_id: bridge(), file_name: "x.pdf", file_size: 1, media_type: "application/pdf", status: "pending", lifecycle: "needs_review", athlete_id: null, linked_athlete_id: null, subject_athlete_id: null });
    expect(call(ADMIN_TWO_ID, IDS.lockedDocument, IDS.athlete).error?.message).toMatch(/this document is locked/);
    expect(call(MEMBER_ID, IDS.lockedDocument, IDS.athlete).error?.code).toBe("42501");
    expect(call(null, IDS.lockedDocument, IDS.athlete).error?.code).toBe("42501");
    data.documents.push({ id: "d-open", org_id: bridge(), file_name: "open.pdf", file_size: 1, media_type: "application/pdf", status: "pending", lifecycle: "needs_review", athlete_id: null, linked_athlete_id: null, subject_athlete_id: null });
    expect(call(ADMIN_TWO_ID, "d-open", "00000000-0000-0000-0000-0000000000ff").error?.code).toBe("22023");
  });

  it("both the single and the bulk link actions use linkDocument, not a bare update", () => {
    const single = readFileSync("src/lib/actions/documents.ts", "utf8");
    const bulk = readFileSync("src/lib/actions/documentsBulk.ts", "utf8");
    expect(single).toContain("await linkDocument(supabase,");
    expect(bulk).toContain("await linkDocument(supabase,");
    expect(bulk).not.toMatch(/\.update\(\{ linked_athlete_id/);
  });
});

// Tony's 0078 gate, item 3 (low severity): the document_linked log line is
// read by every Admin, so it never names the athlete.
// Verified this law bites: put the athlete's name back into the template,
// watched the first test fail, reverted.
describe("LAW: a document_linked log line never names the athlete", () => {
  it("new lines say 'an athlete', whatever names the caller passes", async () => {
    const { activitySummary } = await import("@/lib/data/activity");
    expect(activitySummary("document_linked", { kind: "transcript", to: "Jordan Lee", from: "Sam Diaz" })).toBe("Linked a transcript to an athlete");
    expect(activitySummary("document_linked", { kind: "transcript", to: null, from: "Sam Diaz" })).toBe("Unlinked a transcript from an athlete");
  });

  it("lines already written with names are shown masked, and other lines are left alone", async () => {
    const { readableSummary } = await import("@/components/ActivityRows");
    expect(readableSummary("Linked a transcript to Jordan Lee instead of Sam Diaz", "document_linked")).toBe("Linked a transcript to an athlete");
    expect(readableSummary("Unlinked a transcript from Sam Diaz", "document_linked")).toBe("Unlinked a transcript from an athlete");
    expect(readableSummary("Linked Pat Chair's board seat to their donor record", "board_seat_donor_linked")).toBe("Linked Pat Chair's board seat to their donor record");
  });
});
