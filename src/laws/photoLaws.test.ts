// A person's photo (migration 0049). An Admin sets it, only for someone
// in their own org, only from a file already under that org's folder,
// and only after the bytes are checked; anyone in the org sees it,
// nobody else. Planted: dropped the org prefix check in setMemberPhoto:
// "another org's folder" failed. Planted: let the photo route skip the
// membership check: the outsider case failed. Reverted.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildFixture, ORG_WITH_MODULES, OWNER_ID, MEMBER_ID, OUTSIDER_ID, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { FIXTURE_PHOTO_BASE64 } from "@/testing/fixturePhoto";

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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createFakeClient(data, { userId: OWNER_ID, recorded: writes }) }));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
});

const BRIDGE = () => data.orgs[0]!.id as string;
const ELITE = () => data.orgs[1]!.id as string;
const memberRow = (userId: string) => data.org_members!.find((m) => m.org_id === BRIDGE() && m.user_id === userId)!;
const inBucket = (name: string) => data.storage_objects!.some((o) => o.bucket === "member-photos" && o.name === name);
const put = (name: string, base64 = FIXTURE_PHOTO_BASE64) => {
  data.storage_objects!.push({ bucket: "member-photos", name, base64 });
  return name;
};

describe("LAW: an Admin sets a photo only for someone in their org, from that org's folder, after the bytes are checked", () => {
  it("a JPEG under the org's folder becomes the photo, and the one it replaces goes", async () => {
    const { setMemberPhoto } = await import("@/lib/actions/members");
    const old = memberRow(OWNER_ID).photo_path as string;
    const path = put(`${BRIDGE()}/${MEMBER_ID}/1791700000.jpg`);
    const r = await setMemberPhoto(ORG_WITH_MODULES, MEMBER_ID, path);
    expect(r).toEqual({ ok: true });
    expect(memberRow(MEMBER_ID).photo_path).toBe(path);
    // Replacing the owner's own photo removes the old file.
    const next = put(`${BRIDGE()}/${OWNER_ID}/1791700001.jpg`);
    expect((await setMemberPhoto(ORG_WITH_MODULES, OWNER_ID, next)).ok).toBe(true);
    expect(inBucket(old)).toBe(false);
    expect(inBucket(next)).toBe(true);
  });

  it("a file that is not a JPEG is refused and removed, and the row is untouched", async () => {
    const { setMemberPhoto } = await import("@/lib/actions/members");
    const path = put(`${BRIDGE()}/${MEMBER_ID}/1791700002.jpg`, Buffer.from("not a picture").toString("base64"));
    const r = await setMemberPhoto(ORG_WITH_MODULES, MEMBER_ID, path);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a JPG/);
    expect(inBucket(path)).toBe(false);
    expect(memberRow(MEMBER_ID).photo_path ?? null).toBeNull();
  });

  it("a path in another org's folder, for another person, or in another shape is refused without reading anything", async () => {
    const { setMemberPhoto } = await import("@/lib/actions/members");
    for (const path of [`${ELITE()}/${MEMBER_ID}/1.jpg`, `${BRIDGE()}/${OWNER_ID}/1.jpg`, `${BRIDGE()}/${MEMBER_ID}/../x.jpg`, `${BRIDGE()}/${MEMBER_ID}/1.png`, 42]) {
      const r = await setMemberPhoto(ORG_WITH_MODULES, MEMBER_ID, path);
      expect(r.ok, String(path)).toBe(false);
    }
    expect(writes.filter((w) => w.table === "org_members")).toEqual([]);
  });

  it("someone not in the org gets no photo set", async () => {
    const { setMemberPhoto } = await import("@/lib/actions/members");
    const r = await setMemberPhoto(ORG_WITH_MODULES, OUTSIDER_ID, `${BRIDGE()}/${OUTSIDER_ID}/1.jpg`);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/not in this organization/) });
  });

  it("a Viewer, a family login and nobody signed in are refused before anything is touched", async () => {
    const { setMemberPhoto } = await import("@/lib/actions/members");
    for (const who of [MEMBER_ID, FAMILY_ID, null]) {
      currentUser = who;
      await expect(setMemberPhoto(ORG_WITH_MODULES, MEMBER_ID, `${BRIDGE()}/${MEMBER_ID}/1.jpg`)).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
    }
    expect(writes).toEqual([]);
  });

  it("Remove Photo clears the row, removes the file, and says so", async () => {
    const { removeMemberPhotoForm } = await import("@/lib/actions/members");
    const old = memberRow(OWNER_ID).photo_path as string;
    await expect(removeMemberPhotoForm(ORG_WITH_MODULES, OWNER_ID)).rejects.toThrow(/NEXT_REDIRECT:.*notice=Photo%20removed/);
    expect(memberRow(OWNER_ID).photo_path).toBeNull();
    expect(inBucket(old)).toBe(false);
  });
});

describe("LAW: a photo is seen by the people in that org and nobody else", () => {
  async function get(userId: string, slug = ORG_WITH_MODULES) {
    const { GET } = await import("@/app/org/[slug]/members/[userId]/photo/route");
    return GET(new NextRequest(`http://localhost/org/${slug}/members/${userId}/photo`), { params: Promise.resolve({ slug, userId }) });
  }

  it("an Admin, a Viewer and a family login of the org get the JPEG, private", async () => {
    for (const who of [OWNER_ID, MEMBER_ID, FAMILY_ID]) {
      currentUser = who;
      const res = await get(OWNER_ID);
      expect(res.status, String(who)).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("cache-control")).toMatch(/^private/);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("someone outside the org, nobody signed in, a person with no photo and an unknown org all get the same 404", async () => {
    currentUser = OUTSIDER_ID;
    expect((await get(OWNER_ID)).status).toBe(404);
    currentUser = null;
    expect((await get(OWNER_ID)).status).toBe(404);
    currentUser = OWNER_ID;
    expect((await get(MEMBER_ID)).status).toBe(404);
    expect((await get(OWNER_ID, "no-such-org")).status).toBe(404);
  });
});
