// The suggestion loaders and the notes module, run on the fixture.

import { describe, expect, it } from "vitest";
import { buildFixture, IDS, OWNER_ID } from "@/testing/fixture";
import { createFakeClient, type RecordedWrite } from "@/testing/fakeSupabase";
import { loadCoachOptions, loadCollegeOptions, loadHighSchoolOptions, loadPastSourceDetails, matchCoach, resolveCollege, resolveHighSchool } from "@/lib/data/lookups";
import { addAthleteNote, deleteAthleteNote, loadAthleteNotes } from "@/lib/data/athleteNotes";

function setup() {
  const data = buildFixture();
  const recorded: RecordedWrite[] = [];
  const client = createFakeClient(data, { userId: OWNER_ID, recorded }) as never;
  const bridge = data.orgs!.find((o) => o.slug === "bridge-fixture")!.id as string;
  const elite = data.orgs!.find((o) => o.slug === "elite-fixture")!.id as string;
  return { data, recorded, client, bridge, elite };
}

describe("high school suggestions", () => {
  it("lists the org's own names first, then the directory, each name once", async () => {
    const { client, bridge } = setup();
    const options = await loadHighSchoolOptions(client, bridge);
    const names = options.map((o) => o.value);
    // Both fixture schools are in the directory, so neither is repeated
    // from the org's own rows; the directory rows carry the place.
    expect(names).toEqual(["Fixture High School", "Unscaled High School"]);
    expect(options[0]).toMatchObject({ id: IDS.highSchool, state: "CT", label: "Fixture City, CT" });
    expect(options[1]).toMatchObject({ ceebCode: "123456" });
  });

  it("adds a name only this org has typed, and never another org's", async () => {
    const { data, client, bridge, elite } = setup();
    data.athlete_courses!.push({ id: "acx", org_id: elite, athlete_id: IDS.athleteElite, title: "Math", subject: "math", credit: 1, grade: "A", school_name: "Squad Only High" });
    data.org_grading_scales!.push({ id: "gsx", org_id: bridge, school_name: "Bridge Typed High", bands: [] });
    const bridgeNames = (await loadHighSchoolOptions(client, bridge)).map((o) => o.value);
    expect(bridgeNames).toContain("Bridge Typed High");
    expect(bridgeNames).not.toContain("Squad Only High");
    const eliteNames = (await loadHighSchoolOptions(client, elite)).map((o) => o.value);
    expect(eliteNames).toContain("Squad Only High");
    expect(eliteNames).not.toContain("Bridge Typed High");
  });

  it("resolves a typed name to one directory row, or to nothing when it is ambiguous", async () => {
    const { data, client } = setup();
    expect(await resolveHighSchool(client, "  fixture HIGH school ")).toEqual({ id: IDS.highSchool, state: "CT", ceeb_code: null });
    expect(await resolveHighSchool(client, "Nowhere High")).toBeNull();
    data.high_schools!.push({ id: "hs-dup", name: "Fixture High School", city: "Elsewhere", state: "NJ", name_key: "fixture high school" });
    expect(await resolveHighSchool(client, "Fixture High School")).toBeNull();
    expect((await resolveHighSchool(client, "Fixture High School", "NJ"))?.id).toBe("hs-dup");
  });
});

describe("college and coach suggestions", () => {
  it("lists every college and resolves a padded name to its row", async () => {
    const { client } = setup();
    const colleges = await loadCollegeOptions(client);
    expect(colleges.map((c) => c.value).sort()).toEqual(["Fixture College", "Fixture State University"]);
    const hit = await resolveCollege(client, " fixture state university ");
    expect(hit).toMatchObject({ id: IDS.school, division: "D2", state: "CT" });
    expect(await resolveCollege(client, "Fixture%")).toBeNull();
  });

  it("groups coaches by college and matches a typed name", async () => {
    const { client } = setup();
    const byCollege = await loadCoachOptions(client, [IDS.school, IDS.schoolD3]);
    expect(Object.keys(byCollege)).toEqual([IDS.school]);
    expect(byCollege[IDS.school].map((c) => c.value)).toEqual(["Fixture Assistant", "Fixture Head"]);
    expect(matchCoach(byCollege[IDS.school], " fixture assistant")?.email).toBe("assistant@fixture.example");
    expect(matchCoach(byCollege[IDS.school], "Nobody")).toBeNull();
    expect(await loadCoachOptions(client, [])).toEqual({});
  });

  it("lists this org's past metric sources, most used first", async () => {
    const { client, bridge, elite } = setup();
    expect(await loadPastSourceDetails(client, bridge)).toEqual(["practice", "Bridge Showcase", "PBR Connecticut"]);
    expect(await loadPastSourceDetails(client, elite)).toEqual([]);
  });
});

describe("staff notes", () => {
  it("adds a note signed by its author, and a blank one adds nothing", async () => {
    const { client, recorded, bridge } = setup();
    expect(await addAthleteNote(client, { orgId: bridge, athleteId: IDS.athlete, authorId: OWNER_ID, context: "enrolled", body: "  Starts in August.  " })).toBeNull();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ op: "insert", table: "athlete_notes", rows: [{ org_id: bridge, athlete_id: IDS.athlete, author_id: OWNER_ID, context: "enrolled", body: "Starts in August." }] });
    expect(await addAthleteNote(client, { orgId: bridge, athleteId: IDS.athlete, authorId: OWNER_ID, body: "   " })).toBeNull();
    expect(recorded).toHaveLength(1);
    expect(await addAthleteNote(client, { orgId: bridge, athleteId: IDS.athlete, authorId: OWNER_ID, body: "x".repeat(4001) })).toMatch(/4000/);
    expect(recorded).toHaveLength(1);
  });

  it("loads the latest notes on one athlete in one org, newest first, with the author's name", async () => {
    const { data, client, bridge, elite } = setup();
    // created_at is the database's default; the fake has no defaults, so
    // the newer row carries it by hand.
    data.athlete_notes!.push({ id: "an-new", org_id: bridge, athlete_id: IDS.athlete, author_id: null, context: "reopened", body: "Newer note.", created_at: "2026-09-26T09:00:00.000Z" });
    const notes = await loadAthleteNotes(client, bridge, IDS.athlete);
    expect(notes.map((n) => n.body)).toEqual(["Newer note.", "Fixture note."]);
    expect(notes[1]).toMatchObject({ context: "general", authorName: "Example Owner" });
    expect(await loadAthleteNotes(client, elite, IDS.athlete)).toEqual([]);
  });

  it("deletes a note only within its org and athlete", async () => {
    const { client, recorded, bridge } = setup();
    expect(await deleteAthleteNote(client, { orgId: bridge, athleteId: IDS.athlete, noteId: "an1" })).toBeNull();
    expect(recorded[0]).toMatchObject({ op: "delete", table: "athlete_notes" });
    expect(recorded[0].filters).toEqual([
      { column: "id", value: "an1" },
      { column: "org_id", value: bridge },
      { column: "athlete_id", value: IDS.athlete },
    ]);
  });
});
