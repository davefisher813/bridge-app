// Laws for the money. These are the ways a board report goes quietly
// wrong rather than visibly wrong, which is what makes them worth
// asserting rather than trusting.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { summarize, donorTotals, campaignProgress, toCents, type Gift, type Pledge } from "../lib/fundraising/rollup";

const SRC = join(process.cwd(), "src");

const gift = (over: Partial<Gift> = {}): Gift => ({
  id: crypto.randomUUID(),
  amountCents: 10000,
  receivedOn: "2026-05-01",
  category: "individual",
  method: "check",
  donorId: "d1",
  campaignId: null,
  pledgeId: null,
  ...over,
});

const pledge = (over: Partial<Pledge> = {}): Pledge => ({
  id: crypto.randomUUID(),
  amountCents: 500000,
  promisedOn: "2026-01-15",
  dueOn: "2026-12-31",
  status: "open",
  donorId: "d1",
  campaignId: null,
  ...over,
});

const base = { budget: [], fiscalYear: 2026, today: "2026-09-16" };

describe("LAW: a pledge is never counted as money raised", () => {
  // Overstating the year is the single most damaging thing this feature
  // could do, because nobody questions a number that is too good.
  it("a promise adds nothing to the total", () => {
    const s = summarize({ ...base, gifts: [], pledges: [pledge({ amountCents: 1_000_000 })] });
    expect(s.totalCashCents).toBe(0);
    expect(s.totalSupportCents).toBe(0);
  });

  it("cash plus outstanding never exceeds what was actually promised and paid", () => {
    const p = pledge({ amountCents: 500000 });
    const s = summarize({ ...base, gifts: [gift({ amountCents: 200000, pledgeId: p.id })], pledges: [p] });
    expect(s.totalCashCents + s.outstandingPledgeCents).toBe(500000);
  });

  it("a campaign is measured on cash, so promises cannot complete it", () => {
    const p = campaignProgress("c1", 100000, [], [pledge({ campaignId: "c1", amountCents: 100000 })]);
    expect(p.percentOfGoal).toBe(0);
  });
});

describe("LAW: an in-kind gift is support, never cash", () => {
  // A treasurer asks this question, and a wrong answer says there is
  // money to spend that does not exist.
  it("donated goods stay out of the cash total", () => {
    const s = summarize({ ...base, gifts: [gift({ amountCents: 500000, method: "in_kind" })], pledges: [] });
    expect(s.totalCashCents).toBe(0);
    expect(s.totalInKindCents).toBe(500000);
    expect(s.totalSupportCents).toBe(500000);
  });

  it("a budget cannot be met with donated goods", () => {
    const s = summarize({
      ...base,
      gifts: [gift({ amountCents: 100000, method: "in_kind" })],
      pledges: [],
      budget: [{ fiscalYear: 2026, category: "individual", amountCents: 100000 }],
    });
    expect(s.byCategory.find((c) => c.category === "individual")!.percentOfBudget).toBe(0);
  });

  it("a donor's cash total excludes their in-kind giving", () => {
    const t = donorTotals("d1", [gift({ amountCents: 500000, method: "in_kind" })], [], 2026);
    expect(t.lifetimeCashCents).toBe(0);
    expect(t.lifetimeInKindCents).toBe(500000);
  });

  it("the form will not accept an in-kind amount with nothing described", () => {
    const source = readFileSync(join(SRC, "lib", "validation", "gift.ts"), "utf8");
    expect(source).toMatch(/method === "in_kind" && !inKindDescription/);
  });
});

describe("LAW: money is integer cents, never a float", () => {
  it("a thousand ten-cent gifts total exactly one hundred dollars", () => {
    const gifts = Array.from({ length: 1000 }, () => gift({ amountCents: toCents(0.1) }));
    expect(summarize({ ...base, gifts, pledges: [] }).totalCashCents).toBe(10000);
  });

  it("nothing in the fundraising module multiplies or divides a dollar figure", () => {
    // The whole module works in integers. A bare `* 100` on a parsed
    // float outside toCents is how a cent goes missing.
    const source = readFileSync(join(SRC, "lib", "fundraising", "rollup.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/parseFloat/);

    // toCents is the only place a decimal becomes cents. The other two
    // `* 100` in this file are percentages computed from integers, which
    // is what makes them safe, so the check is on the conversion rather
    // than on the operator.
    const conversions = code.match(/Math\.round\([a-z]+ \* 100\)/g) ?? [];
    expect(conversions.length).toBe(1);

    // And nothing sums or compares money as dollars. Every total in the
    // summary is built from a *Cents field.
    const sums = code.match(/reduce\(\(s, [a-z]\) => s \+ [a-z]\.\w+/g) ?? [];
    expect(sums.length).toBeGreaterThan(0);
    for (const sum of sums) expect(sum).toMatch(/Cents/);
  });

  it("the column gets a decimal string built from integers, not a float", () => {
    const source = readFileSync(join(SRC, "lib", "validation", "gift.ts"), "utf8");
    expect(source).toMatch(/Math\.floor\(abs \/ 100\)/);
    expect(source).not.toMatch(/toFixed\(2\)/);
  });
});

describe("LAW: fundraising is gated, in the actions and not only on the screen", () => {
  // A server action is a public endpoint. A page that never renders for
  // Elite Squad is not the same thing as an action they cannot call.
  it("every fundraising action checks the module flag", () => {
    const source = readFileSync(join(SRC, "lib", "actions", "fundraising.ts"), "utf8");
    expect(source).toMatch(/modules\.donor_fundraising/);

    // Every exported action goes through the same gate rather than each
    // one remembering to check.
    const exported = (source.match(/export async function (\w+)/g) ?? []).length;
    const gated = (source.match(/await requireFundraising\(/g) ?? []).length;
    expect(exported).toBeGreaterThan(0);
    expect(gated).toBe(exported);
  });

  it("every fundraising screen refuses an org without the module", () => {
    // Every page under the fundraising route, found by walking the
    // folder rather than listed by hand: a list gets out of date the
    // first time somebody adds a screen, which is exactly when the gate
    // matters most.
    const root = join(SRC, "app", "org", "[slug]", "fundraising");
    const pages: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else if (entry.name === "page.tsx") pages.push(`${prefix}${entry.name}`);
      }
    };
    walk(root, "");
    expect(pages.length).toBeGreaterThanOrEqual(9);
    for (const p of pages) {
      const source = readFileSync(join(SRC, "app", "org", "[slug]", "fundraising", p), "utf8");
      expect(source, p).toMatch(/if \(!org\.modules\.donor_fundraising\) notFound\(\);/);
    }
  });
});

describe("LAW: donor totals are derived, never stored", () => {
  it("no migration adds a running total to the donor row", () => {
    // Dave's current app stores total, last and init on the donor. They
    // drift the first time a gift is corrected and nobody fixes them by
    // hand, and a wrong donor total nobody can explain is worse than a
    // sum.
    const migration = readFileSync(join(process.cwd(), "migrations", "0012_fundraising.sql"), "utf8");
    const donorTable = migration.slice(migration.indexOf("create table donors"), migration.indexOf("create index donors_org_idx"));
    expect(donorTable).not.toMatch(/lifetime|total_given|last_gift|first_gift/);
  });
});
