// A parser for the two public federal school files the high school
// directory is seeded from, and nothing else. Pure: text in, rows out.
//
// The directory (migration 0040, high_schools) is filled ONLY from these
// public files, never from any org's own records (Dave, 2026-09-27: a
// new install has no pre-existing data in it). src/laws/autofillLaws.test.ts
// holds this file and scripts/load_high_schools.ts to that.
//
// The two files, both from the National Center for Education Statistics:
//
// - CCD, the Common Core of Data school directory (public schools):
//   https://nces.ed.gov/ccd/files.asp, file "ccd_sch_029_<yy><yy>_...csv".
//   One row per school. NCESSCH is the 12-digit school id, SCH_NAME the
//   name, LCITY / LSTATE the location, G_12_OFFERED "Yes" when the school
//   teaches grade 12 (GSHI, the highest grade, is the fallback), and
//   SY_STATUS_TEXT says whether it is open.
// - PSS, the Private School Universe Survey public-use file:
//   https://nces.ed.gov/surveys/pss/pssdata.asp, file "pss<yy><yy>_pu.csv".
//   PPIN is the school id, PINST the name, PCITY / PSTABB the location,
//   and HIGR<year> the highest grade taught, as a code: in the codebook
//   17 is grade 12 (1 ungraded, 2 prekindergarten, 3 kindergarten, 6
//   first grade, 16 eleventh). A plain "12" is read as grade 12 too.
//   The loader prints how many schools it kept per state so a codebook
//   change shows up as a count that is obviously wrong.

import { titleCase } from "@/lib/copy/titleCase";

export type NcesFormat = "ccd" | "pss";

export interface NcesSchool {
  ncesId: string;
  name: string;
  city: string | null;
  state: string;
}

export interface NcesParseResult {
  format: NcesFormat;
  schools: NcesSchool[];
  skipped: { noId: number; noName: number; otherState: number; notGrade12: number; closed: number };
}

// RFC 4180 CSV: quoted fields may hold commas, quotes ("" inside quotes)
// and line breaks. Both files are plain CSV; one of them has shipped
// with a byte order mark, which is stripped.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export function detectNcesFormat(header: readonly string[]): NcesFormat | null {
  const h = new Set(header.map((c) => c.trim().toUpperCase()));
  if (h.has("NCESSCH") && h.has("SCH_NAME")) return "ccd";
  if (h.has("PPIN") && h.has("PINST")) return "pss";
  return null;
}

// Both files write some names in capitals ("ST JOSEPH HIGH SCHOOL").
// Those are brought down to Title Case; a name already in mixed case is
// left exactly as the file has it.
export function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!/[A-Z]/.test(name) || name !== name.toUpperCase()) return name;
  return titleCase(name.toLowerCase());
}

function tidyCity(raw: string | undefined): string | null {
  const city = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!city) return null;
  return city === city.toUpperCase() ? titleCase(city.toLowerCase()) : city;
}

// PSS highest-grade code (or a plain grade number) to "teaches grade 12".
function pssHasGrade12(raw: string | undefined): boolean {
  const n = Number((raw ?? "").trim());
  return n === 17 || n === 12;
}

function ccdHasGrade12(g12: string | undefined, gshi: string | undefined): boolean {
  if (g12 !== undefined && g12.trim() !== "") return /^(yes|y|1)$/i.test(g12.trim());
  const hi = (gshi ?? "").trim();
  return hi === "12" || hi === "13";
}

const CCD_CLOSED = new Set(["closed", "inactive", "future"]);

export function parseNcesCsv(text: string, opts: { states: readonly string[] }): NcesParseResult {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((c) => c.trim().toUpperCase());
  const format = detectNcesFormat(header);
  if (!format) throw new Error("Not an NCES CCD school directory or PSS file: the header has neither NCESSCH/SCH_NAME nor PPIN/PINST.");

  const col = (name: string) => header.indexOf(name);
  const want = new Set(opts.states.map((s) => s.trim().toUpperCase()).filter(Boolean));
  const skipped = { noId: 0, noName: 0, otherState: 0, notGrade12: 0, closed: 0 };
  const schools: NcesSchool[] = [];
  const seen = new Set<string>();

  const pick = (row: string[], ...names: string[]): string | undefined => {
    for (const n of names) {
      const i = col(n);
      if (i >= 0 && (row[i] ?? "").trim() !== "") return row[i];
    }
    return undefined;
  };

  // PSS names its grade column by survey year (HIGR2022); take whichever
  // one the file has.
  const higr = header.find((c) => /^HIGR\d{4}$/.test(c)) ?? "HIGR";

  for (const row of rows.slice(1)) {
    const id = (format === "ccd" ? pick(row, "NCESSCH") : pick(row, "PPIN"))?.trim();
    if (!id) {
      skipped.noId++;
      continue;
    }
    const state = ((format === "ccd" ? pick(row, "LSTATE", "ST", "MSTATE") : pick(row, "PSTABB")) ?? "").trim().toUpperCase();
    if (want.size > 0 && !want.has(state)) {
      skipped.otherState++;
      continue;
    }
    if (!/^[A-Z]{2}$/.test(state)) {
      skipped.otherState++;
      continue;
    }
    const grade12 = format === "ccd" ? ccdHasGrade12(row[col("G_12_OFFERED")], pick(row, "GSHI")) : pssHasGrade12(pick(row, higr));
    if (!grade12) {
      skipped.notGrade12++;
      continue;
    }
    if (format === "ccd") {
      const status = (pick(row, "SY_STATUS_TEXT", "UPDATED_STATUS_TEXT") ?? "").trim().toLowerCase();
      if (CCD_CLOSED.has(status)) {
        skipped.closed++;
        continue;
      }
    }
    const rawName = format === "ccd" ? pick(row, "SCH_NAME") : pick(row, "PINST");
    const name = tidyName(rawName ?? "");
    if (!name) {
      skipped.noName++;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    schools.push({
      ncesId: id,
      name: name.slice(0, 200),
      city: tidyCity(format === "ccd" ? pick(row, "LCITY", "MCITY") : pick(row, "PCITY")),
      state,
    });
  }
  return { format, schools, skipped };
}
