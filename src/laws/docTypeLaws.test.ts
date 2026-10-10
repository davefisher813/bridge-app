// A document shows the type a person picked, and a board document or an
// athlete profile can be filed as one (migration 0054; Alfred, 2026-10-10:
// 13 of 16 files went up as No Type, and Transcript did not stick).
// Verified this law bites: put the list back to reading `category` alone,
// watched "Transcript sticks" fail; dropped the reader-type refusal from
// fileDocumentAs, watched "keeps a reading type" fail. Reverted both.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

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
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }) }));

beforeEach(() => {
  writes = [];
  data = buildFixture();
});

const P = <T>(v: T) => Promise.resolve(v);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const doc = (id: string) => data.documents.find((d) => d.id === id)!;

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
    if (m.startsWith(REDIRECT)) return m.slice(REDIRECT.length);
    throw e;
  }
}

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.append(k, v);
  return fd;
}

describe("LAW: a document shows the type a person picked", () => {
  it("Transcript sticks when the reader could not read the file", async () => {
    doc("doc-word").requested_category = "transcript";
    const list = text(await render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }));
    expect(list).toMatch(/Transcript team-letter\.docx|Transcript · team-letter|Transcript\b[^·]*team-letter/);
    const page = text(await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-word" }), searchParams: P({}) }));
    expect(page).toMatch(/Type Transcript/);
  });

  it("a filed type shows on the list and the document", async () => {
    doc("doc-word").filed_as = "board_document";
    const list = text(await render("@/app/org/[slug]/documents/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }));
    expect(list).toMatch(/Board Document/);
    const page = text(await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-word" }), searchParams: P({}) }));
    expect(page).toMatch(/Type Board Document/);
  });

  it("the uploader offers Board Document and Athlete Profile", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { DocumentUploader } = await import("@/components/DocumentUploader");
    const html = renderToStaticMarkup(createElement(DocumentUploader, { slug: ORG_WITH_MODULES, orgId: data.orgs[0]!.id as string }));
    expect(html).toMatch(/Board Document/);
    expect(html).toMatch(/Athlete Profile/);
  });
});

// Verified this law bites: dropped READER_TYPES from the document
// screen's File As list, watched it fail, reverted.
describe("LAW: the document screen offers every type the upload form does", () => {
  it("File As lists the same ten types as the uploader", async () => {
    const page = await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-word" }), searchParams: P({}) });
    const select = page.slice(page.indexOf('name="filedAs"'), page.indexOf("</select>", page.indexOf('name="filedAs"')));
    const offered = [...select.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { DocumentUploader } = await import("@/components/DocumentUploader");
    const up = text(renderToStaticMarkup(createElement(DocumentUploader, { slug: ORG_WITH_MODULES, orgId: data.orgs[0]!.id as string })));
    expect(offered).toEqual(["No Type", "Transcript", "Test Scores", "Offer Letter", "Recommendation", "Financial Aid", "Metrics Report", "Board Document", "Athlete Profile", "Other"]);
    for (const label of offered) expect(up).toContain(label);
  });
});

describe("LAW: filing a document never relabels a reading", () => {
  it("files an untyped document and clears the No type chosen reason", async () => {
    doc("doc-word").review_reason = "No type chosen.";
    const { fileDocumentAs } = await import("@/lib/actions/documents");
    const to = await run(() => fileDocumentAs(ORG_WITH_MODULES, "doc-word", form({ filedAs: "athlete_profile" })));
    expect(to).toMatch(/notice=Type%20set%20to%20Athlete%20Profile/);
    expect(doc("doc-word").filed_as).toBe("athlete_profile");
    expect(doc("doc-word").review_reason).toBeNull();
  });

  it("sets a reader type on an unread document as a label, never a reading", async () => {
    doc("doc-word").filed_as = "other";
    const { fileDocumentAs } = await import("@/lib/actions/documents");
    const to = await run(() => fileDocumentAs(ORG_WITH_MODULES, "doc-word", form({ filedAs: "transcript" })));
    expect(to).toMatch(/notice=Type%20set%20to%20Transcript/);
    expect(doc("doc-word").requested_category).toBe("transcript");
    expect(doc("doc-word").filed_as).toBeNull();
    expect(doc("doc-word").category ?? null).toBeNull();
    expect(doc("doc-word").status).toBe("pending");
  });

  it("keeps the type of a reading, and refuses a type it does not know", async () => {
    const { fileDocumentAs } = await import("@/lib/actions/documents");
    const read = data.documents.find((d) => d.category && d.extracted)!;
    const to = await run(() => fileDocumentAs(ORG_WITH_MODULES, read.id as string, form({ filedAs: "board_document" })));
    expect(decodeURIComponent(to!)).toMatch(/keeps the type of its reading/);
    const bad = await run(() => fileDocumentAs(ORG_WITH_MODULES, "doc-word", form({ filedAs: "bylaws" })));
    expect(decodeURIComponent(bad!)).toMatch(/Pick one of the types/);
    expect(writes.filter((w) => w.op === "update")).toEqual([]);
  });
});
