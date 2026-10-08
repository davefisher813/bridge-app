// The activity log helper: templates that only ever see names, statuses,
// kinds and dates; a write that never throws; reads that come back
// newest first with the actor's name, and a search over both.

import { describe, expect, it, vi } from "vitest";
import { buildFixture, FAMILY_ID, IDS, MEMBER_ID, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type RecordedWrite } from "@/testing/fakeSupabase";
import {
  ACTIVITY_ACTIONS,
  SUBJECT_TYPE_OF,
  SUMMARY_MAX,
  activitySummary,
  loadAthleteActivity,
  loadOrgActivity,
  logActivity,
  searchActivity,
  type ActivityAction,
  type ActivitySubjects,
} from "./activity";

const BRIDGE = "00000000-0000-0000-0000-0000000000a1";

// One subject per action, the way a caller would fill it, so every
// template runs at least once below.
const SAMPLE: { [A in ActivityAction]: ActivitySubjects[A] } = {
  athlete_created: { name: "Fixture Athlete" },
  athlete_edited: { name: "Fixture Athlete" },
  athlete_status_changed: { name: "Fixture Athlete", from: "Active", to: "Committed" },
  athlete_removed: { name: "Fixture Athlete" },
  advisor_set: { name: "Fixture Athlete", advisor: "Example Owner" },
  advisor_cleared: { name: "Fixture Athlete" },
  target_added: { name: "Fixture Athlete", school: "Fixture State University" },
  target_status_changed: { name: "Fixture Athlete", school: "Fixture State University", from: "Target", to: "In Contact" },
  target_removed: { name: "Fixture Athlete", school: "Fixture State University" },
  assignment_created: { name: "Fixture Athlete", kind: "transcript" },
  assignment_submitted: { name: "Fixture Athlete", kind: "transcript" },
  assignment_reviewed: { name: "Fixture Athlete", kind: "transcript", to: "Accepted" },
  assignment_cancelled: { name: "Fixture Athlete", kind: "transcript" },
  document_uploaded: { name: "Fixture Athlete", kind: "transcript" },
  document_applied: { name: "Fixture Athlete", kind: "transcript" },
  document_discarded: { name: null, kind: "eligibility" },
  document_reading: { name: "Fixture Athlete", kind: "transcript" },
  document_needs_review: { name: null, kind: "document" },
  document_ready: { name: "Fixture Athlete", kind: "transcript" },
  document_archived: { name: null, kind: "document" },
  document_unarchived: { name: null, kind: "document" },
  checkin_logged: { name: "Fixture Athlete", kind: "call", date: "2026-09-21" },
  message_sent: { name: "Fixture Athlete" },
  member_invited: { name: "Example Member", role: "Viewer" },
  member_role_changed: { name: "Example Member", from: "Viewer", to: "Admin" },
  member_removed: { name: "Example Member" },
  view_as_started: { name: "Example Member", role: "Viewer" },
  view_as_ended: { name: "Example Member" },
};

describe("activitySummary builds one sentence per action", () => {
  it("has a template and a subject type for every action", () => {
    for (const action of ACTIVITY_ACTIONS) {
      const s = activitySummary(action, SAMPLE[action] as never);
      expect(s.length, action).toBeGreaterThan(0);
      expect(s.length, action).toBeLessThanOrEqual(SUMMARY_MAX);
      expect(s, action).not.toMatch(/\s{2,}|^\s|\s$/);
      expect(s, action).not.toContain(String.fromCharCode(0x2014));
      expect(SUBJECT_TYPE_OF[action]).toBeTruthy();
    }
  });

  it("reads the way the plan wrote it", () => {
    expect(activitySummary("athlete_status_changed", { name: "Fixture Athlete", to: "Committed" })).toBe("Moved Fixture Athlete to Committed");
    expect(activitySummary("athlete_status_changed", { name: "Fixture Athlete", from: "Active", to: "Committed" })).toBe("Moved Fixture Athlete from Active to Committed");
    expect(activitySummary("checkin_logged", { name: "Fixture Athlete", kind: "call", date: "2026-09-21" })).toBe("Logged a call check-in for Fixture Athlete on Sep 21, 2026");
    expect(activitySummary("checkin_logged", { name: "Fixture Athlete", kind: "call" })).toBe("Logged a call check-in for Fixture Athlete");
    expect(activitySummary("message_sent", {})).toBe("Sent a message");
    expect(activitySummary("message_sent", { name: "Fixture Athlete" })).toBe("Sent a message to the family of Fixture Athlete");
    expect(activitySummary("member_invited", { name: "Fixture Parent", role: "Athlete", athlete: "Fixture Athlete" })).toBe("Invited Fixture Parent as an Athlete for Fixture Athlete");
    expect(activitySummary("member_invited", { name: null, role: "Admin" })).toBe("Invited someone as an Admin");
    expect(activitySummary("document_uploaded", { kind: "transcript" })).toBe("Uploaded a transcript");
    expect(activitySummary("document_applied", { name: "Fixture Athlete", kind: "eligibility" })).toBe("Applied an eligibility to Fixture Athlete");
    expect(activitySummary("view_as_started", { name: "Example Member", role: "Viewer" })).toBe("Started viewing as Example Member, a Viewer");
  });

  it("clips long names and never passes the column's 200 characters", () => {
    const long = "A".repeat(400);
    const s = activitySummary("target_status_changed", { name: long, school: long, from: long, to: long });
    expect(s.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(s.startsWith("Moved AAAA")).toBe(true);
    expect(s).toContain("...");
    expect(activitySummary("athlete_created", { name: "   " })).toBe("Added an athlete");
    expect(activitySummary("athlete_created", { name: " Two   Spaces  " })).toBe("Added Two Spaces");
  });

  it("the fixture's rows are what the templates would have written", () => {
    const rows = buildFixture().activity_log;
    const byId = (id: string) => rows.find((r) => r.id === id)!.summary;
    expect(byId("al1")).toBe(activitySummary("athlete_created", { name: "Fixture Athlete" }));
    expect(byId("al2")).toBe(activitySummary("target_added", { name: "Fixture Athlete", school: "Fixture State University" }));
    expect(byId("al3")).toBe(activitySummary("target_status_changed", { name: "Fixture Athlete", school: "Fixture State University", from: "Target", to: "In Contact" }));
    expect(byId("al4")).toBe(activitySummary("checkin_logged", { name: "Fixture Athlete", kind: "call", date: "2026-09-21" }));
    expect(byId("al5")).toBe(activitySummary("message_sent", {}));
    expect(byId("al6")).toBe(activitySummary("advisor_set", { name: "Fixture Athlete", advisor: "Example Owner" }));
    expect(byId("al7")).toBe(activitySummary("member_invited", { name: "Example Member", role: "Viewer" }));
    expect(byId("al8")).toBe(activitySummary("athlete_created", { name: "Squad Athlete" }));
    for (const r of rows) expect(ACTIVITY_ACTIONS).toContain(r.action);
  });
});

describe("logActivity", () => {
  it("takes only a branded summary", () => {
    // The brand is the first lock: a plain string, a template or a
    // concatenation is not an ActivitySummary, so `npm run typecheck`
    // refuses the call. The lines below are checked by tsc, not run.
    const check = (_e: Parameters<typeof logActivity>[1]) => undefined;
    if (Math.random() > 2) {
      // @ts-expect-error a plain string is not an ActivitySummary
      check({ orgId: BRIDGE, actorId: OWNER_ID, action: "athlete_edited", subjectType: "athlete", summary: "Edited someone" });
      // @ts-expect-error a template string is not an ActivitySummary
      check({ orgId: BRIDGE, actorId: OWNER_ID, action: "athlete_edited", subjectType: "athlete", summary: `Edited ${BRIDGE}` });
      check({ orgId: BRIDGE, actorId: OWNER_ID, action: "athlete_edited", subjectType: "athlete", summary: activitySummary("athlete_edited", { name: "Fixture Athlete" }) });
    }
    expect(true).toBe(true);
  });

  it("writes one row with the org, the athlete, the actor and the sentence, and reports the id", async () => {
    const data = buildFixture();
    const recorded: RecordedWrite[] = [];
    const client = createFakeClient(data, { userId: OWNER_ID, recorded }) as never;
    const summary = activitySummary("athlete_edited", { name: "Fixture Athlete" });
    const result = await logActivity(client, { orgId: BRIDGE, actorId: OWNER_ID, athleteId: IDS.athlete, action: "athlete_edited", subjectType: "athlete", subjectId: IDS.athlete, summary });
    expect(result).toEqual({ ok: true, id: expect.any(String) });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ op: "insert", table: "activity_log" });
    expect(recorded[0].rows[0]).toEqual({
      org_id: BRIDGE,
      athlete_id: IDS.athlete,
      actor_id: OWNER_ID,
      action: "athlete_edited",
      subject_type: "athlete",
      subject_id: IDS.athlete,
      summary: "Edited Fixture Athlete",
    });
    // The database's clock, not the caller's.
    expect(recorded[0].rows[0]).not.toHaveProperty("created_at");
  });

  it("never throws: a failing insert is warned about and reported, not raised", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const data = buildFixture();
      const recorded: RecordedWrite[] = [];
      const failing = createFakeClient(data, { userId: OWNER_ID, recorded, failOn: (t, op) => (t === "activity_log" && op === "insert" ? "connection lost" : null) }) as never;
      const summary = activitySummary("athlete_removed", { name: "Fixture Athlete" });
      const result = await logActivity(failing, { orgId: BRIDGE, actorId: OWNER_ID, athleteId: IDS.athlete, action: "athlete_removed", subjectType: "athlete", summary });
      expect(result).toEqual({ ok: false, error: "connection lost" });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("athlete_removed was not recorded"));

      // A client that throws outright is caught too.
      const throwing = { from: () => { throw new Error("no client"); } } as unknown as Parameters<typeof logActivity>[0];
      const thrown = await logActivity(throwing, { orgId: BRIDGE, actorId: OWNER_ID, action: "member_removed", subjectType: "member", summary });
      expect(thrown).toEqual({ ok: false, error: "no client" });

      // A summary that somehow arrived blank is skipped rather than sent.
      const skipped = await logActivity(failing, { orgId: BRIDGE, actorId: OWNER_ID, action: "member_removed", subjectType: "member", summary: "  " as typeof summary });
      expect(skipped.ok).toBe(false);
      expect(recorded).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("reading the log", () => {
  it("one athlete's rows come back newest first with the actor's name, and none of another athlete's", async () => {
    const client = createFakeClient(buildFixture(), { userId: OWNER_ID }) as never;
    const rows = await loadAthleteActivity(client, BRIDGE, IDS.athlete);
    expect(rows.map((r) => r.id)).toEqual(["al5", "al4", "al3", "al2", "al6", "al1"]);
    expect(rows[0]).toMatchObject({ action: "message_sent", subjectType: "message", actorId: FAMILY_ID, actorName: "Fixture Parent", athleteId: IDS.athlete, summary: "Sent a message" });
    expect(rows[1].actorName).toBe("Example Owner");
    expect(rows.some((r) => r.id === "al7" || r.id === "al8")).toBe(false);
    expect(await loadAthleteActivity(client, BRIDGE, IDS.athleteTransfer)).toEqual([]);
    expect((await loadAthleteActivity(client, BRIDGE, IDS.athlete, 5)).map((r) => r.id)).toEqual(["al5", "al4", "al3", "al2", "al6"]);
  });

  it("the org's rows come back newest first, athlete and org events together, never another org's", async () => {
    const client = createFakeClient(buildFixture(), { userId: OWNER_ID }) as never;
    const all = await loadOrgActivity(client, BRIDGE);
    expect(all.rows.map((r) => r.id)).toEqual(["al5", "al4", "al3", "al2", "al6", "al1", "al7"]);
    expect(all).toMatchObject({ hasMore: false, total: 7 });
    expect(all.rows.some((r) => r.id === "al8")).toBe(false);

    const page = await loadOrgActivity(client, BRIDGE, { limit: 3 });
    expect(page.rows.map((r) => r.id)).toEqual(["al5", "al4", "al3"]);
    expect(page).toMatchObject({ hasMore: true, total: 7 });
    const next = await loadOrgActivity(client, BRIDGE, { limit: 3, offset: 6 });
    expect(next.rows.map((r) => r.id)).toEqual(["al7"]);
    expect(next.hasMore).toBe(false);
  });

  it("search matches the summary or the actor's name, ignoring case", async () => {
    const client = createFakeClient(buildFixture(), { userId: OWNER_ID }) as never;
    expect((await loadOrgActivity(client, BRIDGE, { q: "fixture state" })).rows.map((r) => r.id)).toEqual(["al3", "al2"]);
    expect((await loadOrgActivity(client, BRIDGE, { q: "Fixture Parent" })).rows.map((r) => r.id)).toEqual(["al5"]);
    expect((await loadOrgActivity(client, BRIDGE, { q: "viewer" })).rows.map((r) => r.id)).toEqual(["al7"]);
    expect((await loadOrgActivity(client, BRIDGE, { q: "nothing like this" })).rows).toEqual([]);
    const rows = (await loadOrgActivity(client, BRIDGE)).rows;
    expect(searchActivity(rows, "  ")).toBe(rows);
  });

  it("a departed actor reads as no name rather than a crash", async () => {
    const data = buildFixture();
    data.activity_log.push({ id: "al9", org_id: BRIDGE, athlete_id: IDS.athlete, actor_id: null, action: "athlete_edited", subject_type: "athlete", subject_id: IDS.athlete, summary: "Edited Fixture Athlete", created_at: "2026-09-27T12:00:00.000Z" });
    const rows = await loadAthleteActivity(createFakeClient(data, { userId: MEMBER_ID }) as never, BRIDGE, IDS.athlete, 1);
    expect(rows[0]).toMatchObject({ id: "al9", actorId: null, actorName: null });
  });
});

describe("the fake's log_family_message", () => {
  it("writes Sent a message as the linked family login and refuses everyone else", async () => {
    const data = buildFixture();
    const recorded: RecordedWrite[] = [];
    const family = createFakeClient(data, { userId: FAMILY_ID, recorded });
    // A line is written only for a message that exists and is not logged
    // yet: send one first, and a second call has nothing behind it.
    (data.athlete_messages ??= []).push({ id: "am-test", org_id: BRIDGE, athlete_id: IDS.athlete, author_id: FAMILY_ID, body: "Fixture message body", created_at: new Date().toISOString() });
    expect((await family.rpc("log_family_message", { p_athlete: IDS.athlete, body: "Fixture message body" })).error).toBeNull();
    expect((await family.rpc("log_family_message", { p_athlete: IDS.athlete })).error).toMatchObject({ code: "42501" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].rows[0]).toMatchObject({ org_id: BRIDGE, athlete_id: IDS.athlete, actor_id: FAMILY_ID, action: "message_sent", subject_type: "message", summary: "Sent a message" });
    expect(JSON.stringify(recorded)).not.toContain("Fixture message body");

    expect((await family.rpc("log_family_message", { p_athlete: IDS.athleteTransfer })).error).toMatchObject({ code: "42501" });
    expect((await createFakeClient(data, { userId: OWNER_ID, recorded }).rpc("log_family_message", { p_athlete: IDS.athlete })).error).toMatchObject({ code: "42501" });
    expect((await createFakeClient(data, { userId: null, recorded }).rpc("log_family_message", { p_athlete: IDS.athlete })).error).toMatchObject({ code: "42501" });
    expect(recorded).toHaveLength(1);
  });
});
