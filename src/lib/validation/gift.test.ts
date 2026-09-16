import { describe, it, expect } from "vitest";
import { parseGiftForm, parsePledgeForm, centsToDecimalString } from "./gift";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const GOOD_GIFT = {
  amount: "250.00",
  receivedOn: "2026-09-16",
  category: "individual",
  method: "check",
};

describe("recording a gift", () => {
  it("accepts a plain gift", () => {
    const r = parseGiftForm(form(GOOD_GIFT));
    expect(r.ok).toBe(true);
    expect(r.values!.amountCents).toBe(25000);
  });

  it("takes the amount however it was typed", () => {
    expect(parseGiftForm(form({ ...GOOD_GIFT, amount: "$1,250.50" })).values!.amountCents).toBe(125050);
    expect(parseGiftForm(form({ ...GOOD_GIFT, amount: "19.99" })).values!.amountCents).toBe(1999);
  });

  it("refuses a gift of zero", () => {
    const r = parseGiftForm(form({ ...GOOD_GIFT, amount: "0" }));
    expect(r.ok).toBe(false);
    expect(r.errors.amount).toMatch(/cannot be zero/);
  });

  it("allows a negative amount, which is a refund", () => {
    const r = parseGiftForm(form({ ...GOOD_GIFT, amount: "-250.00" }));
    expect(r.ok).toBe(true);
    expect(r.values!.amountCents).toBe(-25000);
  });

  it("questions an amount big enough to be a typo", () => {
    const r = parseGiftForm(form({ ...GOOD_GIFT, amount: "5000000" }));
    expect(r.ok).toBe(false);
    expect(r.errors.amount).toMatch(/1,000,000/);
  });

  it("tells the difference between zero and gibberish", () => {
    expect(parseGiftForm(form({ ...GOOD_GIFT, amount: "banana" })).errors.amount).toMatch(/does not look like/);
  });

  it("refuses a date that does not exist", () => {
    const r = parseGiftForm(form({ ...GOOD_GIFT, receivedOn: "2026-02-30" }));
    expect(r.ok).toBe(false);
    expect(r.errors.receivedOn).toBeTruthy();
  });

  it("requires an in-kind gift to say what was given", () => {
    // "$500 in kind" with no description is the first thing an auditor
    // asks about and the last thing anybody can reconstruct later.
    const r = parseGiftForm(form({ ...GOOD_GIFT, method: "in_kind" }));
    expect(r.ok).toBe(false);
    expect(r.errors.inKindDescription).toBeTruthy();
  });

  it("accepts an in-kind gift that describes itself", () => {
    const r = parseGiftForm(form({ ...GOOD_GIFT, method: "in_kind", inKindDescription: "Two cases of water" }));
    expect(r.ok).toBe(true);
    expect(r.values!.inKindDescription).toBe("Two cases of water");
  });

  it("drops an in-kind description from a gift that is not in kind", () => {
    // Otherwise a method changed from in-kind to check leaves a
    // description behind that contradicts the row.
    const r = parseGiftForm(form({ ...GOOD_GIFT, method: "check", inKindDescription: "Leftover text" }));
    expect(r.values!.inKindDescription).toBeNull();
  });

  it("allows an anonymous gift", () => {
    // Cash in a bucket at an event is real money with no supporter
    // behind it, and it still counts in the total.
    const r = parseGiftForm(form(GOOD_GIFT));
    expect(r.ok).toBe(true);
    expect(r.values!.donorId).toBeNull();
  });

  it("refuses a category that is not one of the five", () => {
    expect(parseGiftForm(form({ ...GOOD_GIFT, category: "made_up" })).errors.category).toBeTruthy();
  });
});

describe("recording a pledge", () => {
  const GOOD_PLEDGE = { donorId: "d1", amount: "5000", promisedOn: "2026-01-15", dueOn: "2026-12-31" };

  it("accepts a normal pledge", () => {
    const r = parsePledgeForm(form(GOOD_PLEDGE));
    expect(r.ok).toBe(true);
    expect(r.values!.amountCents).toBe(500000);
  });

  it("requires a donor, unlike a gift", () => {
    // An anonymous promise is not a promise anyone can follow up on.
    const r = parsePledgeForm(form({ ...GOOD_PLEDGE, donorId: "" }));
    expect(r.ok).toBe(false);
    expect(r.errors.donorId).toBeTruthy();
  });

  it("refuses a negative or zero pledge", () => {
    expect(parsePledgeForm(form({ ...GOOD_PLEDGE, amount: "-100" })).ok).toBe(false);
    expect(parsePledgeForm(form({ ...GOOD_PLEDGE, amount: "0" })).ok).toBe(false);
  });

  it("refuses a due date before the promise was made", () => {
    const r = parsePledgeForm(form({ ...GOOD_PLEDGE, dueOn: "2025-01-01" }));
    expect(r.ok).toBe(false);
    expect(r.errors.dueOn).toMatch(/before the promise/);
  });

  it("allows a pledge with no due date", () => {
    const r = parsePledgeForm(form({ ...GOOD_PLEDGE, dueOn: "" }));
    expect(r.ok).toBe(true);
    expect(r.values!.dueOn).toBeNull();
  });
});

describe("cents back to the column", () => {
  it("round-trips without a floating-point tail", () => {
    expect(centsToDecimalString(25000)).toBe("250.00");
    expect(centsToDecimalString(1999)).toBe("19.99");
    expect(centsToDecimalString(7)).toBe("0.07");
    expect(centsToDecimalString(-25000)).toBe("-250.00");
    expect(centsToDecimalString(0)).toBe("0.00");
  });

  it("survives a round trip through the form parser", () => {
    for (const raw of ["0.01", "19.99", "250.00", "1250.50", "999999.99"]) {
      const cents = parseGiftForm(form({ ...GOOD_GIFT, amount: raw })).values!.amountCents;
      expect(centsToDecimalString(cents)).toBe(Number(raw).toFixed(2));
    }
  });
});
