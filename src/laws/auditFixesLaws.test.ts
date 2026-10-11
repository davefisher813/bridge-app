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

// ── Live check of the fixes, 2026-10-10 ─────────────────────────────

// Verified this law bites: put the old needs_review-only condition back
// on showReadAgain, watched the Ready and No Type cases fail, reverted.
describe("LAW: Read Again is on every document a person can still change", () => {
  it("a Ready document with a reading type reads again, landing in Needs Review", async () => {
    const d = doc("doc-mismatch");
    d.lifecycle = "ready";
    data.storage_objects!.push({ bucket: "documents", name: (d.original_paths as string[])[0]!, base64: Buffer.from("%PDF-1.4\n%again\n1 0 obj << >> endobj\n%%EOF\n").toString("base64") });
    const html = await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-mismatch" }), searchParams: P({}) });
    expect(text(html)).toMatch(/Read Again/);
    const { readDocumentAgain } = await import("@/lib/actions/documents");
    expect(await run(() => readDocumentAgain(ORG_WITH_MODULES, "doc-mismatch"))).toBe(`/org/${ORG_WITH_MODULES}/documents/doc-mismatch`);
    expect(doc("doc-mismatch").lifecycle).toBe("needs_review");
  });

  it("a document that cannot be read still shows Read Again, switched off, with what to do", async () => {
    const html = await render("@/app/org/[slug]/documents/[id]/page", { params: P({ slug: ORG_WITH_MODULES, id: "doc-word" }), searchParams: P({}) });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Read Again<\/button>/);
    expect(text(html)).toMatch(/Pick a reading type under File As|The reader reads PDF, JPG and PNG/);
  });
});

// Verified this law bites: removed the Advisor Hub row from Advisors,
// watched it fail, reverted.
describe("LAW: the Advisor Hub exists and Advisors opens it", () => {
  it("Advisors links to it, and it lists who is due, the no-advisor count and the latest check-ins", async () => {
    expect(await render("@/app/org/[slug]/advisors/page", { params: P({ slug: ORG_WITH_MODULES }) })).toMatch(new RegExp(`href="/org/${ORG_WITH_MODULES}/advisor-hub"`));
    const hub = text(await render("@/app/org/[slug]/advisor-hub/page", { params: P({ slug: ORG_WITH_MODULES }) }));
    expect(hub).toMatch(/Advisor Hub/);
    expect(hub).toMatch(/Due for a Check-In/);
    expect(hub).toMatch(/No Advisor Yet/);
    expect(hub).toMatch(/Latest Check-Ins/);
    expect(hub).not.toMatch(/Nothing Here/);
  });
});

// Verified this law bites: dropped isCheckinPhotoFor from acceptPhoto,
// watched the foreign path get stored, reverted.
describe("LAW: a check-in carries a photo, checked before it is stored", () => {
  const ATHLETE = "00000000-0000-0000-0000-0000000000c1";
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };
  const orgId = () => data.orgs.find((o) => o.slug === ORG_WITH_MODULES)!.id as string;
  // The server reads the photo back with the service role, as it does on
  // production; the admin client here is the fixture.
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  });

  it("a photo the server can read is stored on the new check-in", async () => {
    const path = `${orgId()}/${ATHLETE}/1770000000000.jpg`;
    data.storage_objects!.push({ bucket: "checkin-photos", name: path, base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64") });
    const { logCheckin } = await import("@/lib/actions/checkins");
    const r = await logCheckin(ORG_WITH_MODULES, ATHLETE, { errors: {} }, form({ kind: "meeting", occurredOn: "2026-10-09", photoPath: path }));
    expect(r.errors).toEqual({});
    const ins = writes.find((w) => w.table === "athlete_checkins" && w.op === "insert");
    expect((ins?.rows[0] as { photo_path?: string }).photo_path).toBe(path);
  });

  it("another athlete's path, a missing file and a file that is not a JPEG are refused, and the refused file is removed", async () => {
    const { logCheckin } = await import("@/lib/actions/checkins");
    const foreign = await logCheckin(ORG_WITH_MODULES, ATHLETE, { errors: {} }, form({ kind: "call", photoPath: `${orgId()}/00000000-0000-0000-0000-0000000000c9/1.jpg` }));
    expect(foreign.errors.photo).toMatch(/not uploaded for this athlete/);
    const missing = await logCheckin(ORG_WITH_MODULES, ATHLETE, { errors: {} }, form({ kind: "call", photoPath: `${orgId()}/${ATHLETE}/2.jpg` }));
    expect(missing.errors.photo).toMatch(/could not be read back/);
    const fake = `${orgId()}/${ATHLETE}/3.jpg`;
    data.storage_objects!.push({ bucket: "checkin-photos", name: fake, base64: Buffer.from("not a jpeg").toString("base64") });
    const bad = await logCheckin(ORG_WITH_MODULES, ATHLETE, { errors: {} }, form({ kind: "call", photoPath: fake }));
    expect(bad.errors.photo).toMatch(/not a JPG/);
    expect(data.storage_objects!.some((o) => o.name === fake)).toBe(false);
    expect(writes.filter((w) => w.table === "athlete_checkins" && w.op === "insert")).toEqual([]);
  });

  it("the check-in page shows the photo, the edit form offers Remove Photo, and the new form offers Add a Photo", async () => {
    const detail = await render("@/app/org/[slug]/roster/[id]/checkins/[checkinId]/page", { params: P({ slug: ORG_WITH_MODULES, id: ATHLETE, checkinId: "ck1" }) });
    expect(detail).toMatch(/<img[^>]*src="\/org\/[^"]+\/checkins\/ck1\/photo\?v=1760000000000"/);
    const edit = text(await render("@/app/org/[slug]/roster/[id]/checkins/[checkinId]/edit/page", { params: P({ slug: ORG_WITH_MODULES, id: ATHLETE, checkinId: "ck1" }) }));
    expect(edit).toMatch(/Remove Photo/);
    const log = text(await render("@/app/org/[slug]/roster/[id]/checkins/page", { params: P({ slug: ORG_WITH_MODULES, id: ATHLETE }) }));
    expect(log).toMatch(/Add a Photo/);
  });

  it("Remove Photo on edit clears it and removes the file", async () => {
    const { updateCheckin } = await import("@/lib/actions/checkins");
    const path = data.athlete_checkins.find((c) => c.id === "ck1")!.photo_path as string;
    await run(() => updateCheckin(ORG_WITH_MODULES, ATHLETE, "ck1", { errors: {} }, form({ kind: "call", occurredOn: "2026-10-01", removePhoto: "on" })));
    expect(data.athlete_checkins.find((c) => c.id === "ck1")!.photo_path).toBeNull();
    expect(data.storage_objects!.some((o) => o.name === path)).toBe(false);
  });
});

// Verified this law bites: made migrationStatus ignore the history,
// watched the missing case fail, reverted.
describe("LAW: Organization Settings says which database updates are on", () => {
  it("compares the ledger with the database's history and names what is missing", async () => {
    const { migrationStatus } = await import("@/lib/ops/migrationStatus");
    const ledger = [
      { file: "0001_a", recorded: "applied" as const, versions: ["20260101000000"] },
      { file: "0002_b", recorded: "applied" as const, versions: ["20260102000000"] },
      { file: "0003_c", recorded: "pending" as const, versions: [] },
    ];
    const s = migrationStatus(ledger, [{ version: "20260101000000" }]);
    expect(s.checked).toBe(true);
    expect(s.missing.map((l) => l.file)).toEqual(["0002_b"]);
    expect(s.pending.map((l) => l.file)).toEqual(["0003_c"]);
    expect(migrationStatus(ledger, null).checked).toBe(false);
  });

  it("the Settings screen shows Database Updates, read from the database", async () => {
    const html = text(await render("@/app/org/[slug]/settings/page", { params: P({ slug: ORG_WITH_MODULES }), searchParams: P({}) }));
    expect(html).toMatch(/Database Updates/);
    expect(html).toMatch(/checked against its own history just now/);
    expect(html).toMatch(/0055 Document Moves Back/);
  });
});
