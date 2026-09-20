import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHOOL_CSV_COLUMNS, SCHOOL_CSV_REQUIRED_COLUMNS, parseSchoolsCsv } from "./csv";

const TEMPLATE_PATH = join(process.cwd(), "public", "templates", "schools.csv");
const template = () => readFileSync(TEMPLATE_PATH, "utf8");

const HEADER = SCHOOL_CSV_COLUMNS.join(",");

// A complete, valid D2 row keyed by column so a test can blank or change one cell.
const D2: Record<(typeof SCHOOL_CSV_COLUMNS)[number], string> = {
  name: "Granite State University",
  division: "D2",
  program_tier: "d2_naia",
  conference: "Northeast-10 Conference",
  state: "NH",
  sports_sponsored: "baseball;softball",
  gpa_min: "2.5",
  gpa_avg: "3.2",
  sat_range: "1050-1250",
  act_range: "21-26",
  athletic_scholarship: "partial",
  avg_athletic_aid: "8500",
  avg_merit_aid: "6000",
  avg_need_aid: "11000",
  cost_in_state: "32000",
  cost_out_of_state: "32000",
  roster_spots_open: "4",
  playing_time_outlook: "competitive",
  majors: "Business Administration;Nursing",
  head_coach: "Mike Torres",
  coach_email: "mtorres@example.edu",
  positions_of_need: "SS 2027;C",
  notes: "",
};

function row(overrides: Partial<typeof D2> = {}): string {
  const r = { ...D2, ...overrides };
  return SCHOOL_CSV_COLUMNS.map((c) => r[c]).join(",");
}

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\n") + "\n";
}

describe("parseSchoolsCsv: the template", () => {
  it("parses public/templates/schools.csv with zero problems and two rows", () => {
    const { rows, problems } = parseSchoolsCsv(template());
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.school.division)).toEqual(["D2", "D3"]);
    expect(rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it("template header matches SCHOOL_CSV_COLUMNS exactly", () => {
    const firstLine = template().split(/\r?\n/)[0];
    expect(firstLine).toBe(HEADER);
  });

  it("maps every cell of the D2 example onto the school and overlay shapes", () => {
    const { rows } = parseSchoolsCsv(template());
    const d2 = rows[0];
    expect(d2.school.name).toBe("Granite State University");
    expect(d2.school.program_tier).toBe("d2_naia");
    expect(d2.school.state).toBe("NH");
    expect(d2.school.sports_sponsored).toEqual(["baseball", "softball", "soccer"]);
    expect(d2.school.academics).toEqual({ gpaMin: 2.5, gpaAvg: 3.2, satRange: "1050-1250", actRange: "21-26" });
    expect(d2.school.financials).toEqual({
      athleticScholarship: "partial",
      avgAthleticAid: 8500,
      avgMeritAid: 6000,
      avgNeedAid: 11000,
      instateTotal: 32000,
      outstateTotal: 32000,
      rosterSpotsOpen: 4,
    });
    expect(d2.school.athletics).toEqual({ playingTimeOutlook: "competitive" });
    expect(d2.school.majors).toContain("Sport Management");
    expect(d2.overlay.coach_name).toBe("Mike Torres");
    expect(d2.overlay.coach_email).toBe("mtorres@example.edu");
    expect(d2.overlay.positions_of_need).toEqual([
      { position: "SS", gradYear: 2027 },
      { position: "RHP", gradYear: 2027 },
      { position: "C" },
    ]);
    expect(d2.overlay.notes).toContain("Coach visited the Bridge showcase in June,");
  });

  it("D3 example has program_tier null and notes kept", () => {
    const { rows } = parseSchoolsCsv(template());
    const d3 = rows[1];
    expect(d3.school.program_tier).toBeNull();
    expect(d3.school.financials.athleticScholarship).toBe("none");
    expect(d3.school.financials.avgMeritAid).toBe(14000);
    expect(d3.school.financials.avgNeedAid).toBe(38000);
    expect(d3.overlay.notes).toMatch(/^Needs a strong transcript/);
  });
});

describe("parseSchoolsCsv: CSV mechanics", () => {
  it("handles quoted fields with embedded commas, quotes and newlines", () => {
    const text = csv(
      row({
        conference: '"Northeast-10, East"',
        notes: '"Coach said ""bring video""\nthen visit"',
      }),
    );
    const { rows, problems } = parseSchoolsCsv(text);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].school.conference).toBe("Northeast-10, East");
    expect(rows[0].overlay.notes).toBe('Coach said "bring video"\nthen visit');
  });

  it("a multi-line quoted cell does not shift the line numbers of later rows", () => {
    const text = csv(row({ notes: '"line one\nline two"' }), row({ name: "Second School" }));
    const { rows, problems } = parseSchoolsCsv(text);
    expect(problems).toEqual([]);
    expect(rows.map((r) => r.line)).toEqual([2, 4]);
  });

  it("accepts CRLF line endings", () => {
    const text = [HEADER, row(), row({ name: "Other College" })].join("\r\n") + "\r\n";
    const { rows, problems } = parseSchoolsCsv(text);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[1].line).toBe(3);
  });

  it("accepts a UTF-8 BOM before the header", () => {
    const { rows, problems } = parseSchoolsCsv("﻿" + csv(row()));
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("skips blank lines and keeps real line numbers", () => {
    const text = [HEADER, "", row(), "   ", ",,,,,,,,,,,,,,,,,,,,,,", row({ name: "Other College" })].join("\n");
    const { rows, problems } = parseSchoolsCsv(text);
    expect(problems).toEqual([]);
    expect(rows.map((r) => r.line)).toEqual([3, 6]);
  });

  it("matches the header case-insensitively and trims whitespace", () => {
    const header = SCHOOL_CSV_COLUMNS.map((c) => ` ${c.toUpperCase()} `).join(",");
    const { rows, problems } = parseSchoolsCsv([header, row()].join("\n"));
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("ignores extra columns", () => {
    const text = ["internal_id," + HEADER + ",extra", "abc," + row() + ",whatever"].join("\n");
    const { rows, problems } = parseSchoolsCsv(text);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].school.name).toBe("Granite State University");
  });

  it("reports a missing required header column once, on line 1, and returns no rows", () => {
    const cols = SCHOOL_CSV_COLUMNS.filter((c) => c !== "gpa_min");
    const text = [cols.join(","), cols.map((c) => D2[c]).join(","), cols.map((c) => D2[c]).join(",")].join("\n");
    const { rows, problems } = parseSchoolsCsv(text);
    expect(rows).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 1, column: "gpa_min" });
    expect(problems[0].message).toContain("gpa_min");
  });

  it("an empty file is one problem on line 1, not a throw", () => {
    expect(() => parseSchoolsCsv("")).not.toThrow();
    const { rows, problems } = parseSchoolsCsv("");
    expect(rows).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(1);
  });

  it("strips dollar signs and thousands separators from money", () => {
    const text = csv(row({ avg_athletic_aid: '"$8,500"', cost_in_state: '"$32,000.00"' }));
    const { rows, problems } = parseSchoolsCsv(text);
    expect(problems).toEqual([]);
    expect(rows[0].school.financials.avgAthleticAid).toBe(8500);
    expect(rows[0].school.financials.instateTotal).toBe(32000);
  });
});

describe("parseSchoolsCsv: required fields", () => {
  for (const col of SCHOOL_CSV_REQUIRED_COLUMNS) {
    it(`reports a blank ${col} as a problem on that row and drops the row`, () => {
      const { rows, problems } = parseSchoolsCsv(csv(row({ [col]: "" })));
      expect(rows).toEqual([]);
      const hit = problems.find((p) => p.column === col);
      expect(hit).toBeDefined();
      expect(hit!.line).toBe(2);
      expect(hit!.message).toBe(`${col} is required.`);
    });
  }

  it("optional columns may be blank", () => {
    const text = csv(row({ program_tier: "", act_range: "", avg_merit_aid: "", avg_need_aid: "", roster_spots_open: "", playing_time_outlook: "", positions_of_need: "", notes: "" }));
    const { rows, problems } = parseSchoolsCsv(text);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    const s = rows[0].school;
    expect(s.program_tier).toBeNull();
    expect(s.academics.actRange).toBeUndefined();
    expect(s.financials.avgMeritAid).toBeUndefined();
    expect(s.financials.avgNeedAid).toBeUndefined();
    expect(s.financials.rosterSpotsOpen).toBeUndefined();
    expect(s.athletics.playingTimeOutlook).toBeUndefined();
    expect(rows[0].overlay.positions_of_need).toEqual([]);
    expect(rows[0].overlay.notes).toBeNull();
  });

  it("a row with one problem is left out of rows while the good row stays", () => {
    const { rows, problems } = parseSchoolsCsv(csv(row({ gpa_min: "" }), row({ name: "Other College" })));
    expect(rows.map((r) => r.school.name)).toEqual(["Other College"]);
    expect(problems).toHaveLength(1);
  });
});

describe("parseSchoolsCsv: values", () => {
  it("gpa must be a number between 0 and 4", () => {
    for (const bad of ["abc", "4.5", "-1"]) {
      const { rows, problems } = parseSchoolsCsv(csv(row({ gpa_min: bad })));
      expect(rows).toEqual([]);
      expect(problems).toEqual([{ line: 2, column: "gpa_min", message: "gpa_min must be a number between 0 and 4." }]);
    }
    const avg = parseSchoolsCsv(csv(row({ gpa_avg: "five" })));
    expect(avg.problems[0].message).toBe("gpa_avg must be a number between 0 and 4.");
  });

  it("money must parse as a non-negative dollar amount", () => {
    const { problems } = parseSchoolsCsv(csv(row({ cost_out_of_state: "a lot" })));
    expect(problems).toEqual([{ line: 2, column: "cost_out_of_state", message: "cost_out_of_state must be a dollar amount, like 42000." }]);
  });

  it("accepts division case and whitespace variants", () => {
    for (const [raw, want] of [
      ["d2", "D2"],
      [" D3 ", "D3"],
      ["juco  d1", "JUCO D1"],
      ["prep school", "Prep School"],
      ["naia", "NAIA"],
    ] as const) {
      const { rows, problems } = parseSchoolsCsv(csv(row({ division: raw, athletic_scholarship: "none", avg_merit_aid: "1", avg_need_aid: "1" })));
      expect(problems).toEqual([]);
      expect(rows[0].school.division).toBe(want);
    }
  });

  it("reports an unknown division with the allowed list", () => {
    const { rows, problems } = parseSchoolsCsv(csv(row({ division: "Division IV" })));
    expect(rows).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 2, column: "division" });
    expect(problems[0].message).toContain("D1, D2, D3, NAIA, JUCO D1, JUCO D2, JUCO D3, Prep School");
  });

  it("reports an unknown program_tier, scholarship type and outlook", () => {
    const tier = parseSchoolsCsv(csv(row({ program_tier: "power5" })));
    expect(tier.problems[0]).toMatchObject({ column: "program_tier" });
    expect(tier.problems[0].message).toContain("elite_d1, mid_d1, low_d1, d2_naia, juco");

    const sch = parseSchoolsCsv(csv(row({ athletic_scholarship: "some" })));
    expect(sch.problems[0]).toMatchObject({ column: "athletic_scholarship" });
    expect(sch.problems[0].message).toContain("full, partial, none");

    const out = parseSchoolsCsv(csv(row({ playing_time_outlook: "easy" })));
    expect(out.problems[0]).toMatchObject({ column: "playing_time_outlook" });
    expect(out.problems[0].message).toContain("realistic, competitive, difficult");
  });

  it("coach_email must look like an email", () => {
    const { problems } = parseSchoolsCsv(csv(row({ coach_email: "not an email" })));
    expect(problems).toEqual([{ line: 2, column: "coach_email", message: "coach_email must be an email address, like coach@school.edu." }]);
  });

  it("roster_spots_open must be a whole number", () => {
    const { problems } = parseSchoolsCsv(csv(row({ roster_spots_open: "2.5" })));
    expect(problems[0]).toMatchObject({ column: "roster_spots_open" });
  });

  it("positions_of_need reads SS 2027 and C, and rejects entries it cannot read", () => {
    const ok = parseSchoolsCsv(csv(row({ positions_of_need: "SS 2027; C ;RHP 2028" })));
    expect(ok.problems).toEqual([]);
    expect(ok.rows[0].overlay.positions_of_need).toEqual([
      { position: "SS", gradYear: 2027 },
      { position: "C" },
      { position: "RHP", gradYear: 2028 },
    ]);
    const bad = parseSchoolsCsv(csv(row({ positions_of_need: "SS next year" })));
    expect(bad.rows).toEqual([]);
    expect(bad.problems[0]).toMatchObject({ line: 2, column: "positions_of_need" });
  });
});

describe("parseSchoolsCsv: D3 rules", () => {
  const d3 = (overrides: Partial<typeof D2> = {}) => row({ name: "Whitfield College", division: "D3", athletic_scholarship: "none", avg_athletic_aid: "0", avg_merit_aid: "14000", avg_need_aid: "38000", ...overrides });

  it("a valid D3 row parses", () => {
    const { rows, problems } = parseSchoolsCsv(csv(d3()));
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("avg_merit_aid and avg_need_aid are required for D3", () => {
    const merit = parseSchoolsCsv(csv(d3({ avg_merit_aid: "" })));
    expect(merit.rows).toEqual([]);
    expect(merit.problems).toEqual([{ line: 2, column: "avg_merit_aid", message: "avg_merit_aid is required for a D3 school." }]);

    const need = parseSchoolsCsv(csv(d3({ avg_need_aid: "" })));
    expect(need.problems).toEqual([{ line: 2, column: "avg_need_aid", message: "avg_need_aid is required for a D3 school." }]);
  });

  it("a D3 row with any athletic scholarship claim is a problem", () => {
    for (const claim of ["full", "partial", "Partial"]) {
      const { rows, problems } = parseSchoolsCsv(csv(d3({ athletic_scholarship: claim })));
      expect(rows).toEqual([]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ line: 2, column: "athletic_scholarship" });
      expect(problems[0].message).toContain("must be none for a D3 school");
    }
  });

  it("merit and need aid stay optional and scholarships stay allowed outside D3", () => {
    const { rows, problems } = parseSchoolsCsv(csv(row({ avg_merit_aid: "", avg_need_aid: "", athletic_scholarship: "full" })));
    expect(problems).toEqual([]);
    expect(rows[0].school.financials.athleticScholarship).toBe("full");
  });
});

describe("parseSchoolsCsv: duplicates", () => {
  it("the same name twice, case-insensitively, is a problem on the second row", () => {
    const { rows, problems } = parseSchoolsCsv(csv(row(), row({ name: "granite state UNIVERSITY" })));
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBe(2);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ line: 3, column: "name" });
    expect(problems[0].message).toContain("line 2");
  });

  it("a duplicate of a row that itself had problems is still reported", () => {
    const { rows, problems } = parseSchoolsCsv(csv(row({ gpa_min: "" }), row()));
    expect(rows).toEqual([]);
    expect(problems.map((p) => [p.line, p.column])).toEqual([
      [2, "gpa_min"],
      [3, "name"],
    ]);
  });
});
