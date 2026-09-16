// Laws for board give/get. Each is a way a board report misleads a board
// chair rather than visibly breaking, which is what makes them worth
// asserting.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { giveGetProgress, summarizeBoard, type Board, type BoardMember } from "../lib/governance/giveGet";
import type { Gift } from "../lib/fundraising/rollup";

const SRC = join(process.cwd(), "src");

const member = (over: Partial<BoardMember> = {}): BoardMember => ({
  id: "m1",
  boardId: "b1",
  name: "Example",
  donorId: "d1",
  roleTitle: null,
  status: "active",
  termStart: "2026-01-01",
  termEnd: "2026-12-31",
  commitmentCents: 10_000_00,
  ...over,
});

const gift = (over: Partial<Gift> = {}): Gift => ({
  id: "g1",
  amountCents: 5_000_00,
  receivedOn: "2026-05-01",
  category: "board",
  method: "check",
  donorId: "d1",
  campaignId: null,
  pledgeId: null,
  ...over,
});

const period = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

describe("LAW: give/get counts both halves", () => {
  // Counting only personal giving understates every member who is good
  // at fundraising and tells a board chair the wrong people are behind.
  it("money brought in counts toward the commitment", () => {
    const g = gift({ donorId: "somebody-else" });
    const p = giveGetProgress({ member: member(), gifts: [g], pledges: [], solicitedBy: { g1: "m1" }, ...period });
    expect(p.raisedCents).toBe(5_000_00);
    expect(p.totalCents).toBe(5_000_00);
  });

  it("the schema can actually record who brought a gift in", () => {
    const migration = readFileSync(join(process.cwd(), "migrations", "0013_board_governance.sql"), "utf8");
    expect(migration).toMatch(/alter table gifts add column solicited_by/);
  });

  it("the gift form offers the field when the board module is on", () => {
    const form = readFileSync(join(SRC, "components", "GiftForm.tsx"), "utf8");
    expect(form).toMatch(/name="solicitedBy"/);
    const action = readFileSync(join(SRC, "lib", "actions", "fundraising.ts"), "utf8");
    expect(action).toMatch(/solicited_by: v\.solicitedBy/);
  });
});

describe("LAW: no gift counts twice toward one commitment", () => {
  it("a gift both made and solicited by the same member counts once", () => {
    // Otherwise somebody clears a $10,000 commitment with $5,000.
    const p = giveGetProgress({ member: member(), gifts: [gift()], pledges: [], solicitedBy: { g1: "m1" }, ...period });
    expect(p.totalCents).toBe(5_000_00);
    expect(p.met).toBe(false);
  });
});

describe("LAW: a promise does not discharge a commitment", () => {
  it("a pledge sits beside the progress, never inside it", () => {
    const p = giveGetProgress({
      member: member(),
      gifts: [],
      pledges: [{ id: "p1", amountCents: 10_000_00, promisedOn: "2026-02-01", dueOn: null, status: "open", donorId: "d1", campaignId: null }],
      solicitedBy: {},
      ...period,
    });
    expect(p.totalCents).toBe(0);
    expect(p.met).toBe(false);
    expect(p.pledgedCents).toBe(10_000_00);
  });

  it("in-kind does not discharge a cash commitment either", () => {
    const p = giveGetProgress({
      member: member(),
      gifts: [gift({ amountCents: 10_000_00, method: "in_kind" })],
      pledges: [],
      solicitedBy: {},
      ...period,
    });
    expect(p.totalCents).toBe(0);
  });
});

describe("LAW: only an active seat carries a commitment", () => {
  it("a prospect or an emeritus member is not counted against the board", () => {
    // Counting them makes the board look further behind than it is,
    // which is the mirror of overstating and just as wrong.
    const board: Board = { id: "b1", kind: "sport", name: "B", sport: "baseball", giveGetCents: 5_000_00, minSeats: 3, maxSeats: 5 };
    const members = [
      member({ id: "m1", status: "active", commitmentCents: 5_000_00 }),
      member({ id: "m2", status: "prospect", commitmentCents: 5_000_00 }),
      member({ id: "m3", status: "emeritus", commitmentCents: 5_000_00 }),
    ];
    const s = summarizeBoard(board, members, []);
    expect(s.seatsFilled).toBe(1);
    expect(s.committedCents).toBe(5_000_00);
  });
});

describe("LAW: board governance is gated, in the actions and not only on the screen", () => {
  it("every governance action checks the module flag", () => {
    const source = readFileSync(join(SRC, "lib", "actions", "governance.ts"), "utf8");
    expect(source).toMatch(/modules\.board_governance/);
    const exported = (source.match(/export async function (\w+)/g) ?? []).length;
    const gated = (source.match(/await requireGovernance\(/g) ?? []).length;
    expect(exported).toBeGreaterThan(0);
    expect(gated).toBe(exported);
  });

  it("every governance screen refuses an org without the module", () => {
    // Walked rather than listed, so a screen added later cannot skip it.
    const root = join(SRC, "app", "org", "[slug]", "board-governance");
    const pages: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else if (entry.name === "page.tsx") pages.push(`${prefix}${entry.name}`);
      }
    };
    walk(root, "");
    expect(pages.length).toBeGreaterThanOrEqual(4);
    for (const p of pages) {
      const source = readFileSync(join(root, p), "utf8");
      expect(source, p).toMatch(/if \(!org\.modules\.board_governance\) notFound\(\);/);
    }
  });
});
