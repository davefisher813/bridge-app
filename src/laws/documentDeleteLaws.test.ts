// Delete (Dave, Oct 11): one way to remove a document for good, behind
// an Admin check and a confirm. Each law was planted and seen to fail;
// the plant is named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, MEMBER_ID, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

const REDIRECT = "NEXT_REDIRECT:";
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let userId = OWNER_ID;

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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId, recorded: writes }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes, serviceRole: true }) }));

beforeEach(() => {
  writes = [];
  data = buildFixture();
  userId = OWNER_ID;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
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

// Verified this law bites: dropped the documents delete from
// deleteDocument, watched the row stay, reverted.
describe("LAW: Delete removes the document, its readings and its files, and nothing else", () => {
  it("the row and its stored files go, it is off its meeting, and the delete is logged", async () => {
    const d = doc("doc-word");
    const paths = [...new Set([...((d.storage_paths as string[]) ?? []), ...((d.original_paths as string[]) ?? [])])];
    for (const p of paths) if (!data.storage_objects!.some((o) => o.name === p)) data.storage_objects!.push({ bucket: "documents", name: p, base64: "eA==" });
    const coursesBefore = JSON.stringify(data.athlete_courses ?? []);
    const { deleteDocument } = await import("@/lib/actions/documents");
    const to = await run(() => deleteDocument(ORG_WITH_MODULES, "doc-word"));
    expect(to).toMatch(/\/documents\?notice=Deleted team-letter\.docx\./);
    expect(data.documents.some((x) => x.id === "doc-word")).toBe(false);
    for (const p of paths) expect(data.storage_objects!.some((o) => o.name === p)).toBe(false);
    expect((data.board_meeting_documents ?? []).some((m) => m.document_id === "doc-word")).toBe(false);
    expect(JSON.stringify(data.athlete_courses ?? [])).toBe(coursesBefore);
    const log = writes.find((w) => w.table === "activity_log");
    expect((log?.rows[0] as { action?: string }).action).toBe("document_deleted");
  });

  it("a file another document still uses is kept", async () => {
    const d = doc("doc-word");
    const shared = (d.original_paths as string[])[0]!;
    if (!data.storage_objects!.some((o) => o.name === shared)) data.storage_objects!.push({ bucket: "documents", name: shared, base64: "eA==" });
    doc("doc-ready").original_paths = [shared];
    const { deleteDocument } = await import("@/lib/actions/documents");
    await run(() => deleteDocument(ORG_WITH_MODULES, "doc-word"));
    expect(data.storage_objects!.some((o) => o.name === shared)).toBe(true);
  });

  it("the Documents views lose it and their counts drop by one", async () => {
    const count = async (view?: string) => {
      const html = await render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P(view ? { view } : {}) });
      return Number(text(html).match(/(?:All|Needs Review|Ready|Archived|Maybe)[A-Za-z ]*: (\d+) documents?/)![1]);
    };
    const [all, archived] = [await count(), await count("archived")];
    const { deleteDocument } = await import("@/lib/actions/documents");
    await run(() => deleteDocument(ORG_WITH_MODULES, "doc-archived"));
    expect(await count()).toBe(all - 1);
    expect(await count("archived")).toBe(archived - 1);
  });
});

// Verified this law bites: took the applied check out of deleteDocument,
// watched the applied document go, reverted.
describe("LAW: Delete is an Admin's, asks first naming the file, and never loses an Undo", () => {
  // The dialog opens in the browser (the e2e test taps it and reads it);
  // here the button and the words it is given are held.
  it("the document screen's Delete is behind a confirm that names the file and says it cannot be undone", async () => {
    const html = await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-word" }), searchParams: P({}) });
    expect(html).toMatch(/>Delete<\/button>/);
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/org/[slug]/documents/[id]/page.tsx", "utf8");
    const block = page.slice(page.indexOf("<Form action={deleteAction}>"), page.indexOf("</Form>", page.indexOf("<Form action={deleteAction}>")));
    expect(block).toContain("title={`Delete ${doc.file_name}?`}");
    expect(block).toContain("This permanently removes ${doc.file_name}, its stored file and its readings. It cannot be undone.");
    expect(block).toContain('confirmLabel="Delete"');
  });

  it("a reading still applied to an athlete is refused until it is undone", async () => {
    doc("doc-word").status = "applied";
    const { deleteDocument } = await import("@/lib/actions/documents");
    expect(await run(() => deleteDocument(ORG_WITH_MODULES, "doc-word"))).toMatch(/Undo it first/);
    expect(data.documents.some((x) => x.id === "doc-word")).toBe(true);
  });

  it("a Viewer cannot delete", async () => {
    userId = MEMBER_ID;
    const { deleteDocument } = await import("@/lib/actions/documents");
    await run(() => deleteDocument(ORG_WITH_MODULES, "doc-word"));
    expect(data.documents.some((x) => x.id === "doc-word")).toBe(true);
  });
});
