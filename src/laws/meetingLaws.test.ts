// Board meetings and their materials (migration 0050). Admins only, where
// the governance module is on; a meeting's board and documents are this
// org's; materials are links to vault documents, so removing a meeting
// or a link never touches a document. Planted: dropped the org filter on
// the document lookup in attachMeetingDocument: "another org's document"
// failed. Planted: removed the governance gate: the Elite case failed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFixture, IDS, ORG_WITH_MODULES, ORG_WITHOUT_MODULES, OWNER_ID, MEMBER_ID, FAMILY_ID } from "@/testing/fixture";
import { createFakeClient, type Dataset, type RecordedWrite } from "@/testing/fakeSupabase";

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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createFakeClient(data, { userId: currentUser, recorded: writes }) }));

beforeEach(() => {
  currentUser = OWNER_ID;
  writes = [];
  data = buildFixture();
});

const BRIDGE = () => data.orgs[0]!.id as string;
const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.append(k, x);
  return fd;
};
async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith("NEXT_REDIRECT:")) return decodeURIComponent(m.slice("NEXT_REDIRECT:".length));
    throw e;
  }
  return "";
}
const meetings = () => data.board_meetings!;
const links = () => data.board_meeting_documents!;

describe("LAW: an Admin keeps meetings and their materials, in their own org", () => {
  it("adds a meeting with a board, and lands on it", async () => {
    const { createMeeting } = await import("@/lib/actions/meetings");
    const to = await redirectOf(createMeeting(ORG_WITH_MODULES, { errors: {} }, form({ title: "Winter Meeting", meetsOn: "2026-12-05", boardId: IDS.board, location: "Room 2" })));
    const row = meetings().find((m) => m.title === "Winter Meeting")!;
    expect(row).toMatchObject({ org_id: BRIDGE(), board_id: IDS.board, meets_on: "2026-12-05", location: "Room 2", created_by: OWNER_ID });
    expect(to).toBe(`/org/${ORG_WITH_MODULES}/board-governance/meetings/${row.id}`);
  });

  it("says what is wrong, and writes nothing", async () => {
    const { createMeeting } = await import("@/lib/actions/meetings");
    const r = await createMeeting(ORG_WITH_MODULES, { errors: {} }, form({ title: "", meetsOn: "2026-13-01" }));
    expect(r.errors).toMatchObject({ title: expect.any(String), meetsOn: "That is not a date." });
    const other = await createMeeting(ORG_WITH_MODULES, { errors: {} }, form({ title: "X", meetsOn: "2026-12-01", boardId: "00000000-0000-0000-0000-00000000dead" }));
    expect(other.errors.boardId).toMatch(/Pick a board/);
    expect(writes.filter((w) => w.table === "board_meetings")).toEqual([]);
  });

  it("edits a meeting of this org only", async () => {
    const { updateMeeting } = await import("@/lib/actions/meetings");
    await redirectOf(updateMeeting(ORG_WITH_MODULES, IDS.meetingPast, { errors: {} }, form({ title: "Summer Planning Meeting", meetsOn: "2026-07-16" })));
    expect(meetings().find((m) => m.id === IDS.meetingPast)!.meets_on).toBe("2026-07-16");
    const r = await updateMeeting(ORG_WITH_MODULES, "00000000-0000-0000-0000-00000000dead", { errors: {} }, form({ title: "Ghost", meetsOn: "2026-07-16" }));
    expect(r.errors.form).toMatch(/not in this organization/);
  });

  it("adds a document of this org once, refuses another org's, and taking it off keeps the document", async () => {
    const { attachMeetingDocument, detachMeetingDocument } = await import("@/lib/actions/meetings");
    expect(await redirectOf(attachMeetingDocument(ORG_WITH_MODULES, IDS.meetingPast, form({ documentId: IDS.document })))).toMatch(/notice=Added to the meeting/);
    expect(links().filter((l) => l.meeting_id === IDS.meetingPast)).toHaveLength(1);
    expect(await redirectOf(attachMeetingDocument(ORG_WITH_MODULES, IDS.meetingPast, form({ documentId: IDS.document })))).toMatch(/already on this meeting/);
    expect(links().filter((l) => l.meeting_id === IDS.meetingPast)).toHaveLength(1);

    const elite = data.orgs[1]!.id as string;
    data.documents!.push({ id: "00000000-0000-0000-0000-0000000e1d0c", org_id: elite, file_name: "theirs.pdf", lifecycle: "needs_review", status: "pending" });
    expect(await redirectOf(attachMeetingDocument(ORG_WITH_MODULES, IDS.meetingPast, form({ documentId: "00000000-0000-0000-0000-0000000e1d0c" })))).toMatch(/not in this organization/);

    await redirectOf(detachMeetingDocument(ORG_WITH_MODULES, IDS.meetingPast, IDS.document));
    expect(links().filter((l) => l.meeting_id === IDS.meetingPast)).toHaveLength(0);
    expect(data.documents!.some((d) => d.id === IDS.document)).toBe(true);
  });

  it("removing a meeting keeps every document that was on it", async () => {
    const { removeMeeting } = await import("@/lib/actions/meetings");
    const docIds = links().filter((l) => l.meeting_id === IDS.meetingUpcoming).map((l) => l.document_id);
    expect(docIds.length).toBe(2);
    expect(await redirectOf(removeMeeting(ORG_WITH_MODULES, IDS.meetingUpcoming))).toMatch(/Its documents are still in Documents/);
    expect(meetings().some((m) => m.id === IDS.meetingUpcoming)).toBe(false);
    for (const id of docIds) expect(data.documents!.some((d) => d.id === id)).toBe(true);
    expect(writes.filter((w) => w.table === "documents" || w.table.startsWith("storage:"))).toEqual([]);
  });

  it("a Viewer, a family login, nobody signed in, and an org without the module are refused before anything is written", async () => {
    const { createMeeting, attachMeetingDocument, removeMeeting } = await import("@/lib/actions/meetings");
    for (const who of [MEMBER_ID, FAMILY_ID, null]) {
      currentUser = who;
      await expect(createMeeting(ORG_WITH_MODULES, { errors: {} }, form({ title: "X", meetsOn: "2026-12-01" }))).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      await expect(attachMeetingDocument(ORG_WITH_MODULES, IDS.meetingPast, form({ documentId: IDS.document }))).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
      await expect(removeMeeting(ORG_WITH_MODULES, IDS.meetingPast)).rejects.toThrow(/NEXT_REDIRECT|NEXT_NOT_FOUND/);
    }
    currentUser = OWNER_ID;
    expect(await redirectOf(createMeeting(ORG_WITHOUT_MODULES, { errors: {} }, form({ title: "X", meetsOn: "2026-12-01" })))).toBe("/unauthorized");
    expect(writes).toEqual([]);
  });
});
