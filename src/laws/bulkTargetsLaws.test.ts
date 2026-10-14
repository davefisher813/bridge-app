// Bulk actions on the Targets board (Dave, 2026-10-13).
//
// Held to: only STAFF run them and a Viewer is refused before any write;
// every write is scoped by id AND org and another org's ids are untouched;
// Offer and Committed are never set in bulk, and a target on Offer or
// Committed, or a placed athlete's target, is skipped, never bypassed;
// one activity_log row per target changed; the notice names the counts;
// Remove Targets is destructive, confirms once naming the count, and
// says there is no Undo; the board wraps its rows in BulkSelect.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { buildFixture, IDS, ORG_WITH_MODULES, OWNER_ID, MEMBER_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";
import { filterColumns, form, orgIdBySlug, run, writesTo } from "@/testing/actionHarness";
import { BULK_STATUSES, bulkNotice, removeSkipReason, statusSkipReason } from "@/lib/bulk/targets";

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
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }),
}));

const FOREIGN_TARGET = "00000000-0000-0000-0000-000000000e9f";

// The fixture's committed and transferring target ids are not full UUIDs
// (parseBulkIds drops them), so the cases that need those shapes get
// full-length rows of the same shape here.
const T = {
  committed: "00000000-0000-0000-0000-00000000ee03",
  placedOpen: "00000000-0000-0000-0000-00000000ee04",
  transferring: "00000000-0000-0000-0000-00000000ee07",
};

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
  const org = orgIdBySlug(data, ORG_WITH_MODULES);
  const base = { org_id: org, coach_name: null, offer_type: null, offer_scholarship_percent: null, closed_from: null };
  data.recruiting_targets!.push(
    { ...base, id: T.committed, athlete_id: IDS.athleteCommitted, school_id: IDS.school, status: "Committed" },
    { ...base, id: T.placedOpen, athlete_id: IDS.athleteCommitted, school_id: IDS.schoolD3, status: "In Contact" },
    { ...base, id: T.transferring, athlete_id: IDS.athleteTransferring, school_id: IDS.schoolD3, status: "In Contact" },
  );
});

function bulk(ids: string[], extra: Record<string, string> = {}): FormData {
  const fd = form(extra);
  for (const id of ids) fd.append("ids", id);
  return fd;
}

const read = (p: string) => readFileSync(p, "utf8");
const noticeOf = (r: { redirect: string | null }) => decodeURIComponent(r.redirect ?? "");

describe("the rule", () => {
  it("offers only statuses that need no facts of their own", () => {
    expect([...BULK_STATUSES]).toEqual(["Target", "In Contact", "Visit", "Not Interested"]);
    expect(BULK_STATUSES).not.toContain("Offer");
    expect(BULK_STATUSES).not.toContain("Committed");
  });
  it("skips Offer, Committed, placed athletes and no-ops", () => {
    expect(statusSkipReason({ status: "Target", athleteStatus: "Active" }, "Visit")).toBeNull();
    expect(statusSkipReason({ status: "Offer", athleteStatus: "Active" }, "Visit")).not.toBeNull();
    expect(statusSkipReason({ status: "Committed", athleteStatus: "Active" }, "Visit")).not.toBeNull();
    expect(statusSkipReason({ status: "In Contact", athleteStatus: "Committed" }, "Visit")).not.toBeNull();
    expect(statusSkipReason({ status: "Visit", athleteStatus: "Active" }, "Visit")).not.toBeNull();
    expect(removeSkipReason({ status: "Committed", athleteStatus: "Active" })).not.toBeNull();
    expect(removeSkipReason({ status: "Target", athleteStatus: "Active" })).toBeNull();
  });
  it("the notice names the counts", () => {
    expect(bulkNotice("updated", 3, 1)).toBe("3 updated, 1 skipped.");
    expect(bulkNotice("removed", 2, 0)).toBe("2 removed.");
    expect(bulkNotice("updated", 0, 2)).toBe("None updated, 2 skipped.");
  });
});

describe("bulkChangeTargetStatus", () => {
  it("changes the safe rows, skips the protected ones and counts both", async () => {
    const { bulkChangeTargetStatus } = await import("@/lib/actions/targetsBulk");
    const ids = [IDS.targetNoCoach, IDS.target, T.committed, T.placedOpen];
    const r = await run(() => bulkChangeTargetStatus(ORG_WITH_MODULES, bulk(ids, { status: "Visit" })));
    expect(noticeOf(r)).toContain("notice=1 updated, 3 skipped.");

    const ups = writesTo(writes, "recruiting_targets", "update");
    expect(ups).toHaveLength(1);
    expect(ups[0]!.rows[0]).toMatchObject({ status: "Visit", closed_from: null });
    expect(filterColumns(ups[0])).toEqual(["id", "org_id"]);
    const target = (data.recruiting_targets ?? []).find((t) => t.id === IDS.targetNoCoach);
    expect(target?.status).toBe("Visit");
    expect((data.recruiting_targets ?? []).find((t) => t.id === IDS.target)?.status).toBe("Offer");
    expect((data.recruiting_targets ?? []).find((t) => t.id === T.committed)?.status).toBe("Committed");
    expect((data.recruiting_targets ?? []).find((t) => t.id === T.placedOpen)?.status).toBe("In Contact");
  });

  it("writes one activity row per target changed", async () => {
    const { bulkChangeTargetStatus } = await import("@/lib/actions/targetsBulk");
    const r = await run(() => bulkChangeTargetStatus(ORG_WITH_MODULES, bulk([IDS.targetNoCoach, T.transferring], { status: "Not Interested" })));
    expect(noticeOf(r)).toContain("2 updated.");
    const logs = writesTo(writes, "activity_log", "insert");
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.rows[0]!.subject_id).sort()).toEqual([IDS.targetNoCoach, T.transferring].sort());
    for (const l of logs) expect(l.rows[0]).toMatchObject({ action: "target_status_changed", subject_type: "target" });
  });

  it("refuses Offer and Committed as the new status, writing nothing", async () => {
    const { bulkChangeTargetStatus } = await import("@/lib/actions/targetsBulk");
    for (const status of ["Offer", "Committed", "Bogus"]) {
      await run(() => bulkChangeTargetStatus(ORG_WITH_MODULES, bulk([IDS.targetNoCoach], { status })));
    }
    expect(writesTo(writes, "recruiting_targets")).toHaveLength(0);
    expect(writesTo(writes, "activity_log")).toHaveLength(0);
  });

  it("refuses a Viewer before any write", async () => {
    currentUser = MEMBER_ID;
    const { bulkChangeTargetStatus } = await import("@/lib/actions/targetsBulk");
    await run(() => bulkChangeTargetStatus(ORG_WITH_MODULES, bulk([IDS.targetNoCoach], { status: "Visit" }))).catch(() => null);
    expect(writes).toHaveLength(0);
  });

  it("leaves another org's ids untouched", async () => {
    data.recruiting_targets!.push({ id: FOREIGN_TARGET, org_id: "00000000-0000-0000-0000-0000000000a2", athlete_id: IDS.athlete, school_id: IDS.school, status: "Target", coach_name: null, offer_type: null, offer_scholarship_percent: null, closed_from: null });
    const { bulkChangeTargetStatus } = await import("@/lib/actions/targetsBulk");
    const r = await run(() => bulkChangeTargetStatus(ORG_WITH_MODULES, bulk([FOREIGN_TARGET], { status: "Visit" })));
    expect(noticeOf(r)).toContain("None updated, 1 skipped.");
    expect(writesTo(writes, "recruiting_targets")).toHaveLength(0);
    expect(data.recruiting_targets!.find((t) => t.id === FOREIGN_TARGET)?.status).toBe("Target");
    expect(orgIdBySlug(data, ORG_WITH_MODULES)).not.toBe("00000000-0000-0000-0000-0000000000a2");
  });

  it("reports nothing selected without writing", async () => {
    const { bulkChangeTargetStatus } = await import("@/lib/actions/targetsBulk");
    const r = await run(() => bulkChangeTargetStatus(ORG_WITH_MODULES, bulk([], { status: "Visit" })));
    expect(noticeOf(r)).toContain("error=Nothing was selected.");
    expect(writes).toHaveLength(0);
  });
});

describe("bulkRemoveTargets", () => {
  it("removes the removable, skips Committed, logs one row each and counts both", async () => {
    const { bulkRemoveTargets } = await import("@/lib/actions/targetsBulk");
    const r = await run(() => bulkRemoveTargets(ORG_WITH_MODULES, bulk([IDS.targetNoCoach, T.transferring, T.committed])));
    expect(noticeOf(r)).toContain("notice=2 removed, 1 skipped.");
    const dels = writesTo(writes, "recruiting_targets", "delete");
    expect(dels).toHaveLength(2);
    for (const d of dels) expect(filterColumns(d)).toEqual(["id", "org_id"]);
    expect((data.recruiting_targets ?? []).some((t) => t.id === T.committed)).toBe(true);
    const logs = writesTo(writes, "activity_log", "insert");
    expect(logs).toHaveLength(2);
    for (const l of logs) expect(l.rows[0]).toMatchObject({ action: "target_removed" });
  });

  it("refuses a Viewer before any write", async () => {
    currentUser = MEMBER_ID;
    const { bulkRemoveTargets } = await import("@/lib/actions/targetsBulk");
    await run(() => bulkRemoveTargets(ORG_WITH_MODULES, bulk([IDS.targetNoCoach]))).catch(() => null);
    expect(writes).toHaveLength(0);
  });

  it("leaves another org's ids untouched", async () => {
    data.recruiting_targets!.push({ id: FOREIGN_TARGET, org_id: "00000000-0000-0000-0000-0000000000a2", athlete_id: IDS.athlete, school_id: IDS.school, status: "Target", coach_name: null, offer_type: null, offer_scholarship_percent: null, closed_from: null });
    const { bulkRemoveTargets } = await import("@/lib/actions/targetsBulk");
    const r = await run(() => bulkRemoveTargets(ORG_WITH_MODULES, bulk([FOREIGN_TARGET])));
    expect(noticeOf(r)).toContain("None removed, 1 skipped.");
    expect(writesTo(writes, "recruiting_targets")).toHaveLength(0);
    expect(data.recruiting_targets!.some((t) => t.id === FOREIGN_TARGET)).toBe(true);
  });
});

describe("the board", () => {
  const board = read("src/app/org/[slug]/board/page.tsx");
  it("wraps its rows in BulkSelect with the target noun and gives each row a checkbox", () => {
    expect(board).toMatch(/<BulkSelect[\s\S]*?noun="target"/);
    expect(board).toContain("select={<BulkCheck");
    expect(board).toContain("ids={shown.map((r) => r.id)}");
  });
  it("Remove Targets is destructive, names the count, and says there is no Undo", () => {
    expect(board).toMatch(/label="Remove Targets"[\s\S]*?question="Remove \{n\}"[\s\S]*?destructive/);
    expect(board).toContain("cannot be undone");
  });
  it("Change Status offers only the bulk statuses", () => {
    expect(board).toContain("BULK_STATUSES.map");
    expect(board).not.toMatch(/<option[^>]*>\s*(Offer|Committed)\s*</);
  });
  it("both actions are STAFF only, parse the ids, scope by org and log", () => {
    const src = read("src/lib/actions/targetsBulk.ts");
    expect(src.match(/requireRole\(org\.id, STAFF_ROLES\)/g)).toHaveLength(2);
    expect(src.match(/parseBulkIds\(formData\)/g)).toHaveLength(2);
    expect(src).toContain('.eq("org_id", orgId)');
    expect(src).toContain('action: "target_status_changed"');
    expect(src).toContain('action: "target_removed"');
    expect(src).not.toMatch(/\.update\([^)]*status: "(Offer|Committed)"/);
  });
});
