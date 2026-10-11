// A document can be about an athlete (migration 0058, Dave, 2026-10-11):
// picked on upload or on the document screen, optional, and listed on
// the athlete's page. Each law was planted and seen to fail; the plant
// is named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID } from "@/testing/fixture";
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
  delete process.env.ANTHROPIC_API_KEY;
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

function stored(path: string) {
  return {
    originalName: "transcript.pdf",
    originalSize: 120,
    originalMime: "application/pdf",
    kind: "pdf" as const,
    sourceRole: "parent" as const,
    ingestedAt: "2026-10-11T00:00:00.000Z",
    requestId: "req_fixture",
    mediaType: "application/pdf",
    blockType: "document" as const,
    storagePath: path,
  };
}

// Verified this law bites: dropped linked_athlete_id from the insert,
// watched the first case fail, reverted.
describe("LAW: an upload can name the athlete it is about, and only one of this org's", () => {
  it("the picked athlete is stored on the new document", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const orgId = data.orgs[0]!.id as string;
    const r = await processDocument(ORG_WITH_MODULES, { records: [stored(`${orgId}/req_fixture/1-transcript.pdf`)], sourceRole: "parent", requestedCategory: null, linkAthleteId: IDS.athlete });
    expect(r.ok).toBe(true);
    const insert = writes.find((w) => w.table === "documents" && w.op === "insert");
    expect(insert?.rows[0]?.linked_athlete_id).toBe(IDS.athlete);
  });

  it("no athlete picked stores none (an org-wide document)", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const orgId = data.orgs[0]!.id as string;
    const r = await processDocument(ORG_WITH_MODULES, { records: [stored(`${orgId}/req_fixture/1-transcript.pdf`)], sourceRole: "coordinator", requestedCategory: null, linkAthleteId: null });
    expect(r.ok).toBe(true);
    const insert = writes.find((w) => w.table === "documents" && w.op === "insert");
    expect(insert?.rows[0]?.linked_athlete_id ?? null).toBeNull();
  });

  it("an athlete who is not on this org's roster is refused, and nothing is stored", async () => {
    const { processDocument } = await import("@/lib/actions/documents");
    const orgId = data.orgs[0]!.id as string;
    const r = await processDocument(ORG_WITH_MODULES, { records: [stored(`${orgId}/req_fixture/1-transcript.pdf`)], sourceRole: "parent", requestedCategory: null, linkAthleteId: "00000000-0000-0000-0000-00000000dead" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not on this organization's roster/);
    expect(writes.filter((w) => w.table === "documents" && w.op === "insert")).toEqual([]);
  });
});

// Verified this law bites: made linkDocumentToAthlete write athlete_id
// instead, watched the reading-is-untouched case fail, reverted.
describe("LAW: a document's athlete is set and cleared on its screen, logged, and never touches a reading", () => {
  it("links, logs, and leaves athlete_id (where a reading was applied) alone", async () => {
    const { linkDocumentToAthlete } = await import("@/lib/actions/documents");
    const to = await run(() => linkDocumentToAthlete(ORG_WITH_MODULES, "doc-mismatch", form({ linkedAthleteId: IDS.athlete })));
    expect(to).toMatch(/notice=Linked to /);
    expect(doc("doc-mismatch").linked_athlete_id).toBe(IDS.athlete);
    expect(doc("doc-mismatch").athlete_id ?? null).toBeNull();
    const log = writes.find((w) => w.table === "activity_log");
    expect((log?.rows[0] as { action?: string; athlete_id?: string }).action).toBe("document_linked");
    expect((log?.rows[0] as { athlete_id?: string }).athlete_id).toBe(IDS.athlete);
  });

  it("No Athlete clears the link; another org's athlete is refused", async () => {
    const { linkDocumentToAthlete } = await import("@/lib/actions/documents");
    expect(await run(() => linkDocumentToAthlete(ORG_WITH_MODULES, "doc-word", form({ linkedAthleteId: "" })))).toMatch(/No athlete linked now/);
    expect(doc("doc-word").linked_athlete_id).toBeNull();
    const foreign = data.athletes.find((a) => a.org_id !== data.orgs[0]!.id)!.id as string;
    expect(await run(() => linkDocumentToAthlete(ORG_WITH_MODULES, "doc-word", form({ linkedAthleteId: foreign })))).toMatch(/not on this organization's roster/);
    expect(doc("doc-word").linked_athlete_id).toBeNull();
  });
});

// Verified this law bites: removed the Documents section from the
// athlete page, watched it fail, reverted.
describe("LAW: the screens offer the link and the athlete page lists the documents", () => {
  it("the document screen has the Athlete picker with No Athlete as a choice", async () => {
    const html = await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-word" }), searchParams: P({}) });
    expect(html).toMatch(/name="linkedAthleteId"/);
    expect(text(html)).toMatch(/No Athlete/);
    expect(text(html)).toMatch(/Save Athlete/);
  });

  it("the upload screen has the optional Athlete picker, preselected from an athlete's page", async () => {
    const html = await render("@/app/org/[slug]/documents/new/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ athlete: IDS.athlete }) });
    expect(html).toMatch(/name="linkAthleteId"/);
    expect(html).toMatch(new RegExp(`<option value="${IDS.athlete}" selected=""`));
  });

  it("the athlete page lists linked documents and ones a reading was applied to, and nothing of anyone else's", async () => {
    const applied = doc("doc-mismatch");
    applied.athlete_id = IDS.athlete;
    const html = await render("@/app/org/[slug]/roster/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: IDS.athlete }), searchParams: P({}) });
    expect(html).toMatch(/href="\/org\/[^"]+\/documents\/doc-word"/);
    expect(html).toMatch(/href="\/org\/[^"]+\/documents\/doc-mismatch"/);
    expect(html).not.toMatch(/href="\/org\/[^"]+\/documents\/doc-ready"/);
    expect(text(html)).toMatch(/Documents/);
  });
});

// Verified this law bites: put a bare athletes(...) embed back on the
// documents list, watched it fail, reverted.
describe("LAW: a documents query that embeds athletes names which link", () => {
  it("every athletes embed on documents says documents_athlete_id_fkey (two foreign keys since 0058)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
      }
    };
    walk("src");
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/from\("documents"\)[\s\S]{0,200}?\.select\(\s*["`]([^"`]*)["`]/g)) {
        if (/(^|[,\s])athletes\s*\(/.test(m[1]!)) bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });
});
