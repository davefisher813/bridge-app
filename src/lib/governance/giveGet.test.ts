import { describe, it, expect } from "vitest";
import {
  giveGetProgress,
  summarizeBoard,
  DEFAULT_GIVE_GET_CENTS,
  DEFAULT_SEATS,
  type Board,
  type BoardMember,
} from "./giveGet";
import type { Gift, Pledge } from "@/lib/fundraising/rollup";

const member = (over: Partial<BoardMember> = {}): BoardMember => ({
  id: "m1",
  boardId: "b1",
  name: "Example Member",
  donorId: "d1",
  roleTitle: null,
  status: "active",
  termStart: "2026-01-01",
  termEnd: "2026-12-31",
  commitmentCents: 10_000_00,
  ...over,
});

const gift = (over: Partial<Gift> = {}): Gift => ({
  id: crypto.randomUUID(),
  amountCents: 100_00,
  receivedOn: "2026-05-01",
  category: "board",
  method: "check",
  donorId: "d1",
  campaignId: null,
  pledgeId: null,
  ...over,
});

const pledge = (over: Partial<Pledge> = {}): Pledge => ({
  id: crypto.randomUUID(),
  amountCents: 500_00,
  promisedOn: "2026-02-01",
  dueOn: "2026-12-31",
  status: "open",
  donorId: "d1",
  campaignId: null,
  ...over,
});

const period = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

describe("give and get both count", () => {
  it("counts money the member gave themselves", () => {
    const p = giveGetProgress({ member: member(), gifts: [gift({ amountCents: 4_000_00 })], pledges: [], solicitedBy: {}, ...period });
    expect(p.givenCents).toBe(4_000_00);
    expect(p.raisedCents).toBe(0);
    expect(p.totalCents).toBe(4_000_00);
  });

  it("counts money they brought in from somebody else", () => {
    // The half most board software drops, which understates every
    // member who is good at fundraising.
    const g = gift({ amountCents: 6_000_00, donorId: "someone-else" });
    const p = giveGetProgress({ member: member(), gifts: [g], pledges: [], solicitedBy: { [g.id]: "m1" }, ...period });
    expect(p.givenCents).toBe(0);
    expect(p.raisedCents).toBe(6_000_00);
    expect(p.totalCents).toBe(6_000_00);
  });

  it("reaches the commitment on a mix of both", () => {
    const own = gift({ amountCents: 4_000_00 });
    const brought = gift({ amountCents: 6_000_00, donorId: "someone-else" });
    const p = giveGetProgress({
      member: member(),
      gifts: [own, brought],
      pledges: [],
      solicitedBy: { [brought.id]: "m1" },
      ...period,
    });
    expect(p.totalCents).toBe(10_000_00);
    expect(p.met).toBe(true);
    expect(p.remainingCents).toBe(0);
    expect(p.percent).toBe(100);
  });
});

describe("no gift is ever counted twice", () => {
  it("a gift the member both made and solicited counts once", () => {
    // Otherwise somebody clears a $10,000 commitment with $5,000.
    const g = gift({ amountCents: 5_000_00, donorId: "d1" });
    const p = giveGetProgress({ member: member(), gifts: [g], pledges: [], solicitedBy: { [g.id]: "m1" }, ...period });
    expect(p.totalCents).toBe(5_000_00);
    expect(p.met).toBe(false);
  });

  it("ignores a gift somebody else solicited", () => {
    const g = gift({ amountCents: 9_000_00, donorId: "someone-else" });
    const p = giveGetProgress({ member: member(), gifts: [g], pledges: [], solicitedBy: { [g.id]: "m2" }, ...period });
    expect(p.totalCents).toBe(0);
  });
});

describe("a pledge is still not money", () => {
  it("sits beside the progress, never inside it", () => {
    const p = giveGetProgress({
      member: member(),
      gifts: [],
      pledges: [pledge({ amountCents: 10_000_00 })],
      solicitedBy: {},
      ...period,
    });
    expect(p.totalCents).toBe(0);
    expect(p.met).toBe(false);
    expect(p.pledgedCents).toBe(10_000_00);
  });

  it("falls as payments against it arrive", () => {
    const pl = pledge({ amountCents: 10_000_00 });
    const paid = gift({ amountCents: 3_000_00, pledgeId: pl.id });
    const p = giveGetProgress({ member: member(), gifts: [paid], pledges: [pl], solicitedBy: {}, ...period });
    expect(p.totalCents).toBe(3_000_00);
    expect(p.pledgedCents).toBe(7_000_00);
  });
});

describe("the period the commitment applies to", () => {
  it("does not let last year's giving discharge this year's commitment", () => {
    const p = giveGetProgress({
      member: member(),
      gifts: [gift({ amountCents: 20_000_00, receivedOn: "2025-06-01" })],
      pledges: [],
      solicitedBy: {},
      ...period,
    });
    expect(p.totalCents).toBe(0);
    expect(p.met).toBe(false);
  });

  it("counts the boundary days themselves", () => {
    const first = giveGetProgress({
      member: member(),
      gifts: [gift({ amountCents: 1_00, receivedOn: "2026-01-01" })],
      pledges: [],
      solicitedBy: {},
      ...period,
    });
    const last = giveGetProgress({
      member: member(),
      gifts: [gift({ amountCents: 1_00, receivedOn: "2026-12-31" })],
      pledges: [],
      solicitedBy: {},
      ...period,
    });
    expect(first.totalCents).toBe(1_00);
    expect(last.totalCents).toBe(1_00);
  });
});

describe("in-kind does not discharge a cash commitment", () => {
  it("a donated item is not $10,000", () => {
    const p = giveGetProgress({
      member: member(),
      gifts: [gift({ amountCents: 10_000_00, method: "in_kind" })],
      pledges: [],
      solicitedBy: {},
      ...period,
    });
    expect(p.totalCents).toBe(0);
    expect(p.met).toBe(false);
  });
});

describe("a member who is not in the donor list", () => {
  it("can still be credited with what they brought in", () => {
    const g = gift({ amountCents: 5_000_00, donorId: "someone-else" });
    const p = giveGetProgress({
      member: member({ donorId: null }),
      gifts: [g],
      pledges: [],
      solicitedBy: { [g.id]: "m1" },
      ...period,
    });
    expect(p.raisedCents).toBe(5_000_00);
  });

  it("is never credited with an anonymous gift by accident", () => {
    // donorId null on both sides must not match. An anonymous bucket at
    // an event is not this member's personal giving.
    const p = giveGetProgress({
      member: member({ donorId: null }),
      gifts: [gift({ amountCents: 9_000_00, donorId: null })],
      pledges: [],
      solicitedBy: {},
      ...period,
    });
    expect(p.givenCents).toBe(0);
    expect(p.totalCents).toBe(0);
  });
});

describe("a seat with no commitment", () => {
  it("reports nothing rather than 0% of nothing", () => {
    const p = giveGetProgress({ member: member({ commitmentCents: 0 }), gifts: [], pledges: [], solicitedBy: {}, ...period });
    expect(p.percent).toBeNull();
    expect(p.met).toBe(false);
  });
});

describe("summarizing a board", () => {
  const board: Board = { id: "b1", kind: "sport", name: "Baseball Board", sport: "baseball", giveGetCents: 5_000_00, minSeats: 3, maxSeats: 5 };

  it("counts only active seats", () => {
    // A prospect has not joined and an emeritus member is not on the
    // hook, so counting either misstates both the seats and the money.
    const members = [
      member({ id: "m1", status: "active", commitmentCents: 5_000_00 }),
      member({ id: "m2", status: "prospect", commitmentCents: 5_000_00 }),
      member({ id: "m3", status: "emeritus", commitmentCents: 5_000_00 }),
      member({ id: "m4", status: "resigned", commitmentCents: 5_000_00 }),
    ];
    const s = summarizeBoard(board, members, []);
    expect(s.seatsFilled).toBe(1);
    expect(s.committedCents).toBe(5_000_00);
  });

  it("flags a sport board below its floor of three", () => {
    const s = summarizeBoard(board, [member({ id: "m1" })], []);
    expect(s.belowMinimum).toBe(true);
    expect(s.seatsOpen).toBe(4);
  });

  it("knows when a board is full", () => {
    const members = ["m1", "m2", "m3", "m4", "m5"].map((id) => member({ id, commitmentCents: 5_000_00 }));
    const s = summarizeBoard(board, members, []);
    expect(s.atCapacity).toBe(true);
    expect(s.seatsOpen).toBe(0);
    expect(s.belowMinimum).toBe(false);
  });

  it("adds up what the board has raised against what it committed", () => {
    const members = [member({ id: "m1", commitmentCents: 5_000_00 }), member({ id: "m2", commitmentCents: 5_000_00 })];
    const progress = members.map((m) => giveGetProgress({ member: m, gifts: [], pledges: [], solicitedBy: {}, ...period }));
    progress[0]!.totalCents = 5_000_00;
    progress[0]!.met = true;
    const s = summarizeBoard(board, members, progress);
    expect(s.committedCents).toBe(10_000_00);
    expect(s.raisedCents).toBe(5_000_00);
    expect(s.percent).toBe(50);
    expect(s.membersMeeting).toBe(1);
  });
});

describe("the tiers from the governance document", () => {
  it("carries the amounts Bridge published", () => {
    expect(DEFAULT_GIVE_GET_CENTS.executive).toBe(10_000_00);
    expect(DEFAULT_GIVE_GET_CENTS.general).toBe(5_000_00);
    expect(DEFAULT_GIVE_GET_CENTS.sport).toBe(5_000_00);
    expect(DEFAULT_GIVE_GET_CENTS.development).toBe(1_000_00);
    expect(DEFAULT_GIVE_GET_CENTS.junior).toBe(500_00);
  });

  it("starts a sport board at three seats and caps it at five", () => {
    expect(DEFAULT_SEATS.sport).toEqual({ min: 3, max: 5 });
  });
});
