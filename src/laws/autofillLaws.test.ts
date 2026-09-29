// Stage 4: autofill, the high school directory, and staff notes.
//
// Dave, 2026-09-27: "more buttons, less typing", autofill everywhere it
// fits, and "if somebody used this as a new app, there shouldn't be
// pre-existing data in it." These laws hold the pieces that make that
// safe: one suggestion field in the kit, notes that never reach a
// family, a directory filled only from public files, detail keys that
// survive an edit, and one rule for matching a name.
//
// Each law was planted, watched to fail, and reverted; the plant is
// written above each one.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { athleteDetailSchema } from "@/lib/fit/schema";
import { parseAthleteForm } from "@/lib/validation/athlete";
import { escapeIlike, nameKey, pickUnique } from "@/lib/lookup/nameKey";
import { detectNcesFormat, parseCsv, parseNcesCsv, tidyName } from "@/lib/lookup/ncesParse";
import { positionsOf } from "@/lib/lookup/picklists";
import { US_STATES } from "@/lib/lookup/states";
import { createFakeClient } from "@/testing/fakeSupabase";

const { join } = posix;
const ROOT = process.cwd().replace(/\\/g, "/");
const SRC = join(ROOT, "src");
const MIGRATIONS = join(ROOT, "migrations");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(ROOT.length + 1);
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.includes("/testing/") || f.includes("/laws/");
const SOURCES = walk(SRC).filter((f) => /\.(tsx?)$/.test(f) && !isTest(f));

// ── L1 and L2: one suggestion field, in the kit ─────────────────────

describe("LAW: a suggestion list is the kit's SuggestField and nothing else", () => {
  // Verified this law bites: put the raw datalist back in
  // src/components/GovernanceForms.tsx, watched it fail naming the
  // file, reverted.
  it("no <datalist> outside the kit", () => {
    const offenders = SOURCES.filter((f) => !f.includes("/components/kit/") && /<datalist\b/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  // Verified this law bites: removed `list={listId}` from SuggestField,
  // watched both tests fail, reverted.
  it("SuggestField wires its input to its datalist and is the same 48px field as Field", () => {
    const kit = read(join(SRC, "components/kit/index.tsx"));
    const start = kit.indexOf("export function SuggestField");
    expect(start).toBeGreaterThan(-1);
    const body = kit.slice(start, kit.indexOf("\n}\n", start));
    expect(body).toMatch(/const listId = `\$\{fieldId\}-options`/);
    expect(body).toMatch(/<input\b[^>]*\blist=\{listId\}/);
    expect(body).toMatch(/<datalist id=\{listId\}>/);
    expect(body).toMatch(/\$\{FIELD_BASE\} min-h-12/);
    expect(body).toMatch(/autoComplete="off"/);
  });

  it("renders one option per name, by the database's key, and points the input at the list", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SuggestField } = await import("@/components/kit");
    const html = renderToStaticMarkup(
      createElement(SuggestField, {
        id: "hs-probe",
        name: "highSchool",
        label: "High School",
        suggestions: ["Fixture High School", " fixture high school ", { value: "Unscaled High School", label: "Fixture Town, NY" }, ""],
      }),
    );
    expect(html).toMatch(/<input[^>]*id="hs-probe"[^>]*list="hs-probe-options"/);
    expect(html).toMatch(/<datalist id="hs-probe-options">/);
    expect(html.match(/<option /g)?.length).toBe(2);
    expect(html).toMatch(/label="Fixture Town, NY"/);
  });

  it("caps a list at 2000 options", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SuggestField, SUGGESTION_CAP } = await import("@/components/kit");
    const many = Array.from({ length: SUGGESTION_CAP + 50 }, (_, i) => `School ${i}`);
    const html = renderToStaticMarkup(createElement(SuggestField, { name: "school", label: "School", suggestions: many }));
    expect(html.match(/<option /g)?.length).toBe(SUGGESTION_CAP);
  });
});

// ── L3 and L4: staff notes stay staff only ──────────────────────────

describe("LAW: staff notes never reach a family or a member", () => {
  // The athletes read policy admits a linked family login
  // (migrations/0023_athlete_guardians.sql), and row level security
  // hides rows, not columns. A notes column on athletes would be read
  // by the athlete's own family. So notes live in athlete_notes.
  //
  // Verified this law bites: added a scratch migration with
  // `alter table athletes add column staff_notes text;`, watched it
  // fail naming the file and the column, deleted it.
  it("no migration adds a note column to athletes", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = read(join(MIGRATIONS, f)).replace(/--.*$/gm, "");
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?athletes\s*\(([\s\S]*?)\n\);/gi)) {
        for (const line of m[1].split("\n")) {
          const col = line.trim().match(/^(\w+)\s+/);
          if (col && /note/i.test(col[1])) offenders.push(`${f}: athletes.${col[1]}`);
        }
      }
      for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?athletes\s+([\s\S]*?);/gi)) {
        for (const c of m[1].matchAll(/(?:add|rename)\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(?:\w+\s+to\s+)?(\w+)/gi)) {
          if (/note/i.test(c[1])) offenders.push(`${f}: athletes.${c[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Verified this law bites: added a scratch file under
  // src/app/org/[slug]/family/ calling `.from("athlete_notes")`, watched
  // it fail naming the file, deleted it.
  it("no family or member screen or loader reads athlete_notes, athlete_checkins or activity_log", () => {
    const scoped = SOURCES.filter((f) => /\/app\/org\/\[slug\]\/(family|member)\//.test(f) || /\/lib\/data\/(family|member)[^/]*\.ts$/.test(f));
    expect(scoped.length).toBeGreaterThan(3);
    const offenders = scoped.filter((f) => /athlete_notes|athleteNotes|athlete_checkins|activity_log/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

// ── L5: the directory is seeded from public files only ──────────────

describe("LAW: the high school directory is filled from public files, never from an org's records", () => {
  const LOADER = join(ROOT, "scripts/load_high_schools.ts");
  const PARSER = join(SRC, "lib/lookup/ncesParse.ts");

  // Verified this law bites: added `// reads athlete_courses` to
  // src/lib/lookup/ncesParse.ts, watched it fail, reverted.
  it("the loader and the parser never name an org table", () => {
    const offenders: string[] = [];
    for (const f of [LOADER, PARSER]) {
      const src = read(f);
      for (const word of ["athlete_courses", "org_grading_scales", "org_approved_course_lists", "athletes", "source_note"]) {
        if (new RegExp(`\\b${word}\\b`).test(src)) offenders.push(`${rel(f)}: ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the loader imports only the parser, the name key, the Supabase client and node", () => {
    const imports = [...read(LOADER).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["../src/lib/lookup/nameKey", "../src/lib/lookup/ncesParse", "@supabase/supabase-js", "node:fs", "node:path"]);
  });

  it("no migration writes a row into high_schools", () => {
    const offenders = readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith(".sql"))
      .filter((n) => /(insert\s+into|copy)\s+(?:public\.)?high_schools\b/i.test(read(join(MIGRATIONS, n)).replace(/--.*$/gm, "")));
    expect(offenders).toEqual([]);
  });
});

// ── L6: every athlete detail key survives an edit ───────────────────

describe("LAW: every athlete detail key survives the athlete form", () => {
  // Zod drops a key it does not know and parseAthleteForm rebuilds
  // detail key by key, so a key the schema has and the form parser
  // does not read is erased by every Edit save. A sample value for each
  // key lives here; a new key with no sample fails the first test, which
  // is the point: whoever adds it has to say how the form carries it.
  const SAMPLE: Record<string, string> = {
    gradYear: "2027",
    apCount: "2",
    ibCount: "1",
    honorsCount: "3",
    dualCount: "1",
    satTotal: "1210",
    actComposite: "27",
    desiredMajor: "Biology",
    highSchool: "Fixture High School",
    highSchoolId: "00000000-0000-4000-8000-000000000141",
    currentSchool: "Fixture State University",
    currentDivision: "D2",
    collegeGpa: "3.2",
    creditHoursCompleted: "45",
    eligibilityYearsRemaining: "2",
    portalEntryDate: "2026-05-01",
    transferCount: "1",
    degreeCompleted: "on",
    currentSchoolId: "00000000-0000-4000-8000-000000000d01",
  };
  const RECRUIT_TYPE: Record<string, string> = { hs: "hs", transfer: "transfer_grad" };

  const branches = athleteDetailSchema.options.map((o) => ({ kind: o.shape.kind.value as string, keys: Object.keys(o.shape).filter((k) => k !== "kind") }));

  it("found both branches, and every key has a sample", () => {
    expect(branches.map((b) => b.kind).sort()).toEqual(["hs", "transfer"]);
    const missing = branches.flatMap((b) => b.keys.filter((k) => !(k in SAMPLE)).map((k) => `${b.kind}.${k}`));
    expect(missing).toEqual([]);
  });

  // Verified this law bites: removed `highSchool` from the hs branch of
  // parseAthleteForm, watched it fail naming hs.highSchool, reverted.
  it.each(branches)("the $kind branch comes back with every key", ({ kind, keys }) => {
    const fd = new FormData();
    fd.set("name", "Law Probe");
    fd.set("sport", "Baseball");
    fd.set("recruitType", RECRUIT_TYPE[kind]);
    for (const k of keys) fd.set(k, SAMPLE[k]);
    const r = parseAthleteForm(fd);
    expect(r.errors).toEqual({});
    const detail = (r.detail ?? {}) as Record<string, unknown>;
    const lost = keys.filter((k) => detail[k] === undefined).map((k) => `${kind}.${k}`);
    expect(lost).toEqual([]);
  });
});

// ── L7: one rule for matching a name ────────────────────────────────

describe("LAW: a name matches the way the database matches it", () => {
  // The SQL side: high_schools.name_key and school_name_key are both
  // lower(btrim(name)). If either migration changes the rule, nameKey
  // has to change with it.
  it("the migrations key names by lower(btrim(name))", () => {
    const hs = read(join(MIGRATIONS, "0040_high_schools_and_notes.sql"));
    expect(hs).toMatch(/name_key\s+text generated always as \(lower\(btrim\(name\)\)\) stored/);
  });

  // Verified this law bites: dropped the .trim() from nameKey, watched
  // it fail on the padded names, reverted.
  it("nameKey is lower(btrim()) on padded, mixed-case names", () => {
    expect(nameKey("  Fixture HIGH School ")).toBe("fixture high school");
    expect(nameKey("St. Mary's")).toBe("st. mary's");
    expect(nameKey(null)).toBe("");
    expect(nameKey("   ")).toBe("");
  });

  // Verified this law bites: removed `\\` from the character class in
  // escapeIlike, watched the backslash case fail, reverted.
  it("escapeIlike makes %, _ and \\ literal, and the fake client honours it", async () => {
    expect(escapeIlike("100% Prep")).toBe("100\\% Prep");
    expect(escapeIlike("St_Mary")).toBe("St\\_Mary");
    expect(escapeIlike("A\\B")).toBe("A\\\\B");
    const client = createFakeClient(
      { schools: [{ id: "a", name: "100% Prep" }, { id: "b", name: "100 Percent Prep" }, { id: "c", name: "StXMary" }, { id: "d", name: "St_Mary" }] },
      { userId: null },
    );
    const pct = await client.from("schools").select("id").ilike("name", escapeIlike("100% prep"));
    expect((pct.data as { id: string }[]).map((r) => r.id)).toEqual(["a"]);
    const und = await client.from("schools").select("id").ilike("name", escapeIlike("st_mary"));
    expect((und.data as { id: string }[]).map((r) => r.id)).toEqual(["d"]);
  });

  // Verified this law bites: made pickUnique return the first match
  // when several share a name, watched it fail, reverted.
  it("pickUnique refuses an ambiguous name and lets the home state decide", () => {
    const rows = [
      { id: "1", name: "Central High School", state: "CT" },
      { id: "2", name: "central high school ", state: "NY" },
      { id: "3", name: "Lone High School", state: "NJ" },
    ];
    expect(pickUnique(rows, "Central High School")).toBeNull();
    expect(pickUnique(rows, " CENTRAL high school", "ny")?.id).toBe("2");
    expect(pickUnique(rows, "Central High School", "MA")).toBeNull();
    expect(pickUnique(rows, "lone high school")?.id).toBe("3");
    expect(pickUnique(rows, "Nowhere High")).toBeNull();
    expect(pickUnique([...rows, { id: "4", name: "Central High School", state: "CT" }], "Central High School", "CT")).toBeNull();
  });

  it("the state list is the fifty states and DC, and positions split by sport", () => {
    expect(US_STATES).toHaveLength(51);
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(51);
    expect(US_STATES.every((s) => /^[A-Z]{2}$/.test(s.code))).toBe(true);
    expect(positionsOf("Baseball")).toEqual(["RHP", "LHP", "C", "MIF", "1B", "3B", "OF"]);
    expect(positionsOf("curling")).toEqual([]);
  });
});

// ── L8: the NCES parser keeps grade-12 schools in the asked states ───

describe("LAW: the NCES parser keeps only grade-12 schools in the requested states", () => {
  // Headers as the NCES files publish them (CCD school directory,
  // ccd_sch_029; PSS public-use file), trimmed to the columns read plus
  // a few neighbours, in their published order.
  const CCD = [
    "SCHOOL_YEAR,FIPST,STATENAME,ST,SCH_NAME,LEA_NAME,NCESSCH,SCHID,LCITY,LSTATE,SY_STATUS_TEXT,G_11_OFFERED,G_12_OFFERED,GSLO,GSHI,LEVEL",
    '2023-2024,09,CONNECTICUT,CT,Fixture Public High School,Fixture District,090000100001,0100001,Hartford,CT,Open,Yes,Yes,09,12,High',
    '2023-2024,09,CONNECTICUT,CT,Fixture Middle School,Fixture District,090000100002,0100002,Hartford,CT,Open,No,No,06,08,Middle',
    '2023-2024,36,NEW YORK,NY,"Fixture Academy, Upper School",Fixture District,360000100003,0100003,Albany,NY,Open,Yes,Yes,09,12,High',
    '2023-2024,06,CALIFORNIA,CA,Fixture West High,Fixture District,060000100004,0100004,Fresno,CA,Open,Yes,Yes,09,12,High',
    '2023-2024,09,CONNECTICUT,CT,Fixture Closed High,Fixture District,090000100005,0100005,Hartford,CT,Closed,Yes,Yes,09,12,High',
    '2023-2024,09,CONNECTICUT,CT,Fixture No Id High,Fixture District,,0100006,Hartford,CT,Open,Yes,Yes,09,12,High',
  ].join("\r\n");
  const PSS = [
    "﻿PPIN,PINST,PADDRS,PCITY,PSTABB,PZIP,LOGR2022,HIGR2022,LEVEL",
    "A0000001,FIXTURE PREP SCHOOL,1 Main St,NEW HAVEN,CT,06510,11,17,2",
    "A0000002,Fixture Elementary,2 Main St,New Haven,CT,06510,2,11,1",
    "A0000003,FIXTURE CATHOLIC HIGH,3 Main St,NEWARK,NJ,07102,13,17,2",
    ",FIXTURE NO ID ACADEMY,4 Main St,NEWARK,NJ,07102,13,17,2",
  ].join("\n");

  it("reads the formats from their headers and nothing else", () => {
    expect(detectNcesFormat(parseCsv(CCD)[0])).toBe("ccd");
    expect(detectNcesFormat(parseCsv(PSS)[0])).toBe("pss");
    expect(detectNcesFormat(["name", "division", "state"])).toBeNull();
    expect(() => parseNcesCsv("name,division\nX,D1\n", { states: ["CT"] })).toThrow();
  });

  // Verified this law bites: made the CCD grade check always true,
  // watched the middle school come through, reverted.
  it("keeps open grade-12 public schools in the requested states, with an id", () => {
    const r = parseNcesCsv(CCD, { states: ["CT", "NY", "NJ"] });
    expect(r.format).toBe("ccd");
    expect(r.schools).toEqual([
      { ncesId: "090000100001", name: "Fixture Public High School", city: "Hartford", state: "CT" },
      { ncesId: "360000100003", name: "Fixture Academy, Upper School", city: "Albany", state: "NY" },
    ]);
    expect(r.skipped).toMatchObject({ noId: 1, otherState: 1, notGrade12: 1, closed: 1 });
  });

  it("keeps grade-12 private schools in the requested states, in Title Case", () => {
    const r = parseNcesCsv(PSS, { states: ["ct", "NJ"] });
    expect(r.format).toBe("pss");
    expect(r.schools).toEqual([
      { ncesId: "A0000001", name: "Fixture Prep School", city: "New Haven", state: "CT" },
      { ncesId: "A0000003", name: "Fixture Catholic High", city: "Newark", state: "NJ" },
    ]);
    expect(r.skipped).toMatchObject({ noId: 1, notGrade12: 1 });
  });

  it("leaves a mixed-case name exactly as the file has it", () => {
    expect(tidyName("  McKinley  High School ")).toBe("McKinley High School");
    expect(tidyName("ST JOSEPH HIGH SCHOOL")).toBe("St Joseph High School");
  });
});
