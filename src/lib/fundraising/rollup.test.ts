import { describe, it, expect } from "vitest";
import {
  campaignProgress,
  donorTotals,
  formatMoney,
  formatMoneyShort,
  fiscalYearOf,
  outstandingOn,
  summarize,
  toCents,
  yearlyRollup,
  type Gift,
  type Pledge,
} from "./rollup";

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

describe("money is integer cents, never a float", () => {
  it("parses the forms money actually arrives in", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents("19.99")).toBe(1999);
    expect(toCents("$1,250.00")).toBe(125000);
    expect(toCents("")).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents("not money")).toBe(0);
  });

  it("does not lose a cent to binary floating point", () => {
    // 19.99 * 100 is 1998.9999999999998. Truncating loses a cent on a
    // number somebody typed exactly.
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.07)).toBe(7);
    expect(toCents(1234.56)).toBe(123456);
  });

  it("sums a long list without drifting", () => {
    // The same list added as dollars drifts. Added as cents it cannot.
    const gifts = Array.from({ length: 1000 }, () => gift({ amountCents: toCents(0.1) }));
    const s = summarize({ ...base, gifts, pledges: [] });
    expect(s.totalCashCents).toBe(10000);
    expect(formatMoney(s.totalCashCents)).toBe("$100.00");
  });

  it("formats negative amounts as debits rather than losing the sign", () => {
    expect(formatMoney(-2550)).toBe("-$25.50");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(100000000)).toBe("$1,000,000.00");
    expect(formatMoneyShort(125050)).toBe("$1,251");
  });
});

describe("a pledge is not revenue", () => {
  it("never counts a promise in the amount raised", () => {
    const s = summarize({ ...base, gifts: [], pledges: [pledge({ amountCents: 500000 })] });
    expect(s.totalCashCents).toBe(0);
    expect(s.outstandingPledgeCents).toBe(500000);
  });

  it("reduces what is outstanding as payments land against it", () => {
    const p = pledge({ amountCents: 500000 });
    const paid = gift({ amountCents: 200000, pledgeId: p.id });
    expect(outstandingOn(p, [paid])).toBe(300000);

    const s = summarize({ ...base, gifts: [paid], pledges: [p] });
    // The payment is real money and counts. The rest is still a promise.
    expect(s.totalCashCents).toBe(200000);
    expect(s.outstandingPledgeCents).toBe(300000);
    // And the two together never exceed the original commitment plus
    // nothing: this is the double-count the rule exists to stop.
    expect(s.totalCashCents + s.outstandingPledgeCents).toBe(500000);
  });

  it("does not turn an overpayment into a negative obligation", () => {
    const p = pledge({ amountCents: 500000 });
    const paid = gift({ amountCents: 600000, pledgeId: p.id });
    expect(outstandingOn(p, [paid])).toBe(0);
  });

  it("owes nothing on a pledge that was written off", () => {
    expect(outstandingOn(pledge({ status: "written_off" }), [])).toBe(0);
    expect(outstandingOn(pledge({ status: "fulfilled" }), [])).toBe(0);
  });

  it("separates the overdue ones, which are the follow-up list", () => {
    const s = summarize({
      ...base,
      gifts: [],
      pledges: [pledge({ amountCents: 100000, dueOn: "2026-06-01" }), pledge({ amountCents: 400000, dueOn: "2026-12-31" })],
    });
    expect(s.outstandingPledgeCents).toBe(500000);
    expect(s.overduePledgeCents).toBe(100000);
  });

  it("treats a pledge with no due date as not overdue rather than always overdue", () => {
    const s = summarize({ ...base, gifts: [], pledges: [pledge({ dueOn: null })] });
    expect(s.overduePledgeCents).toBe(0);
  });
});

describe("in-kind is support, not cash", () => {
  it("keeps a donated item out of the amount raised", () => {
    const s = summarize({
      ...base,
      gifts: [gift({ amountCents: 50000, method: "in_kind" }), gift({ amountCents: 25000, method: "check" })],
      pledges: [],
    });
    expect(s.totalCashCents).toBe(25000);
    expect(s.totalInKindCents).toBe(50000);
    expect(s.totalSupportCents).toBe(75000);
  });

  it("measures budget progress against cash only", () => {
    // A category whose budget is covered entirely by donated goods has
    // not hit its target in any sense a treasurer cares about.
    const s = summarize({
      ...base,
      gifts: [gift({ amountCents: 100000, method: "in_kind", category: "corporate" })],
      pledges: [],
      budget: [{ fiscalYear: 2026, category: "corporate", amountCents: 100000 }],
    });
    const corporate = s.byCategory.find((c) => c.category === "corporate")!;
    expect(corporate.percentOfBudget).toBe(0);
  });

  it("keeps in-kind out of a campaign's raised figure too", () => {
    const p = campaignProgress(
      "c1",
      100000,
      [gift({ campaignId: "c1", amountCents: 100000, method: "in_kind" }), gift({ campaignId: "c1", amountCents: 20000 })],
      [],
    );
    expect(p.raisedCents).toBe(20000);
    expect(p.percentOfGoal).toBe(20);
  });
});

describe("the fiscal year", () => {
  it("reads the year off the date", () => {
    expect(fiscalYearOf("2026-01-01")).toBe(2026);
    expect(fiscalYearOf("2025-12-31")).toBe(2025);
  });

  it("leaves last year's gifts out of this year's total", () => {
    const s = summarize({
      ...base,
      gifts: [gift({ receivedOn: "2025-12-31", amountCents: 999999 }), gift({ receivedOn: "2026-01-01", amountCents: 10000 })],
      pledges: [],
    });
    expect(s.totalCashCents).toBe(10000);
    expect(s.giftCount).toBe(1);
  });
});

describe("category rollup", () => {
  it("returns every category, including the ones with nothing in them", () => {
    const s = summarize({ ...base, gifts: [gift({ category: "board" })], pledges: [] });
    expect(s.byCategory).toHaveLength(5);
    expect(s.byCategory.find((c) => c.category === "grant")!.receivedCents).toBe(0);
  });

  it("uses the same labels as the P&L the board already sees", () => {
    const s = summarize({ ...base, gifts: [], pledges: [] });
    expect(s.byCategory.map((c) => c.label)).toEqual([
      "Individual Donations",
      "Board Member Contributions",
      "Corporate Donations",
      "Special Events",
      "Foundation Grants",
    ]);
  });

  it("says nothing rather than zero when no budget was set", () => {
    // No budget line and a budget of zero are different statements, and
    // dividing by the second one is how a percentage becomes Infinity.
    const s = summarize({ ...base, gifts: [gift({ amountCents: 10000 })], pledges: [] });
    expect(s.byCategory.find((c) => c.category === "individual")!.percentOfBudget).toBeNull();
  });

  it("does not produce Infinity against a zero budget", () => {
    const s = summarize({
      ...base,
      gifts: [gift({ amountCents: 10000 })],
      pledges: [],
      budget: [{ fiscalYear: 2026, category: "individual", amountCents: 0 }],
    });
    expect(s.byCategory.find((c) => c.category === "individual")!.percentOfBudget).toBeNull();
  });

  it("ignores a budget line from a different year", () => {
    const s = summarize({
      ...base,
      gifts: [],
      pledges: [],
      budget: [{ fiscalYear: 2025, category: "individual", amountCents: 500000 }],
    });
    expect(s.totalBudgetCents).toBe(0);
  });
});

describe("a refund is a negative row in the same ledger", () => {
  it("reduces the total rather than needing a second code path", () => {
    const s = summarize({
      ...base,
      gifts: [gift({ amountCents: 50000 }), gift({ amountCents: -50000 })],
      pledges: [],
    });
    expect(s.totalCashCents).toBe(0);
  });
});

describe("donor totals are derived, never stored", () => {
  const gifts = [
    gift({ donorId: "d1", amountCents: 10000, receivedOn: "2024-03-01" }),
    gift({ donorId: "d1", amountCents: 25000, receivedOn: "2026-05-01" }),
    gift({ donorId: "d1", amountCents: 5000, receivedOn: "2026-07-01", method: "in_kind" }),
    gift({ donorId: "d2", amountCents: 99999, receivedOn: "2026-05-01" }),
  ];

  it("sums only that donor's gifts", () => {
    const t = donorTotals("d1", gifts, [], 2026);
    expect(t.lifetimeCashCents).toBe(35000);
    expect(t.thisYearCashCents).toBe(25000);
    expect(t.lifetimeInKindCents).toBe(5000);
    expect(t.giftCount).toBe(3);
  });

  it("finds the first and last gift by date, not by list order", () => {
    const t = donorTotals("d1", gifts, [], 2026);
    expect(t.firstGiftOn).toBe("2024-03-01");
    expect(t.lastGiftOn).toBe("2026-07-01");
  });

  it("returns empty rather than throwing for a donor who has given nothing", () => {
    const t = donorTotals("nobody", gifts, [], 2026);
    expect(t.lifetimeCashCents).toBe(0);
    expect(t.firstGiftOn).toBeNull();
    expect(t.lastGiftOn).toBeNull();
  });

  it("carries what that donor still owes on a pledge", () => {
    const p = pledge({ donorId: "d1", amountCents: 100000 });
    const t = donorTotals("d1", gifts, [p], 2026);
    expect(t.outstandingPledgeCents).toBe(100000);
  });
});

describe("donor count", () => {
  it("does not count anonymous gifts as supporters", () => {
    // Cash in a bucket at an event is real money and not somebody you
    // can thank. Counting it would inflate the figure quoted in a grant
    // application.
    const s = summarize({
      ...base,
      gifts: [gift({ donorId: "d1" }), gift({ donorId: null }), gift({ donorId: null })],
      pledges: [],
    });
    expect(s.donorCount).toBe(1);
    expect(s.giftCount).toBe(3);
  });

  it("counts a repeat donor once", () => {
    const s = summarize({ ...base, gifts: [gift({ donorId: "d1" }), gift({ donorId: "d1" })], pledges: [] });
    expect(s.donorCount).toBe(1);
  });
});

describe("campaign progress", () => {
  it("measures against cash, not cash plus promises", () => {
    // A campaign with promises covering its goal has not met its goal.
    const p = campaignProgress("c1", 1000000, [gift({ campaignId: "c1", amountCents: 250000 })], [
      pledge({ campaignId: "c1", amountCents: 750000 }),
    ]);
    expect(p.raisedCents).toBe(250000);
    expect(p.pledgedCents).toBe(750000);
    expect(p.percentOfGoal).toBe(25);
  });

  it("says nothing rather than dividing by a goal of zero", () => {
    expect(campaignProgress("c1", 0, [gift({ campaignId: "c1" })], []).percentOfGoal).toBeNull();
  });

  it("ignores gifts belonging to another campaign", () => {
    const p = campaignProgress("c1", 100000, [gift({ campaignId: "c2", amountCents: 999999 })], []);
    expect(p.raisedCents).toBe(0);
  });
});

describe("year by year, and all years together", () => {
  const gifts = [
    gift({ amountCents: 20800, receivedOn: "2024-07-22", donorId: "a" }),
    gift({ amountCents: 1821000, receivedOn: "2025-04-01", donorId: "a" }),
    gift({ amountCents: 500000, receivedOn: "2025-09-24", donorId: "b", method: "in_kind" }),
    gift({ amountCents: 250000, receivedOn: "2026-04-07", donorId: "c" }),
  ];

  it("has one row per year, newest first, from the first year with anything to the current year", () => {
    const r = yearlyRollup(gifts, [], 2026);
    expect(r.years.map((y) => y.year)).toEqual([2026, 2025, 2024]);
  });

  it("a year with nothing in it is still a row, and a gap year is not skipped", () => {
    const r = yearlyRollup([gift({ receivedOn: "2023-02-01" })], [], 2026);
    expect(r.years.map((y) => y.year)).toEqual([2026, 2025, 2024, 2023]);
    expect(r.years[0]).toMatchObject({ cashCents: 0, giftCount: 0 });
  });

  it("the current year is present even with no records at all", () => {
    expect(yearlyRollup([], [], 2026).years.map((y) => y.year)).toEqual([2026]);
  });

  it("each year counts its own cash and gifts, and in-kind is never cash", () => {
    const r = yearlyRollup(gifts, [], 2026);
    const by = Object.fromEntries(r.years.map((y) => [y.year, y]));
    expect(by[2024]).toMatchObject({ cashCents: 20800, giftCount: 1 });
    expect(by[2025]).toMatchObject({ cashCents: 1821000, inKindCents: 500000, giftCount: 2 });
    expect(by[2026]).toMatchObject({ cashCents: 250000, giftCount: 1 });
  });

  it("all-time is the sum of the years, so the top of the page can never read zero while a year holds money", () => {
    const r = yearlyRollup(gifts, [], 2026);
    expect(r.cashCents).toBe(r.years.reduce((s, y) => s + y.cashCents, 0));
    expect(r.giftCount).toBe(r.years.reduce((s, y) => s + y.giftCount, 0));
    expect(r.cashCents).toBe(20800 + 1821000 + 250000);
    expect(r.giftCount).toBe(4);
    expect(r.donorCount).toBe(3);
  });

  it("a pledge is shown per year and all-time, beside the cash and never inside it", () => {
    const p = [
      pledge({ id: "p1", amountCents: 1000000, promisedOn: "2025-10-01" }),
      pledge({ id: "p2", amountCents: 150000, promisedOn: "2026-10-11" }),
    ];
    const r = yearlyRollup(gifts, p, 2026);
    const by = Object.fromEntries(r.years.map((y) => [y.year, y]));
    expect(by[2025]).toMatchObject({ promisedCents: 1000000, outstandingPledgeCents: 1000000 });
    expect(by[2026]).toMatchObject({ promisedCents: 150000, outstandingPledgeCents: 150000 });
    expect(r.promisedCents).toBe(1150000);
    expect(r.outstandingPledgeCents).toBe(1150000);
    expect(r.cashCents).toBe(20800 + 1821000 + 250000);
  });

  it("what a later gift paid against a pledge reduces what is still owed on it", () => {
    const p = [pledge({ id: "p1", amountCents: 1000000, promisedOn: "2025-10-01" })];
    const paid = [gift({ amountCents: 400000, receivedOn: "2026-02-01", pledgeId: "p1" })];
    const r = yearlyRollup(paid, p, 2026);
    expect(r.years.find((y) => y.year === 2025)).toMatchObject({ promisedCents: 1000000, outstandingPledgeCents: 600000 });
    expect(r.outstandingPledgeCents).toBe(600000);
  });

  it("a written-off or fulfilled pledge owes nothing but was still promised", () => {
    const p = [pledge({ amountCents: 300000, promisedOn: "2026-03-01", status: "written_off" })];
    const r = yearlyRollup([], p, 2026);
    expect(r.promisedCents).toBe(300000);
    expect(r.outstandingPledgeCents).toBe(0);
  });
});
