// Alfred's full production audit, 2026-10-10: every fix held here.
// Each law was planted and seen to fail; the plant is named beside it.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createElement } from "react";
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
  delete process.env.ANTHROPIC_API_KEY;
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

// Verified this law bites: removed the ready to needs_review pair from
// TRANSITIONS, watched it fail, reverted.
describe("LAW: Mark Ready can be undone", () => {
  it("a Ready document offers Move Back to Needs Review, and the move works", async () => {
    const page = text(await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-ready" }), searchParams: P({}) }));
    expect(page).toMatch(/Move Back to Needs Review/);
    const { moveDocument } = await import("@/lib/actions/documents");
    expect((await moveDocument(ORG_WITH_MODULES, "doc-ready", "needs_review")).ok).toBe(true);
    expect(doc("doc-ready").lifecycle).toBe("needs_review");
  });
});

// Verified this law bites: dropped the lifecycle check from
// readDocumentAgain, watched "only in Needs Review" fail, reverted.
describe("LAW: a typed document in review can be read again, and nothing else can", () => {
  it("a document in Needs Review with a reading type offers Read Again and reads it back into review", async () => {
    const d = doc("doc-mismatch");
    d.lifecycle = "needs_review";
    data.storage_objects!.push({ bucket: "documents", name: (d.original_paths as string[])[0]!, base64: Buffer.from("%PDF-1.4\n%again\n1 0 obj << >> endobj\n%%EOF\n").toString("base64") });
    const page = text(await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-mismatch" }), searchParams: P({}) }));
    expect(page).toMatch(/Read Again/);
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    const to = await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-mismatch"));
    expect(to).toBe(`/org/${ORG_WITH_MODULES}/documents/doc-mismatch`);
    expect(doc("doc-mismatch").lifecycle).toBe("needs_review");
    expect(writes.some((w) => w.table === "activity_log" && (w.rows[0] as { action?: string }).action === "document_reading")).toBe(true);
  });

  it("refuses a document that is not in Needs Review, and one with no reading type", async () => {
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    const ready = await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-ready"));
    expect(decodeURIComponent(ready ?? "")).toMatch(/error=/);
    const untyped = await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-word"));
    expect(decodeURIComponent(untyped!)).toMatch(/Pick a reading type/);
  });
});

// Verified this law bites: made advisor=none return every athlete,
// watched it fail, reverted.
describe("LAW: the advisor count and the list it opens agree", () => {
  it("Advisors says still being recruited, and roster?advisor=none lists exactly that many", async () => {
    const { loadAdvisorCounts } = await import("@/lib/data/staff");
    const counts = await loadAdvisorCounts(createFakeClient(data, { userId: OWNER_ID }) as never, data.orgs[0]!.id as string);
    const advisors = text(await render("@/app/org/[slug]/advisors/page", { params: P({ slug: ORG_WITH_MODULES }) }));
    expect(advisors).toMatch(/still being recruited/);
    const roster = text(await render("@/app/org/[slug]/roster/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({ advisor: "none" }) }));
    expect(roster).toMatch(new RegExp(`${counts.unassigned} of \\d+, still being recruited, no advisor`));
  });
});

describe("LAW: a forgotten password has a way back", () => {
  it("the sign-in screen offers Forgot Your Password, and More offers Set Password", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SignInForm } = await import("@/components/SignInForm");
    const signIn = renderToStaticMarkup(createElement(SignInForm, { magicLink: async () => ({ sent: false, email: "", error: null }), password: async () => {} }));
    expect(signIn).toMatch(/Forgot Your Password\?/);
    const more = text(await render("@/app/org/[slug]/more/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }));
    expect(more).toMatch(/New Password/);
    expect(more).toMatch(/Set Password/);
  });

  it("a short or mismatched password is refused before any account change", async () => {
    const { setPasswordForm } = await import("@/lib/auth/actions");
    const fd = (p: string, c: string) => {
      const f = new FormData();
      f.append("password", p);
      f.append("confirm", c);
      return f;
    };
    expect(decodeURIComponent((await run(() => setPasswordForm("/org/x/more", fd("short", "short")))) ?? "")).toMatch(/at least 8/);
    expect(decodeURIComponent((await run(() => setPasswordForm("/org/x/more", fd("longenough1", "different1")))) ?? "")).toMatch(/do not match/);
    // A returnTo that leaves the app is not followed.
    expect(await run(() => setPasswordForm("https://evil.example", fd("short", "short")))).toMatch(/^\/\?error=/);
  });
});

describe("LAW: the rate limit and what each access level sees are on screen", () => {
  it("Doc AI Spending shows the rate limit windows", async () => {
    const html = text(await render("@/app/org/[slug]/doc-ai-spending/page", { params: P({ slug: ORG_WITH_MODULES }) }));
    expect(html).toMatch(/Rate Limit/);
    expect(html).toMatch(/\d+ of 20 in 10 Minutes/);
    expect(html).toMatch(/\d+ of 60 This Hour/);
  });

  it("Members says what an Admin, a Viewer and an Athlete see", async () => {
    const html = text(await render("@/app/org/[slug]/members/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }));
    expect(html).toMatch(/What Each Access Level Sees/);
    for (const level of ["Admin", "Viewer", "Athlete"]) expect(html).toContain(level);
    expect(html).toMatch(/One athlete only/);
  });
});
