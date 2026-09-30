// Assignments: the pure rules (overdue, due soon, ordering, grouping,
// counts, the family upload path), the form parsing, and the loaders
// against the fixture. Overdue is computed and never stored, so most of
// what is tested here is one function fed different days.

import { describe, expect, it } from "vitest";
import { buildFixture, IDS, OWNER_ID } from "@/testing/fixture";
import { createFakeClient } from "@/testing/fakeSupabase";
import {
  ASSIGNMENT_CATEGORIES,
  ASSIGNMENT_CATEGORY_LABEL,
  ASSIGNMENT_KINDS,
  ASSIGNMENT_KIND_LABEL,
  ASSIGNMENT_KIND_LOG_WORD,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_LABEL,
  DUE_SOON_DAYS,
  FAMILY_STORAGE_PATH,
  computeDueSoon,
  computeOverdue,
  countByAthlete,
  countsFor,
  familyStoragePath,
  groupAssignments,
  isFamilyStoragePathFor,
  isOpenStatus,
  loadAssignment,
  loadAssignmentCounts,
  loadAssignmentDocument,
  loadAthleteAssignments,
  loadOrgAssignments,
  partitionOrgAssignments,
  safeStorageFileName,
  sortByUrgency,
  todayIso,
  type Assignment,
} from "./assignments";
import { parseAssignmentForm, parseReview, parseSubmissionNote } from "@/lib/validation/assignment";

const BRIDGE = "00000000-0000-0000-0000-0000000000a1";
const TODAY = "2026-09-29";

const row = (over: Partial<Pick<Assignment, "dueOn" | "status" | "title" | "athleteId">> = {}) => ({ dueOn: "2026-09-29", status: "assigned" as const, title: "T", athleteId: "a", ...over });

describe("computeOverdue: pure, from due_on, status and today", () => {
  it("is overdue when due before today on an assigned or needs_revision row", () => {
    expect(computeOverdue("2026-09-28", "assigned", TODAY)).toBe(true);
    expect(computeOverdue("2026-09-28", "needs_revision", TODAY)).toBe(true);
  });

  it("is not overdue on the due date itself, and is the day after", () => {
    expect(computeOverdue("2026-09-29", "assigned", TODAY)).toBe(false);
    expect(computeOverdue("2026-09-29", "assigned", "2026-09-30")).toBe(true);
  });

  it("is never overdue without a due date", () => {
    expect(computeOverdue(null, "assigned", TODAY)).toBe(false);
    expect(computeOverdue(undefined, "needs_revision", TODAY)).toBe(false);
  });

  it("is never overdue once submitted, complete or cancelled, whatever the date", () => {
    for (const status of ["submitted", "complete", "cancelled"]) expect(computeOverdue("2020-01-01", status, TODAY)).toBe(false);
  });

  it("gives the same answer for the same inputs and a different one as the day moves", () => {
    expect(computeOverdue("2026-10-01", "assigned", "2026-09-30")).toBe(false);
    expect(computeOverdue("2026-10-01", "assigned", "2026-10-02")).toBe(true);
  });

  it("reads a timestamp's date part and a Date as the org's calendar day", () => {
    expect(computeOverdue("2026-09-28T23:00:00.000Z", "assigned", TODAY)).toBe(true);
    // 2026-09-30 01:00 UTC is still 2026-09-29 in New York, so a row due the 29th is not overdue yet.
    expect(computeOverdue("2026-09-29", "assigned", new Date("2026-09-30T01:00:00.000Z"))).toBe(false);
    expect(computeOverdue("2026-09-29", "assigned", new Date("2026-09-30T03:59:00.000Z"))).toBe(false);
    expect(computeOverdue("2026-09-29", "assigned", new Date("2026-09-30T04:00:00.000Z"))).toBe(true);
  });
});

describe("computeDueSoon", () => {
  it("is due today or within the window, on open rows only", () => {
    expect(DUE_SOON_DAYS).toBe(7);
    expect(computeDueSoon("2026-09-29", "assigned", TODAY)).toBe(true);
    expect(computeDueSoon("2026-10-06", "needs_revision", TODAY)).toBe(true);
    expect(computeDueSoon("2026-10-07", "assigned", TODAY)).toBe(false);
    expect(computeDueSoon("2026-10-03", "submitted", TODAY)).toBe(false);
    expect(computeDueSoon("2026-10-03", "complete", TODAY)).toBe(false);
  });

  it("is not due soon when overdue or undated, and the two never overlap", () => {
    expect(computeDueSoon("2026-09-28", "assigned", TODAY)).toBe(false);
    expect(computeDueSoon(null, "assigned", TODAY)).toBe(false);
    for (let d = -3; d <= 10; d++) {
      const due = new Date(Date.UTC(2026, 8, 29 + d)).toISOString().slice(0, 10);
      expect(computeOverdue(due, "assigned", TODAY) && computeDueSoon(due, "assigned", TODAY)).toBe(false);
    }
  });

  it("takes a window of its own", () => {
    expect(computeDueSoon("2026-10-01", "assigned", TODAY, 2)).toBe(true);
    expect(computeDueSoon("2026-10-02", "assigned", TODAY, 2)).toBe(false);
  });
});

describe("the closed lists", () => {
  it("has no in-progress status and a label for every value", () => {
    expect([...ASSIGNMENT_STATUSES]).toEqual(["assigned", "submitted", "needs_revision", "complete", "cancelled"]);
    for (const s of ASSIGNMENT_STATUSES) expect(ASSIGNMENT_STATUS_LABEL[s]).toMatch(/^[A-Z]/);
    for (const c of ASSIGNMENT_CATEGORIES) expect(ASSIGNMENT_CATEGORY_LABEL[c]).toBeTruthy();
    for (const k of ASSIGNMENT_KINDS) {
      expect(ASSIGNMENT_KIND_LABEL[k]).toBeTruthy();
      expect(ASSIGNMENT_KIND_LOG_WORD[k]).toMatch(/^[a-z]+$/);
    }
    expect(ASSIGNMENT_CATEGORIES).toHaveLength(9);
  });

  it("open means assigned or sent back", () => {
    expect(["assigned", "needs_revision"].every(isOpenStatus)).toBe(true);
    expect(["submitted", "complete", "cancelled"].some(isOpenStatus)).toBe(false);
  });
});

describe("todayIso", () => {
  it("is the org's calendar day, not UTC's", () => {
    expect(todayIso(new Date("2026-09-30T02:00:00.000Z"))).toBe("2026-09-29");
    expect(todayIso(new Date("2026-09-30T05:00:00.000Z"))).toBe("2026-09-30");
    expect(todayIso(new Date("2026-09-29T12:00:00.000Z"), "UTC")).toBe("2026-09-29");
  });
});

describe("sortByUrgency, groupAssignments, partitionOrgAssignments", () => {
  const rows = [
    row({ title: "Done", status: "complete", dueOn: "2026-09-01" }),
    row({ title: "Cancelled", status: "cancelled", dueOn: null }),
    row({ title: "Later", dueOn: "2026-12-01" }),
    row({ title: "Undated", dueOn: null }),
    row({ title: "Waiting", status: "submitted", dueOn: "2026-09-25" }),
    row({ title: "Soon", dueOn: "2026-10-02" }),
    row({ title: "Late", dueOn: "2026-09-20" }),
    row({ title: "Later Still", dueOn: "2026-12-15", status: "needs_revision" }),
    row({ title: "Very Late", dueOn: "2026-09-10" }),
  ];

  it("puts overdue first (oldest first), then due soon, then the rest of the open, then submitted, complete and cancelled", () => {
    expect(sortByUrgency(rows, TODAY).map((r) => r.title)).toEqual(["Very Late", "Late", "Soon", "Later", "Later Still", "Undated", "Waiting", "Done", "Cancelled"]);
  });

  it("returns a new array", () => {
    const copy = [...rows];
    sortByUrgency(rows, TODAY);
    expect(rows).toEqual(copy);
  });

  it("groups Open, Submitted and Done", () => {
    const g = groupAssignments(rows);
    expect(g.open.map((r) => r.title).sort()).toEqual(["Late", "Later", "Later Still", "Soon", "Undated", "Very Late"]);
    expect(g.submitted.map((r) => r.title)).toEqual(["Waiting"]);
    expect(g.done.map((r) => r.title).sort()).toEqual(["Cancelled", "Done"]);
  });

  it("partitions the org list into Submitted for Review, Overdue and Due Soon, each row in at most one", () => {
    const p = partitionOrgAssignments(rows, TODAY);
    expect(p.submitted.map((r) => r.title)).toEqual(["Waiting"]);
    expect(p.overdue.map((r) => r.title)).toEqual(["Very Late", "Late"]);
    expect(p.dueSoon.map((r) => r.title)).toEqual(["Soon"]);
    const all = [...p.submitted, ...p.overdue, ...p.dueSoon];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("countByAthlete", () => {
  it("counts overdue, waiting on review and open per athlete", () => {
    const map = countByAthlete(
      [
        row({ athleteId: "x", dueOn: "2026-09-01" }),
        row({ athleteId: "x", dueOn: "2026-12-01" }),
        row({ athleteId: "x", status: "submitted" }),
        row({ athleteId: "y", status: "complete" }),
        row({ athleteId: "y", status: "needs_revision", dueOn: "2026-09-02" }),
      ],
      TODAY,
    );
    expect(countsFor(map, "x")).toEqual({ overdue: 1, toReview: 1, open: 2 });
    expect(countsFor(map, "y")).toEqual({ overdue: 1, toReview: 0, open: 1 });
    expect(countsFor(map, "nobody")).toEqual({ overdue: 0, toReview: 0, open: 0 });
  });
});

describe("the family upload path", () => {
  const ORG = "00000000-0000-0000-0000-0000000000a1";

  it("is exactly <org>/family/<request>/<file>", () => {
    expect(FAMILY_STORAGE_PATH.test(`${ORG}/family/req1/report.pdf`)).toBe(true);
    expect(FAMILY_STORAGE_PATH.test(`${ORG}/req1/report.pdf`)).toBe(false);
    expect(FAMILY_STORAGE_PATH.test(`${ORG}/family/report.pdf`)).toBe(false);
    expect(FAMILY_STORAGE_PATH.test(`${ORG}/family/a/b/report.pdf`)).toBe(false);
    expect(FAMILY_STORAGE_PATH.test(`${ORG}/family/req1/../x.pdf`)).toBe(false);
    expect(FAMILY_STORAGE_PATH.test(`${ORG}/family/req 1/report.pdf`)).toBe(false);
  });

  it("must be this org's, and not a bare dot segment", () => {
    expect(isFamilyStoragePathFor(`${ORG}/family/req1/report.pdf`, ORG)).toBe(true);
    expect(isFamilyStoragePathFor(`${ORG}/family/req1/report.pdf`, "00000000-0000-0000-0000-0000000000a2")).toBe(false);
    expect(isFamilyStoragePathFor(`${ORG}/family/req1/..`, ORG)).toBe(false);
    expect(isFamilyStoragePathFor(`${ORG}/family/req1/.`, ORG)).toBe(false);
  });

  it("builds a path the rules accept from any file name", () => {
    expect(familyStoragePath(ORG, "req1", "Report Card (final).pdf")).toBe(`${ORG}/family/req1/Report_Card_final_.pdf`);
    expect(familyStoragePath(ORG, "req1", "../../etc/passwd")).toBe(`${ORG}/family/req1/_.._etc_passwd`);
    expect(familyStoragePath(ORG, "req1", "....")).toBe(`${ORG}/family/req1/file`);
    expect(safeStorageFileName("")).toBe("file");
    expect(familyStoragePath(ORG, "bad request!", "a.pdf")).toBeNull();
  });
});

describe("the forms", () => {
  const form = (values: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.append(k, v);
    return fd;
  };

  it("accepts a title with the defaults, and a full one", () => {
    const min = parseAssignmentForm(form({ title: "  Send Transcript " }));
    expect(min.ok).toBe(true);
    expect(min.values).toMatchObject({ title: "Send Transcript", category: "other", kind: "other" });
    expect(min.values?.dueOn).toBeUndefined();
    const full = parseAssignmentForm(form({ title: "Send Transcript", instructions: "Do it.", category: "academics", kind: "upload", dueOn: "2026-10-01" }));
    expect(full.values).toMatchObject({ category: "academics", kind: "upload", dueOn: "2026-10-01", instructions: "Do it." });
  });

  it("refuses a blank or long title, a long note, an unlisted category or kind, and a date that is not one", () => {
    expect(parseAssignmentForm(form({ title: "   " })).errors.title).toBeTruthy();
    expect(parseAssignmentForm(form({ title: "x".repeat(201) })).errors.title).toBeTruthy();
    expect(parseAssignmentForm(form({ title: "A", instructions: "x".repeat(4001) })).errors.instructions).toBeTruthy();
    expect(parseAssignmentForm(form({ title: "A", category: "sports" })).errors.category).toBeTruthy();
    expect(parseAssignmentForm(form({ title: "A", kind: "in_progress" })).errors.kind).toBeTruthy();
    expect(parseAssignmentForm(form({ title: "A", dueOn: "2026-02-30" })).errors.dueOn).toBeTruthy();
    expect(parseAssignmentForm(form({ title: "A", dueOn: "soon" })).errors.dueOn).toBeTruthy();
  });

  it("reviews: a decision from the two, and a comment required on Needs Revision", () => {
    expect(parseReview("complete", null)).toMatchObject({ ok: true, decision: "complete", comment: null });
    expect(parseReview("complete", "  Nice work  ")).toMatchObject({ ok: true, comment: "Nice work" });
    expect(parseReview("needs_revision", "Add page two").ok).toBe(true);
    expect(parseReview("needs_revision", "   ").errors.comment).toBeTruthy();
    expect(parseReview("cancelled", "x").errors.form).toBeTruthy();
    expect(parseReview("in_progress", "x").ok).toBe(false);
    expect(parseReview("complete", "x".repeat(4001)).errors.comment).toBeTruthy();
  });

  it("trims a submission note, allows none, and refuses one over the limit", () => {
    expect(parseSubmissionNote("  hello ")).toMatchObject({ ok: true, note: "hello" });
    expect(parseSubmissionNote("   ")).toMatchObject({ ok: true, note: null });
    expect(parseSubmissionNote(null)).toMatchObject({ ok: true, note: null });
    expect(parseSubmissionNote("x".repeat(4001)).ok).toBe(false);
  });
});

describe("the loaders, against the fixture", () => {
  const client = () => createFakeClient(buildFixture(), { userId: OWNER_ID }) as never;

  it("loads one athlete's assignments, every status, newest first", async () => {
    const rows = await loadAthleteAssignments(client(), BRIDGE, IDS.athlete);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.status).sort()).toEqual(["assigned", "assigned", "cancelled", "complete", "needs_revision", "submitted"]);
    expect(rows[0].createdAt >= rows[rows.length - 1].createdAt).toBe(true);
    expect(rows.every((r) => r.athleteId === IDS.athlete && r.orgId === BRIDGE)).toBe(true);
  });

  it("carries none on the transfer athlete", async () => {
    expect(await loadAthleteAssignments(client(), BRIDGE, IDS.athleteTransfer)).toEqual([]);
  });

  it("is empty for an athlete of another org or a removed athlete", async () => {
    expect(await loadAthleteAssignments(client(), BRIDGE, IDS.athleteElite)).toEqual([]);
    const data = buildFixture();
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-28T00:00:00.000Z";
    expect(await loadAthleteAssignments(createFakeClient(data, { userId: OWNER_ID }) as never, BRIDGE, IDS.athlete)).toEqual([]);
  });

  it("loads one assignment scoped to its org and athlete", async () => {
    const a = await loadAssignment(client(), BRIDGE, IDS.athlete, IDS.assignmentSubmitted);
    expect(a?.status).toBe("submitted");
    expect(a?.documentId).toBe(IDS.documentFiled);
    expect(a?.familyNote).toBe("Sent the June score report.");
    expect(await loadAssignment(client(), BRIDGE, IDS.athleteNoGpa, IDS.assignmentSubmitted)).toBeNull();
    expect(await loadAssignment(client(), BRIDGE, IDS.athlete, IDS.assignmentElite)).toBeNull();
    expect(await loadAssignment(client(), "00000000-0000-0000-0000-0000000000a2", IDS.athlete, IDS.assignmentSubmitted)).toBeNull();
  });

  it("loads the file an assignment was answered with, scoped to the athlete", async () => {
    const d = await loadAssignmentDocument(client(), BRIDGE, IDS.athlete, IDS.documentFiled);
    expect(d).toMatchObject({ id: IDS.documentFiled, fileName: "june-score-report.pdf", mediaType: "application/pdf" });
    expect(await loadAssignmentDocument(client(), BRIDGE, IDS.athleteNoGpa, IDS.documentFiled)).toBeNull();
    expect(await loadAssignmentDocument(client(), BRIDGE, IDS.athlete, null)).toBeNull();
  });

  it("loads the org's rows with athlete names, never another org's, never a removed athlete's", async () => {
    const all = await loadOrgAssignments(client(), BRIDGE);
    expect(all).toHaveLength(6);
    expect(all.every((r) => r.athleteName === "Fixture Athlete")).toBe(true);
    expect(all.some((r) => r.id === IDS.assignmentElite)).toBe(false);

    const open = await loadOrgAssignments(client(), BRIDGE, { openOnly: true });
    expect(open.map((r) => r.status).sort()).toEqual(["assigned", "assigned", "needs_revision", "submitted"]);

    const data = buildFixture();
    data.athletes.find((a) => a.id === IDS.athlete)!.deleted_at = "2026-09-28T00:00:00.000Z";
    expect(await loadOrgAssignments(createFakeClient(data, { userId: OWNER_ID }) as never, BRIDGE)).toEqual([]);
  });

  it("computes the fixture's overdue and due soon from the day, not from a column", async () => {
    const open = await loadOrgAssignments(client(), BRIDGE, { openOnly: true });
    const today = todayIso();
    const p = partitionOrgAssignments(open, today);
    expect(p.overdue.map((r) => r.id)).toEqual([IDS.assignmentOverdue]);
    expect(p.dueSoon.map((r) => r.id)).toEqual([IDS.assignmentDueSoon]);
    expect(p.submitted.map((r) => r.id)).toEqual([IDS.assignmentSubmitted]);
    // The same rows a year on: nothing was stored, so the overdue set grows.
    const later = partitionOrgAssignments(open, "2027-09-29");
    expect(later.overdue.map((r) => r.id).sort()).toEqual([IDS.assignmentDueSoon, IDS.assignmentOverdue, IDS.assignmentRevision].sort());
    expect(Object.keys(open[0])).not.toContain("overdue");
  });

  it("counts per athlete for My Athletes", async () => {
    const counts = await loadAssignmentCounts(client(), BRIDGE, todayIso());
    expect(countsFor(counts, IDS.athlete)).toEqual({ overdue: 1, toReview: 1, open: 3 });
    expect(countsFor(counts, IDS.athleteTransfer)).toEqual({ overdue: 0, toReview: 0, open: 0 });
  });
});
