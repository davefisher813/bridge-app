// The fake's create_org keeps the real function's refusals and codes
// (migration 0040), so a page or action built on it sees what the
// database would say.

import { describe, expect, it } from "vitest";
import { buildFixture, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type RecordedWrite } from "@/testing/fakeSupabase";

describe("fake create_org", () => {
  it("creates the org and makes the caller its owner", async () => {
    const data = buildFixture();
    const recorded: RecordedWrite[] = [];
    const client = createFakeClient(data, { userId: OWNER_ID, recorded });
    const { data: id, error } = await client.rpc("create_org", { name: "  New Squad ", slug: " New-Squad " });
    expect(error).toBeNull();
    expect(data.orgs!.find((o) => o.id === id)).toMatchObject({ name: "New Squad", slug: "new-squad" });
    expect(data.org_members!.find((m) => m.org_id === id)).toMatchObject({ user_id: OWNER_ID, role: "owner" });
    expect(recorded.map((w) => `${w.op} ${w.table}`)).toEqual(["insert orgs", "insert org_members"]);
  });

  it("refuses a signed-out caller, a blank name, a malformed address and a taken one, writing nothing", async () => {
    const data = buildFixture();
    const recorded: RecordedWrite[] = [];
    const signedOut = createFakeClient(data, { userId: null, recorded });
    expect((await signedOut.rpc("create_org", { name: "X", slug: "x-org" })).error).toMatchObject({ code: "42501" });
    const client = createFakeClient(data, { userId: OWNER_ID, recorded });
    expect((await client.rpc("create_org", { name: "   ", slug: "blank-probe" })).error).toMatchObject({ code: "23514" });
    expect((await client.rpc("create_org", { name: "Bad", slug: "bad address!" })).error).toMatchObject({ code: "23514" });
    expect((await client.rpc("create_org", { name: "Taken", slug: "BRIDGE-FIXTURE" })).error).toMatchObject({ code: "23505" });
    expect(recorded).toEqual([]);
  });
});
