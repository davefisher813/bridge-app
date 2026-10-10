import { describe, expect, it } from "vitest";
import { MEETING_TITLE_MAX, parseMeetingForm, splitMeetings } from "./meeting";

const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.append(k, x);
  return fd;
};

describe("a board meeting's fields", () => {
  it("takes a title and a date, the rest optional, trimmed", () => {
    expect(parseMeetingForm(form({ title: "  October Board Meeting ", meetsOn: "2026-10-20" }))).toEqual({
      row: { title: "October Board Meeting", meets_on: "2026-10-20", board_id: null, location: null, notes: null },
    });
  });
  it("says what is missing or wrong, in a sentence", () => {
    const r = parseMeetingForm(form({ title: "", meetsOn: "2026-02-30", boardId: "x" }));
    expect(r).toEqual({ errors: { title: expect.stringMatching(/needs a title/), meetsOn: "That is not a date.", boardId: "Pick a board from the list." } });
    expect(parseMeetingForm(form({ title: "x".repeat(MEETING_TITLE_MAX + 1), meetsOn: "" }))).toEqual({ errors: { title: expect.any(String), meetsOn: "When is it?" } });
  });
  it("splits upcoming (today on, soonest first) from past (latest first)", () => {
    const rows = [{ meets_on: "2026-09-01" }, { meets_on: "2026-12-01" }, { meets_on: "2026-10-10" }, { meets_on: "2026-08-01" }];
    const { upcoming, past } = splitMeetings(rows, "2026-10-10");
    expect(upcoming.map((m) => m.meets_on)).toEqual(["2026-10-10", "2026-12-01"]);
    expect(past.map((m) => m.meets_on)).toEqual(["2026-09-01", "2026-08-01"]);
  });
});
