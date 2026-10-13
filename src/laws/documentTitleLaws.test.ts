// A document's title (migration 0069, data cleanup 2026-10-13). The file
// name is part of the original record and never changes (0048); a file
// named for what it is not gets a title an Admin sets, shown in its
// place everywhere it is listed, with the file name still beside it.
//
// Held to: the rule (blank clears, trimmed, at most 200); the action
// writes only the title, scoped by id and org, logs one row, refuses a
// Viewer; the list, the document screen and meeting materials show the
// title; the migration adds a column and never touches file_name.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID, MEMBER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { filterColumns, form, run, writesTo } from "@/testing/actionHarness";
import { documentDisplayName, parseDocumentTitle } from "@/lib/documents/title";

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
    throw new Error("NEXT_REDIRECT:" + url);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
});

describe("the title rule", () => {
  it("trims, collapses spaces, clears on blank and caps at 200", () => {
    expect(parseDocumentTitle("  College   counseling proposal ")).toEqual({ ok: true, title: "College counseling proposal" });
    expect(parseDocumentTitle("   ")).toEqual({ ok: true, title: null });
    expect(parseDocumentTitle("x".repeat(201)).ok).toBe(false);
  });
  it("a document is called by its title, else its file name", () => {
    expect(documentDisplayName({ title: "Bylaws", file_name: "a.docx" })).toBe("Bylaws");
    expect(documentDisplayName({ title: null, file_name: "a.docx" })).toBe("a.docx");
  });
});

describe("renameDocument", () => {
  it("writes only the title, scoped by id and org, and logs one row", async () => {
    const { renameDocument } = await import("@/lib/actions/documentTitle");
    const r = await run(() => renameDocument(ORG_WITH_MODULES, IDS.document, form({ title: "Fixture Transcript, Fall" })));
    expect(decodeURIComponent(r.redirect!)).toContain("Title saved.");
    const ups = writesTo(writes, "documents", "update");
    expect(ups).toHaveLength(1);
    expect(ups[0]!.rows[0]).toEqual({ title: "Fixture Transcript, Fall" });
    expect(filterColumns(ups[0])).toEqual(["id", "org_id"]);
    const logs = writesTo(writes, "activity_log", "insert");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.rows[0]).toMatchObject({ action: "document_renamed", subject_id: IDS.document });
    expect(String(logs[0]!.rows[0]!.summary)).not.toContain("Fixture Transcript, Fall");
  });

  it("a blank title clears it back to the file name", async () => {
    const { renameDocument } = await import("@/lib/actions/documentTitle");
    const r = await run(() => renameDocument(ORG_WITH_MODULES, IDS.document, form({ title: "  " })));
    expect(decodeURIComponent(r.redirect!)).toContain("Title cleared");
    expect(writesTo(writes, "documents", "update")[0]!.rows[0]).toEqual({ title: null });
  });

  it("refuses a Viewer before any write", async () => {
    currentUser = MEMBER_ID;
    const { renameDocument } = await import("@/lib/actions/documentTitle");
    await run(() => renameDocument(ORG_WITH_MODULES, IDS.document, form({ title: "Nope" }))).catch(() => null);
    expect(writesTo(writes, "documents")).toHaveLength(0);
  });
});

describe("the screens show the title", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the list, the document screen, the athlete page and meeting materials read and show it", () => {
    expect(read("src/app/org/[slug]/documents/page.tsx")).toMatch(/const title = doc\.title/);
    const detail = read("src/app/org/[slug]/documents/[id]/page.tsx");
    expect(detail).toContain("title={doc.title ?? headline}");
    expect(detail).toContain("renameDocument.bind(null, slug, doc.id)");
    expect(read("src/app/org/[slug]/roster/[id]/page.tsx")).toContain("title={d.title ?? d.label ?? d.file_name}");
    expect(read("src/app/org/[slug]/board-governance/meetings/[meetingId]/page.tsx")).toContain("title={d.title ?? d.file_name}");
  });

  it("the migration adds a column and leaves the file name alone", () => {
    const sql = read("migrations/0069_document_title.sql").replace(/--.*$/gm, "");
    expect(sql).toMatch(/add column if not exists title text/);
    expect(sql).not.toMatch(/file_name/);
    expect(sql).not.toMatch(/documents_original_is_immutable/);
  });
});
