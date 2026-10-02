// The fundraising actions that had never been executed: campaigns,
// donors, pledges and the budget.
//
// Money is where a wrong row is quietly wrong, so each action is held to
// the same four things the rest of src/laws/actionRun.test.ts holds the
// others to: it writes the row under the caller's org, it refuses what it
// should refuse (a member, an org without the module, a row from another
// org) before it writes anything, its validation errors come back as
// field errors with no write, and a database error comes back as a form
// error with no redirect. A removal is also held to leaving the rest of
// the books alone: a donor's gifts, a campaign's gifts.
//
// No network and no AI: the Supabase client is the in-memory fake.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { errorsOf, filterColumns, form, orgIdBySlug, run, writesTo } from "@/testing/actionHarness";

let currentUser: string | null = OWNER_ID;
let writes: RecordedWrite[] = [];
let data: Dataset = buildFixture();
let failOn: (table: string, op: string) => string | null = () => null;
let revalidated: string[] = [];

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => void revalidated.push(p) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes, failOn }),
}));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  failOn = () => null;
  revalidated = [];
});

const BRIDGE = () => orgIdBySlug(data, ORG_WITH_MODULES);
const ELITE = () => orgIdBySlug(data, ORG_WITHOUT_MODULES);
const S = ORG_WITH_MODULES;
const NO_STATE = { errors: {} };

// A row that belongs to the other org, for every cross-org case.
const FOREIGN = {
  campaign: "00000000-0000-0000-0000-0000000008c1",
  donor: "00000000-0000-0000-0000-0000000008d1",
  pledge: "00000000-0000-0000-0000-0000000008e1",
};
function addForeignRows() {
  data.campaigns!.push({ id: FOREIGN.campaign, org_id: ELITE(), name: "Squad Campaign", kind: "appeal", goal_amount: 100, ends_on: null });
  data.donors!.push({ id: FOREIGN.donor, org_id: ELITE(), name: "Squad Donor", donor_type: "individual", email: null, deleted_at: null });
  data.pledges!.push({ id: FOREIGN.pledge, org_id: ELITE(), donor_id: FOREIGN.donor, campaign_id: null, amount: 500, promised_on: "2026-01-01", due_on: null, status: "open", solicited_by: null });
}

const campaignForm = (over: Record<string, string> = {}) => form({ name: "Spring Gala", kind: "event", startsOn: "2026-03-01", endsOn: "2026-04-01", goalAmount: "15000", notes: "  Black tie  ", ...over });
const donorForm = (over: Record<string, string> = {}) => form({ name: "  Pat Giver ", donorType: "corporate", email: " pat@example.test ", phone: "", address: "", notes: "", ...over });
const pledgeForm = (over: Record<string, string> = {}) => form({ donorId: IDS.donor, amount: "2,500.50", promisedOn: "2026-09-01", dueOn: "2026-12-01", campaignId: IDS.campaign, notes: "", ...over });

// ── campaigns ───────────────────────────────────────────────────────────

describe("createCampaign", () => {
  it("writes the campaign under the caller's org and lands on it", async () => {
    const { createCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => createCampaign(S, NO_STATE, campaignForm()));
    const [w] = writesTo(writes, "campaigns", "insert");
    expect(w).toBeDefined();
    expect(w!.rows[0]).toMatchObject({ org_id: BRIDGE(), name: "Spring Gala", kind: "event", starts_on: "2026-03-01", ends_on: "2026-04-01", goal_amount: "15000.00", notes: "Black tie" });
    const created = data.campaigns!.find((c) => c.name === "Spring Gala")!;
    expect(r.redirect).toBe(`/org/${S}/fundraising/campaigns/${created.id}`);
    expect(revalidated).toContain(`/org/${S}/fundraising`);
  });

  it("no goal is stored as null, not zero, so the overview can say 'no goal'", async () => {
    const { createCampaign } = await import("@/lib/actions/fundraising");
    await run(() => createCampaign(S, NO_STATE, campaignForm({ goalAmount: "" })));
    expect(writesTo(writes, "campaigns", "insert")[0]!.rows[0]!.goal_amount).toBeNull();
  });

  it("a goal of zero is kept as zero, which is a different statement from no goal", async () => {
    const { createCampaign } = await import("@/lib/actions/fundraising");
    await run(() => createCampaign(S, NO_STATE, campaignForm({ goalAmount: "0" })));
    expect(writesTo(writes, "campaigns", "insert")[0]!.rows[0]!.goal_amount).toBe("0.00");
  });

  const REFUSED: Array<[string, Record<string, string>, string, RegExp]> = [
    ["a missing name", { name: "   " }, "name", /needs a name/i],
    ["an unknown kind", { kind: "raffle" }, "kind", /pick a kind/i],
    ["an end date before the start", { startsOn: "2026-05-01", endsOn: "2026-04-01" }, "endsOn", /before the start/i],
    ["a negative goal", { goalAmount: "-5" }, "goalAmount", /negative/i],
  ];
  for (const [label, over, field, message] of REFUSED) {
    it(`refuses ${label} with a field error and writes nothing`, async () => {
      const { createCampaign } = await import("@/lib/actions/fundraising");
      const r = await run(() => createCampaign(S, NO_STATE, campaignForm(over)));
      expect(r.redirect).toBeNull();
      expect(errorsOf(r.state)[field]).toMatch(message);
      expect(writes).toEqual([]);
    });
  }

  it("a database error comes back as a form error and does not redirect", async () => {
    failOn = (t, op) => (t === "campaigns" && op === "insert" ? "boom" : null);
    const { createCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => createCampaign(S, NO_STATE, campaignForm()));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toBe("boom");
  });
});

describe("updateCampaign", () => {
  it("updates only this org's row, by id and org, and says it saved", async () => {
    const { updateCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateCampaign(S, IDS.campaign, NO_STATE, campaignForm({ name: "Renamed", goalAmount: "30000" })));
    const [w] = writesTo(writes, "campaigns", "update");
    expect(filterColumns(w)).toEqual(["id", "org_id"]);
    expect(w!.filters.find((f) => f.column === "org_id")!.value).toBe(BRIDGE());
    expect(data.campaigns!.find((c) => c.id === IDS.campaign)).toMatchObject({ name: "Renamed", goal_amount: "30000.00" });
    expect(r.redirect).toBe(`/org/${S}/fundraising/campaigns/${IDS.campaign}?notice=${encodeURIComponent("Campaign saved.")}`);
    // The overview and the campaign list refresh.
    expect(revalidated).toContain(`/org/${S}/fundraising`);
  });

  it("refuses another org's campaign and leaves it untouched", async () => {
    addForeignRows();
    const { updateCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateCampaign(S, FOREIGN.campaign, NO_STATE, campaignForm({ name: "Hijacked" })));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toMatch(/not in this organization/i);
    expect(data.campaigns!.find((c) => c.id === FOREIGN.campaign)!.name).toBe("Squad Campaign");
  });

  it("validates the same way create does, and writes nothing", async () => {
    const { updateCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateCampaign(S, IDS.campaign, NO_STATE, campaignForm({ name: "" })));
    expect(errorsOf(r.state).name).toMatch(/needs a name/i);
    expect(writes).toEqual([]);
  });

  it("a database error comes back as a form error", async () => {
    failOn = (t, op) => (t === "campaigns" && op === "update" ? "locked" : null);
    const { updateCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateCampaign(S, IDS.campaign, NO_STATE, campaignForm()));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toBe("locked");
  });
});

describe("removeCampaign", () => {
  it("deletes this org's campaign by id and org, and leaves its gifts counting", async () => {
    const giftsBefore = data.gifts!.length;
    const { removeCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => removeCampaign(S, IDS.campaign));
    const [w] = writesTo(writes, "campaigns", "delete");
    expect(filterColumns(w)).toEqual(["id", "org_id"]);
    expect(data.campaigns!.some((c) => c.id === IDS.campaign)).toBe(false);
    // The action never touches the gifts table: the database unlinks them.
    expect(writesTo(writes, "gifts")).toEqual([]);
    expect(data.gifts!.length).toBe(giftsBefore);
    expect(r.redirect).toBe(`/org/${S}/fundraising?notice=${encodeURIComponent("Campaign removed. Its gifts still count.")}`);
  });

  it("an already-removed campaign is reported, not deleted again", async () => {
    const { removeCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => removeCampaign(S, "00000000-0000-0000-0000-00000000dead"));
    expect(r.redirect).toBe(`/org/${S}/fundraising?error=${encodeURIComponent("That campaign is already gone.")}`);
    expect(writesTo(writes, "campaigns", "delete")).toEqual([]);
  });

  it("will not delete another org's campaign", async () => {
    addForeignRows();
    const { removeCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => removeCampaign(S, FOREIGN.campaign));
    expect(r.redirect).toBe(`/org/${S}/fundraising?error=${encodeURIComponent("That campaign is already gone.")}`);
    expect(data.campaigns!.some((c) => c.id === FOREIGN.campaign)).toBe(true);
    expect(writesTo(writes, "campaigns", "delete")).toEqual([]);
  });

  it("a delete error sends the person back to the edit screen with the reason", async () => {
    failOn = (t, op) => (t === "campaigns" && op === "delete" ? "fk" : null);
    const { removeCampaign } = await import("@/lib/actions/fundraising");
    const r = await run(() => removeCampaign(S, IDS.campaign));
    expect(r.redirect).toBe(`/org/${S}/fundraising/campaigns/${IDS.campaign}/edit?error=${encodeURIComponent("Could not remove it: fk")}`);
    expect(data.campaigns!.some((c) => c.id === IDS.campaign)).toBe(true);
  });
});

// ── donors ──────────────────────────────────────────────────────────────

describe("createDonor", () => {
  it("writes the donor under the caller's org, trimmed, with blanks as null", async () => {
    const { createDonor } = await import("@/lib/actions/fundraising");
    const r = await run(() => createDonor(S, NO_STATE, donorForm()));
    const [w] = writesTo(writes, "donors", "insert");
    expect(w!.rows[0]).toEqual({ org_id: BRIDGE(), name: "Pat Giver", donor_type: "corporate", email: "pat@example.test", phone: null, address: null, notes: null });
    const created = data.donors!.find((d) => d.name === "Pat Giver")!;
    expect(r.redirect).toBe(`/org/${S}/fundraising/donors/${created.id}`);
    expect(revalidated).toContain(`/org/${S}/fundraising/donors`);
  });

  it("a donor type left off defaults to individual", async () => {
    const { createDonor } = await import("@/lib/actions/fundraising");
    const fd = new FormData();
    fd.append("name", "No Type");
    await run(() => createDonor(S, NO_STATE, fd));
    expect(writesTo(writes, "donors", "insert")[0]!.rows[0]!.donor_type).toBe("individual");
  });

  it("refuses a missing name and an unknown type, writing nothing", async () => {
    const { createDonor } = await import("@/lib/actions/fundraising");
    const a = await run(() => createDonor(S, NO_STATE, donorForm({ name: " " })));
    expect(errorsOf(a.state).name).toMatch(/needs a name/i);
    const b = await run(() => createDonor(S, NO_STATE, donorForm({ donorType: "alien" })));
    expect(errorsOf(b.state).donorType).toMatch(/pick a type/i);
    expect(writes).toEqual([]);
  });

  it("a database error comes back as a form error", async () => {
    failOn = (t, op) => (t === "donors" && op === "insert" ? "nope" : null);
    const { createDonor } = await import("@/lib/actions/fundraising");
    const r = await run(() => createDonor(S, NO_STATE, donorForm()));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toBe("nope");
  });
});

describe("updateDonor", () => {
  it("updates by id and org, only a live donor, and says it saved", async () => {
    const { updateDonor } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateDonor(S, IDS.donor, NO_STATE, donorForm({ name: "Fixture Donor Jr" })));
    const [w] = writesTo(writes, "donors", "update");
    expect(filterColumns(w)).toEqual(["deleted_at", "id", "org_id"]);
    expect(data.donors!.find((d) => d.id === IDS.donor)!.name).toBe("Fixture Donor Jr");
    expect(r.redirect).toBe(`/org/${S}/fundraising/donors/${IDS.donor}?notice=${encodeURIComponent("Donor saved.")}`);
  });

  it("does not edit another org's donor", async () => {
    addForeignRows();
    const { updateDonor } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateDonor(S, FOREIGN.donor, NO_STATE, donorForm({ name: "Hijacked" })));
    expect(errorsOf(r.state).form).toMatch(/not in this organization/i);
    expect(data.donors!.find((d) => d.id === FOREIGN.donor)!.name).toBe("Squad Donor");
  });

  it("does not resurrect or edit a donor that was removed", async () => {
    data.donors!.find((d) => d.id === IDS.donor)!.deleted_at = "2026-09-01T00:00:00Z";
    const { updateDonor } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateDonor(S, IDS.donor, NO_STATE, donorForm({ name: "Zombie" })));
    expect(errorsOf(r.state).form).toMatch(/not in this organization/i);
    expect(data.donors!.find((d) => d.id === IDS.donor)!.name).toBe("Fixture Donor");
  });

  it("validates before writing", async () => {
    const { updateDonor } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateDonor(S, IDS.donor, NO_STATE, donorForm({ name: "" })));
    expect(errorsOf(r.state).name).toMatch(/needs a name/i);
    expect(writes).toEqual([]);
  });

  it("a database error comes back as a form error", async () => {
    failOn = (t, op) => (t === "donors" && op === "update" ? "broken" : null);
    const { updateDonor } = await import("@/lib/actions/fundraising");
    const r = await run(() => updateDonor(S, IDS.donor, NO_STATE, donorForm()));
    expect(errorsOf(r.state).form).toBe("broken");
  });
});

// ── pledges ─────────────────────────────────────────────────────────────

describe("recordPledge", () => {
  it("writes the pledge under the caller's org with the amount as an exact decimal", async () => {
    const { recordPledge } = await import("@/lib/actions/fundraising");
    const r = await run(() => recordPledge(S, NO_STATE, pledgeForm()));
    const [w] = writesTo(writes, "pledges", "insert");
    expect(w!.rows[0]).toMatchObject({ org_id: BRIDGE(), donor_id: IDS.donor, campaign_id: IDS.campaign, amount: "2500.50", promised_on: "2026-09-01", due_on: "2026-12-01" });
    expect(r.redirect).toBe(`/org/${S}/fundraising/pledges`);
    expect(revalidated).toContain(`/org/${S}/fundraising/pledges`);
  });

  it("a pledge needs no campaign and no due date", async () => {
    const { recordPledge } = await import("@/lib/actions/fundraising");
    await run(() => recordPledge(S, NO_STATE, pledgeForm({ campaignId: "", dueOn: "" })));
    expect(writesTo(writes, "pledges", "insert")[0]!.rows[0]).toMatchObject({ campaign_id: null, due_on: null });
  });

  it("refuses a donor from another org, and a donor that does not exist, before writing", async () => {
    addForeignRows();
    const { recordPledge } = await import("@/lib/actions/fundraising");
    const a = await run(() => recordPledge(S, NO_STATE, pledgeForm({ donorId: FOREIGN.donor })));
    expect(errorsOf(a.state).donorId).toMatch(/not in this organization/i);
    const b = await run(() => recordPledge(S, NO_STATE, pledgeForm({ donorId: "00000000-0000-0000-0000-00000000dead" })));
    expect(errorsOf(b.state).donorId).toMatch(/not in this organization/i);
    expect(writesTo(writes, "pledges")).toEqual([]);
  });

  it("refuses a campaign from another org", async () => {
    addForeignRows();
    const { recordPledge } = await import("@/lib/actions/fundraising");
    const r = await run(() => recordPledge(S, NO_STATE, pledgeForm({ campaignId: FOREIGN.campaign })));
    expect(errorsOf(r.state).form).toMatch(/campaign is not in this organization/i);
    expect(writesTo(writes, "pledges")).toEqual([]);
  });

  const REFUSED: Array<[string, Record<string, string>, string, RegExp]> = [
    ["no donor", { donorId: "" }, "donorId", /who promised/i],
    ["a zero amount", { amount: "0" }, "amount", /positive/i],
    ["a negative amount", { amount: "-10" }, "amount", /positive/i],
    ["no promised date", { promisedOn: "" }, "promisedOn", /when was it promised/i],
    ["a due date before the promise", { promisedOn: "2026-09-01", dueOn: "2026-08-01" }, "dueOn", /before the promise/i],
  ];
  for (const [label, over, field, message] of REFUSED) {
    it(`refuses ${label} with a field error and writes nothing`, async () => {
      const { recordPledge } = await import("@/lib/actions/fundraising");
      const r = await run(() => recordPledge(S, NO_STATE, pledgeForm(over)));
      expect(errorsOf(r.state)[field]).toMatch(message);
      expect(writes).toEqual([]);
    });
  }

  it("a database error comes back as a form error", async () => {
    failOn = (t, op) => (t === "pledges" && op === "insert" ? "dup" : null);
    const { recordPledge } = await import("@/lib/actions/fundraising");
    const r = await run(() => recordPledge(S, NO_STATE, pledgeForm()));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toBe("dup");
  });
});

describe("removePledge", () => {
  it("deletes this org's pledge by id and org, and leaves its payments as gifts", async () => {
    data.gifts!.push({ id: "gf-pay", org_id: BRIDGE(), donor_id: IDS.donor, campaign_id: null, pledge_id: "pl1", amount: 100, received_on: "2026-05-01", category: "individual", method: "check", solicited_by: null });
    const { removePledge } = await import("@/lib/actions/fundraising");
    const r = await run(() => removePledge(S, "pl1"));
    const [w] = writesTo(writes, "pledges", "delete");
    expect(filterColumns(w)).toEqual(["id", "org_id"]);
    expect(data.pledges!.some((p) => p.id === "pl1")).toBe(false);
    expect(writesTo(writes, "gifts")).toEqual([]);
    expect(data.gifts!.some((g) => g.id === "gf-pay")).toBe(true);
    expect(r.redirect).toBe(`/org/${S}/fundraising/pledges?notice=${encodeURIComponent("Pledge removed.")}`);
  });

  it("an already-removed pledge is reported, not deleted again", async () => {
    const { removePledge } = await import("@/lib/actions/fundraising");
    const r = await run(() => removePledge(S, "00000000-0000-0000-0000-00000000dead"));
    expect(r.redirect).toBe(`/org/${S}/fundraising/pledges?error=${encodeURIComponent("That pledge is already gone.")}`);
    expect(writesTo(writes, "pledges", "delete")).toEqual([]);
  });

  it("will not delete another org's pledge", async () => {
    addForeignRows();
    const { removePledge } = await import("@/lib/actions/fundraising");
    const r = await run(() => removePledge(S, FOREIGN.pledge));
    expect(r.redirect).toContain("already%20gone");
    expect(data.pledges!.some((p) => p.id === FOREIGN.pledge)).toBe(true);
    expect(writesTo(writes, "pledges", "delete")).toEqual([]);
  });

  it("a delete error sends the person to the edit screen with the reason", async () => {
    failOn = (t, op) => (t === "pledges" && op === "delete" ? "locked" : null);
    const { removePledge } = await import("@/lib/actions/fundraising");
    const r = await run(() => removePledge(S, "pl1"));
    expect(r.redirect).toBe(`/org/${S}/fundraising/pledges/pl1/edit?error=${encodeURIComponent("Could not remove it: locked")}`);
    expect(data.pledges!.some((p) => p.id === "pl1")).toBe(true);
  });
});

// ── the budget ──────────────────────────────────────────────────────────

describe("setBudget", () => {
  const budgetForm = (over: Record<string, string> = {}) => form({ budget_individual: "1000", budget_board: "40,000", budget_corporate: "", budget_special_event: "$2,500.50", budget_grant: "0", ...over });

  it("upserts one row per category for the year, on the table's own key, under the caller's org", async () => {
    const { setBudget } = await import("@/lib/actions/fundraising");
    const r = await run(() => setBudget(S, 2026, NO_STATE, budgetForm()));
    const [w] = writesTo(writes, "fundraising_budget", "upsert");
    expect(w!.onConflict).toBe("org_id,fiscal_year,category");
    expect(w!.rows).toHaveLength(5);
    const byCat = Object.fromEntries(w!.rows.map((x) => [x.category as string, x]));
    for (const row of w!.rows) expect(row).toMatchObject({ org_id: BRIDGE(), fiscal_year: 2026 });
    expect(byCat.individual!.amount).toBe("1000.00");
    expect(byCat.board!.amount).toBe("40000.00");
    expect(byCat.special_event!.amount).toBe("2500.50");
    // Blank means no target, filed as zero rather than skipped.
    expect(byCat.corporate!.amount).toBe("0.00");
    expect(byCat.grant!.amount).toBe("0.00");
    expect(r.redirect).toBe(`/org/${S}/fundraising`);
    // The existing board row for the year was replaced, not duplicated.
    expect(data.fundraising_budget!.filter((b) => b.fiscal_year === 2026 && b.category === "board")).toHaveLength(1);
  });

  it("refuses text that is not an amount rather than filing it as zero", async () => {
    const { setBudget } = await import("@/lib/actions/fundraising");
    const r = await run(() => setBudget(S, 2026, NO_STATE, budgetForm({ budget_board: "lots" })));
    expect(errorsOf(r.state).budget_board).toMatch(/does not look like an amount/i);
    expect(writes).toEqual([]);
  });

  it("refuses a negative budget and names the field", async () => {
    const { setBudget } = await import("@/lib/actions/fundraising");
    const r = await run(() => setBudget(S, 2026, NO_STATE, budgetForm({ budget_grant: "-1" })));
    expect(errorsOf(r.state).budget_grant).toMatch(/cannot be negative/i);
    expect(writes).toEqual([]);
  });

  it("an explicit zero is accepted, not mistaken for text", async () => {
    const { setBudget } = await import("@/lib/actions/fundraising");
    const r = await run(() => setBudget(S, 2026, NO_STATE, budgetForm({ budget_individual: "$0.00" })));
    expect(r.redirect).toBe(`/org/${S}/fundraising`);
  });

  it("a database error comes back as a form error", async () => {
    failOn = (t, op) => (t === "fundraising_budget" && op === "upsert" ? "rls" : null);
    const { setBudget } = await import("@/lib/actions/fundraising");
    const r = await run(() => setBudget(S, 2026, NO_STATE, budgetForm()));
    expect(r.redirect).toBeNull();
    expect(errorsOf(r.state).form).toBe("rls");
  });
});

// ── who may call any of them ────────────────────────────────────────────

describe("every one of these refuses the wrong caller before it writes", () => {
  type Call = () => Promise<unknown>;
  const calls = async (slug: string): Promise<Record<string, Call>> => {
    const a = await import("@/lib/actions/fundraising");
    return {
      createCampaign: () => a.createCampaign(slug, NO_STATE, campaignForm()),
      updateCampaign: () => a.updateCampaign(slug, IDS.campaign, NO_STATE, campaignForm()),
      removeCampaign: () => a.removeCampaign(slug, IDS.campaign),
      createDonor: () => a.createDonor(slug, NO_STATE, donorForm()),
      updateDonor: () => a.updateDonor(slug, IDS.donor, NO_STATE, donorForm()),
      recordPledge: () => a.recordPledge(slug, NO_STATE, pledgeForm()),
      removePledge: () => a.removePledge(slug, "pl1"),
      setBudget: () => a.setBudget(slug, 2026, NO_STATE, form({ budget_board: "1" })),
    };
  };
  const NAMES = ["createCampaign", "updateCampaign", "removeCampaign", "createDonor", "updateDonor", "recordPledge", "removePledge", "setBudget"];

  for (const name of NAMES) {
    for (const [who, id] of [["a Viewer", MEMBER_ID], ["an Athlete login", FAMILY_ID], ["nobody signed in", null]] as const) {
      it(`${name} refuses ${who}`, async () => {
        currentUser = id;
        const c = await calls(ORG_WITH_MODULES);
        await expect(c[name]!()).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
        expect(writes).toEqual([]);
      });
    }
    it(`${name} refuses an org without the fundraising module`, async () => {
      const c = await calls(ORG_WITHOUT_MODULES);
      await expect(c[name]!()).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      expect(writes).toEqual([]);
    });
    it(`${name} refuses an org that does not exist`, async () => {
      const c = await calls("no-such-org");
      await expect(c[name]!()).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      expect(writes).toEqual([]);
    });
  }
});
