// The account lifecycle, end to end through the code: an invitation is
// sent and lands on this site, the first sign-in works with a link of
// any type the email can carry, an old link is refused plainly, a person
// who forgot their password is brought in by the same link, sign-out
// ends the session, and a person removed from an organization loses
// every screen of it at once. The pieces each have a test elsewhere
// (actionRun, otherActions, e2e/login.spec.ts); this file holds the
// joins between them, and the one thing that was not covered at all:
// what a person is told when Supabase refuses to send the email.
//
// Nothing here sends an email or reaches Supabase. Whether the
// production project's email template and redirect list are set up for
// this is checked by hand, not here (docs/LAUNCH_GATES.md).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { form, run, writesTo } from "@/testing/actionHarness";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let authFail: string | undefined;

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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes, authFail }) }));
vi.mock("@/lib/supabase/admin", () => ({ serviceRoleConfigured: () => true, createAdminClient: () => createFakeClient(data, { userId: currentUser, recorded: writes, authFail }) }));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  authFail = undefined;
  process.env.NEXT_PUBLIC_SITE_URL = "https://commit-app-nu.vercel.app";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role-placeholder";
});

const S = ORG_WITH_MODULES;
const NO_STATE = { sent: false, email: "", error: null };
const RATE_LIMITED = "email rate limit exceeded";
const FRIENDLY = /Too many sign-in emails were sent in a short time\. Wait a few minutes and ask again\./;

async function html(modulePath: string, props: unknown): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const mod = await import(/* @vite-ignore */ modulePath);
  return renderToStaticMarkup(await mod.default(props));
}
const params = (extra: Record<string, string> = {}) => Promise.resolve({ slug: S, ...extra });

describe("an invitation sends the person back to the production site", () => {
  it("a new address is invited with a link that lands on /auth/callback at the configured address", async () => {
    const { inviteMember } = await import("@/lib/actions/members");
    await run(() => inviteMember(S, { errors: {} }, form({ email: "new.person@example.test", role: "member" })));
    const [invite] = writesTo(writes, "auth:invite");
    expect(invite!.rows[0]).toMatchObject({ email: "new.person@example.test", redirectTo: "https://commit-app-nu.vercel.app/auth/callback?next=/" });
    expect(data.org_members!.some((m) => m.role === "member" && (data.users ?? []).some((u) => u.id === m.user_id && u.email === "new.person@example.test"))).toBe(true);
  });
});

describe("the first sign-in works with every kind of link the email can carry", () => {
  async function get(query: string): Promise<string> {
    const { GET } = await import("@/app/auth/callback/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest(`https://commit-app-nu.vercel.app/auth/callback${query}`));
    return res.headers.get("location") ?? "";
  }

  for (const type of ["invite", "magiclink", "recovery", "email", "signup"]) {
    it(`a ${type} link is verified as ${type} and lands signed in`, async () => {
      expect(await get(`?token_hash=abc&type=${type}&next=/`)).toBe("https://commit-app-nu.vercel.app/");
      expect(writes.find((w) => w.table === "auth:verify")?.rows[0]).toEqual({ token_hash: "abc", type });
    });
  }

  it("a link of a type nobody sends is refused, not verified", async () => {
    expect(await get("?token_hash=abc&type=sms")).toMatch(/\/login\?error=/);
    expect(writes.find((w) => w.table === "auth:verify")).toBeUndefined();
  });

  it("an expired invitation lands on sign-in with a plain sentence, and the way to a new one is the same sign-in link", async () => {
    const to = await get("?token_hash=expired&type=invite");
    expect(decodeURIComponent(to)).toContain("That sign-in link is not valid any more. Ask for a new one.");
    // Asking for a new one is the ordinary link, for an address that has an account.
    const { sendMagicLink } = await import("@/lib/auth/actions");
    const again = await sendMagicLink(NO_STATE, form({ email: "member@example.test" }));
    expect(again.sent).toBe(true);
  });
});

describe("a person who forgot their password signs in with an emailed link", () => {
  it("a wrong password goes back to sign-in with Supabase's reason; it never signs in", async () => {
    const { login } = await import("@/lib/auth/actions");
    const r = await run(() => login(form({ email: "owner@example.test", password: "wrong" })));
    expect(r.redirect).toBe(`/login?error=${encodeURIComponent("Invalid login credentials")}`);
  });

  it("the right password signs in and lands on the org picker", async () => {
    const { login } = await import("@/lib/auth/actions");
    const r = await run(() => login(form({ email: "owner@example.test", password: "correct-password" })));
    expect(r.redirect).toBe("/");
  });

  it("the emailed link works for an account that has a password, and never creates one for a stranger", async () => {
    const { sendMagicLink } = await import("@/lib/auth/actions");
    expect((await sendMagicLink(NO_STATE, form({ email: "owner@example.test" }))).sent).toBe(true);
    const stranger = await sendMagicLink(NO_STATE, form({ email: "stranger@example.test" }));
    expect(stranger.sent).toBe(false);
    expect(stranger.error).toMatch(/no account for stranger@example.test/);
  });
});

describe("sign-out ends the session and returns to sign-in", () => {
  it("calls the auth sign-out and redirects to /login", async () => {
    const { signout } = await import("@/lib/auth/actions");
    const r = await run(() => signout());
    expect(r.redirect).toBe("/login");
    expect(writesTo(writes, "auth:session", "delete")).toHaveLength(1);
  });

  it("with nobody signed in, an org screen sends the person to sign-in rather than rendering", async () => {
    currentUser = null;
    await expect(html("@/app/org/[slug]/roster/page", { params: params(), searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_REDIRECT:\/login/);
  });
});

describe("removing someone revokes every screen at once", () => {
  it("a removed Viewer is turned away from the Viewer screens and the Admin screens, and keeps no links", async () => {
    // Control: before removal the Viewer's own screen renders for them.
    currentUser = MEMBER_ID;
    expect(await html("@/app/org/[slug]/member/page", { params: params(), searchParams: Promise.resolve({}) })).toMatch(/<h1/);
    currentUser = OWNER_ID;
    const { removeMember } = await import("@/lib/actions/members");
    const r = await removeMember(S, MEMBER_ID);
    expect(r.ok).toBe(true);
    const bridge = data.orgs!.find((o) => o.slug === S)!.id;
    expect(data.org_members!.some((m) => m.user_id === MEMBER_ID && m.org_id === bridge)).toBe(false);

    currentUser = MEMBER_ID;
    for (const page of ["@/app/org/[slug]/member/page", "@/app/org/[slug]/roster/page", "@/app/org/[slug]/more/page"]) {
      await expect(html(page, { params: params(), searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
    }
  });

  it("a removed Athlete login loses the athlete's page and the athlete link goes with the membership", async () => {
    // Control: before removal the same screen renders for them.
    currentUser = FAMILY_ID;
    expect(await html("@/app/org/[slug]/family/[id]/page", { params: params({ id: IDS.athlete }), searchParams: Promise.resolve({}) })).toMatch(/Fixture Athlete/);
    currentUser = OWNER_ID;
    const { removeMember } = await import("@/lib/actions/members");
    const r = await removeMember(S, FAMILY_ID);
    expect(r.ok).toBe(true);
    expect((data.athlete_guardians ?? []).some((g) => g.user_id === FAMILY_ID)).toBe(false);
    currentUser = FAMILY_ID;
    await expect(html("@/app/org/[slug]/family/[id]/page", { params: params({ id: IDS.athlete }), searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
  });

  it("the only Admin cannot be removed, so the organization is never left with nobody", async () => {
    const { removeMember } = await import("@/lib/actions/members");
    const r = await removeMember(S, OWNER_ID);
    expect(r.ok).toBe(false);
    expect(data.org_members!.some((m) => m.user_id === OWNER_ID)).toBe(true);
  });
});

describe("when Supabase refuses to send the email, the person is told in plain words", () => {
  it("a rate-limited sign-in link says to wait, not 'email rate limit exceeded'", async () => {
    authFail = RATE_LIMITED;
    const { sendMagicLink } = await import("@/lib/auth/actions");
    const r = await sendMagicLink(NO_STATE, form({ email: "owner@example.test" }));
    expect(r.sent).toBe(false);
    expect(r.error).toMatch(FRIENDLY);
    expect(r.error).not.toMatch(/exceeded/);
  });

  it("a rate-limited resend says the same", async () => {
    authFail = RATE_LIMITED;
    const { resendInvite } = await import("@/lib/actions/members");
    const r = await resendInvite(S, MEMBER_ID);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(FRIENDLY);
  });

  it("a rate-limited invitation says the same, and says it was not sent", async () => {
    authFail = RATE_LIMITED;
    const { inviteMember } = await import("@/lib/actions/members");
    const r = await run(() => inviteMember(S, { errors: {} }, form({ email: "another.person@example.test", role: "member" })));
    const errors = (r.state as { errors: Record<string, string> }).errors;
    expect(errors.form).toMatch(/Could not send the invitation/);
    expect(errors.form).toMatch(FRIENDLY);
  });

  it("an error that is not about rate limits is passed through unchanged", async () => {
    authFail = "SMTP server unreachable";
    const { sendMagicLink } = await import("@/lib/auth/actions");
    expect((await sendMagicLink(NO_STATE, form({ email: "owner@example.test" }))).error).toBe("SMTP server unreachable");
  });
});
