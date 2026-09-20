// School CSV import parser. Pure TypeScript over a string: no Next, no
// Supabase, no DOM, so it runs in a test, in the bench, or on the server
// unchanged. The caller decides what to do with the rows (typically:
// import nothing if problems.length > 0, per MATCHING_CONTRACT.md section 4,
// "rows with problems are listed; nothing half-imports").
//
// The template at public/templates/schools.csv is the contract for the
// header. Lists (sports_sponsored, majors, positions_of_need) are
// semicolon separated inside one cell so a Google Sheets export never
// needs quoting for them.

import { SCHOOL_DIVISIONS } from "../validation/school";

export type SchoolDivision = (typeof SCHOOL_DIVISIONS)[number];

export const SCHOOL_CSV_COLUMNS = [
  "name",
  "division",
  "program_tier",
  "conference",
  "state",
  "sports_sponsored",
  "gpa_min",
  "gpa_avg",
  "sat_range",
  "act_range",
  "athletic_scholarship",
  "avg_athletic_aid",
  "avg_merit_aid",
  "avg_need_aid",
  "cost_in_state",
  "cost_out_of_state",
  "roster_spots_open",
  "playing_time_outlook",
  "majors",
  "head_coach",
  "coach_email",
  "positions_of_need",
  "notes",
] as const;

export type SchoolCsvColumn = (typeof SCHOOL_CSV_COLUMNS)[number];

// Required in the header and on every row. avg_merit_aid and avg_need_aid
// are required only when the row is D3, so they are checked per row.
export const SCHOOL_CSV_REQUIRED_COLUMNS: readonly SchoolCsvColumn[] = [
  "name",
  "division",
  "conference",
  "state",
  "sports_sponsored",
  "gpa_min",
  "gpa_avg",
  "sat_range",
  "athletic_scholarship",
  "avg_athletic_aid",
  "cost_in_state",
  "cost_out_of_state",
  "majors",
  "head_coach",
  "coach_email",
];

export const PROGRAM_TIERS = ["elite_d1", "mid_d1", "low_d1", "d2_naia", "juco"] as const;
export type ProgramTier = (typeof PROGRAM_TIERS)[number];

export const ATHLETIC_SCHOLARSHIP_TYPES = ["full", "partial", "none"] as const;
export type AthleticScholarship = (typeof ATHLETIC_SCHOLARSHIP_TYPES)[number];

export const PLAYING_TIME_OUTLOOKS = ["realistic", "competitive", "difficult"] as const;
export type PlayingTimeOutlook = (typeof PLAYING_TIME_OUTLOOKS)[number];

export interface ImportProblem {
  // 1-based line in the file where the record starts (the header is line 1
  // in a normal file). A multi-line quoted cell keeps the record's first line.
  line: number;
  column: string;
  message: string;
}

export interface PositionOfNeed {
  position: string;
  gradYear?: number;
}

export interface SchoolImportRow {
  line: number;
  school: {
    name: string;
    division: SchoolDivision;
    program_tier: ProgramTier | null;
    conference: string;
    state: string;
    sports_sponsored: string[];
    academics: {
      gpaMin: number;
      gpaAvg: number;
      satRange?: string;
      actRange?: string;
    };
    financials: {
      athleticScholarship: AthleticScholarship;
      avgAthleticAid: number;
      avgMeritAid?: number;
      avgNeedAid?: number;
      instateTotal: number;
      outstateTotal: number;
      rosterSpotsOpen?: number;
    };
    athletics: {
      playingTimeOutlook?: PlayingTimeOutlook;
    };
    majors: string[];
  };
  overlay: {
    coach_name: string;
    coach_email: string;
    positions_of_need: PositionOfNeed[];
    notes: string | null;
  };
}

export interface SchoolsCsvParseResult {
  rows: SchoolImportRow[];
  problems: ImportProblem[];
}

// ---------------------------------------------------------------------------
// CSV tokenizer (RFC 4180 style: quoted fields, "" escapes, embedded commas
// and newlines, CRLF or LF or CR line endings, optional UTF-8 BOM).

interface CsvRecord {
  line: number;
  fields: string[];
}

function tokenize(text: string): CsvRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let recordHasContent = false;

  const endRecord = () => {
    fields.push(field);
    if (recordHasContent || fields.length > 1) records.push({ line: recordLine, fields });
    fields = [];
    field = "";
    recordHasContent = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\r") {
          if (src[i + 1] === "\n") i++;
          field += "\n";
          line++;
        } else {
          if (ch === "\n") line++;
          field += ch;
        }
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      recordHasContent = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
      recordHasContent = true;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
      if (ch.trim() !== "") recordHasContent = true;
    }
  }
  if (recordHasContent || fields.length > 0) endRecord();

  // A record made only of empty cells (",,,") is a blank line for our purposes.
  return records.filter((r) => r.fields.some((f) => f.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Field helpers. Each returns a value or pushes a problem; never throws.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitList(raw: string): string[] {
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function matchChoice<T extends string>(raw: string, choices: readonly T[]): T | null {
  const norm = raw.trim().replace(/\s+/g, " ").toLowerCase();
  for (const c of choices) if (c.toLowerCase() === norm) return c;
  return null;
}

function listChoices(choices: readonly string[]): string {
  return choices.join(", ");
}

// ---------------------------------------------------------------------------

export function parseSchoolsCsv(text: string): SchoolsCsvParseResult {
  const problems: ImportProblem[] = [];
  const rows: SchoolImportRow[] = [];
  const records = tokenize(text);

  if (records.length === 0) {
    problems.push({ line: 1, column: "header", message: "The file is empty. Start from the schools template and keep its header row." });
    return { rows, problems };
  }

  const header = records[0];
  const index = new Map<string, number>();
  header.fields.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    if (key && !index.has(key)) index.set(key, i);
  });

  let headerOk = true;
  for (const col of SCHOOL_CSV_REQUIRED_COLUMNS) {
    if (!index.has(col)) {
      headerOk = false;
      problems.push({ line: header.line, column: col, message: `The header is missing the required column ${col}. Start from the schools template so every column is present.` });
    }
  }
  if (!headerOk) return { rows, problems };

  const cell = (rec: CsvRecord, col: SchoolCsvColumn): string => {
    const i = index.get(col);
    if (i === undefined) return "";
    return (rec.fields[i] ?? "").trim();
  };

  const seenNames = new Map<string, number>();

  for (const rec of records.slice(1)) {
    const line = rec.line;
    const rowProblems: ImportProblem[] = [];
    const problem = (column: SchoolCsvColumn, message: string) => rowProblems.push({ line, column, message });

    const requireText = (col: SchoolCsvColumn): string => {
      const v = cell(rec, col);
      if (v === "") problem(col, `${col} is required.`);
      return v;
    };

    const name = requireText("name");
    if (name !== "") {
      const key = name.toLowerCase();
      const firstLine = seenNames.get(key);
      if (firstLine !== undefined) {
        problem("name", `${name} is already on line ${firstLine}. Each school can appear once.`);
      } else {
        seenNames.set(key, line);
      }
    }

    const divisionRaw = requireText("division");
    let division: SchoolDivision | null = null;
    if (divisionRaw !== "") {
      division = matchChoice(divisionRaw, SCHOOL_DIVISIONS);
      if (division === null) problem("division", `division must be one of ${listChoices(SCHOOL_DIVISIONS)}.`);
    }
    const isD3 = division === "D3";

    const tierRaw = cell(rec, "program_tier");
    let programTier: ProgramTier | null = null;
    if (tierRaw !== "") {
      programTier = matchChoice(tierRaw, PROGRAM_TIERS);
      if (programTier === null) problem("program_tier", `program_tier must be blank or one of ${listChoices(PROGRAM_TIERS)}.`);
    }

    const conference = requireText("conference");
    const state = requireText("state");

    const sportsRaw = requireText("sports_sponsored");
    const sportsSponsored = splitList(sportsRaw);
    if (sportsRaw !== "" && sportsSponsored.length === 0) problem("sports_sponsored", "sports_sponsored must list at least one sport, separated by semicolons.");

    const gpa = (col: "gpa_min" | "gpa_avg"): number | null => {
      const raw = requireText(col);
      if (raw === "") return null;
      const n = parseNumber(raw);
      if (n === null || n < 0 || n > 4) {
        problem(col, `${col} must be a number between 0 and 4.`);
        return null;
      }
      return n;
    };
    const gpaMin = gpa("gpa_min");
    const gpaAvg = gpa("gpa_avg");

    const satRange = requireText("sat_range");
    const actRange = cell(rec, "act_range");

    const scholarshipRaw = requireText("athletic_scholarship");
    let athleticScholarship: AthleticScholarship | null = null;
    if (scholarshipRaw !== "") {
      athleticScholarship = matchChoice(scholarshipRaw, ATHLETIC_SCHOLARSHIP_TYPES);
      if (athleticScholarship === null) {
        problem("athletic_scholarship", `athletic_scholarship must be one of ${listChoices(ATHLETIC_SCHOLARSHIP_TYPES)}.`);
      } else if (isD3 && athleticScholarship !== "none") {
        problem("athletic_scholarship", "athletic_scholarship must be none for a D3 school. The NCAA does not allow athletic scholarships in Division III.");
      }
    }

    const dollars = (col: SchoolCsvColumn, required: boolean): number | undefined => {
      const raw = cell(rec, col);
      if (raw === "") {
        if (required) problem(col, isD3 && (col === "avg_merit_aid" || col === "avg_need_aid") ? `${col} is required for a D3 school.` : `${col} is required.`);
        return undefined;
      }
      const n = parseNumber(raw);
      if (n === null || n < 0) {
        problem(col, `${col} must be a dollar amount, like 42000.`);
        return undefined;
      }
      return Math.round(n);
    };
    const avgAthleticAid = dollars("avg_athletic_aid", true);
    const avgMeritAid = dollars("avg_merit_aid", isD3);
    const avgNeedAid = dollars("avg_need_aid", isD3);
    const instateTotal = dollars("cost_in_state", true);
    const outstateTotal = dollars("cost_out_of_state", true);

    let rosterSpotsOpen: number | undefined;
    const rosterRaw = cell(rec, "roster_spots_open");
    if (rosterRaw !== "") {
      const n = parseNumber(rosterRaw);
      if (n === null || n < 0 || !Number.isInteger(n)) {
        problem("roster_spots_open", "roster_spots_open must be a whole number of open spots, or blank.");
      } else {
        rosterSpotsOpen = n;
      }
    }

    let playingTimeOutlook: PlayingTimeOutlook | undefined;
    const outlookRaw = cell(rec, "playing_time_outlook");
    if (outlookRaw !== "") {
      const o = matchChoice(outlookRaw, PLAYING_TIME_OUTLOOKS);
      if (o === null) problem("playing_time_outlook", `playing_time_outlook must be blank or one of ${listChoices(PLAYING_TIME_OUTLOOKS)}.`);
      else playingTimeOutlook = o;
    }

    const majorsRaw = requireText("majors");
    const majors = splitList(majorsRaw);
    if (majorsRaw !== "" && majors.length === 0) problem("majors", "majors must list at least one major, separated by semicolons.");

    const coachName = requireText("head_coach");
    const coachEmail = requireText("coach_email");
    if (coachEmail !== "" && !EMAIL.test(coachEmail)) problem("coach_email", "coach_email must be an email address, like coach@school.edu.");

    const positionsOfNeed: PositionOfNeed[] = [];
    for (const entry of splitList(cell(rec, "positions_of_need"))) {
      const parts = entry.split(/\s+/);
      const last = parts[parts.length - 1];
      if (parts.length > 1 && /^\d{4}$/.test(last)) {
        const year = Number(last);
        if (year < 2000 || year > 2100) {
          problem("positions_of_need", `positions_of_need has a grad year that does not look right in "${entry}". Entries look like SS 2027 or C.`);
          continue;
        }
        positionsOfNeed.push({ position: parts.slice(0, -1).join(" "), gradYear: year });
      } else if (parts.length > 1) {
        problem("positions_of_need", `positions_of_need could not read "${entry}". Entries look like SS 2027 or C, separated by semicolons.`);
      } else {
        positionsOfNeed.push({ position: entry });
      }
    }

    const notesRaw = cell(rec, "notes");
    const notes = notesRaw === "" ? null : notesRaw;

    if (rowProblems.length > 0) {
      problems.push(...rowProblems);
      continue;
    }

    // Every required value is present and valid at this point; the non-null
    // assertions below are guaranteed by the checks above.
    rows.push({
      line,
      school: {
        name,
        division: division as SchoolDivision,
        program_tier: programTier,
        conference,
        state,
        sports_sponsored: sportsSponsored,
        academics: {
          gpaMin: gpaMin as number,
          gpaAvg: gpaAvg as number,
          satRange,
          ...(actRange !== "" ? { actRange } : {}),
        },
        financials: {
          athleticScholarship: athleticScholarship as AthleticScholarship,
          avgAthleticAid: avgAthleticAid as number,
          ...(avgMeritAid !== undefined ? { avgMeritAid } : {}),
          ...(avgNeedAid !== undefined ? { avgNeedAid } : {}),
          instateTotal: instateTotal as number,
          outstateTotal: outstateTotal as number,
          ...(rosterSpotsOpen !== undefined ? { rosterSpotsOpen } : {}),
        },
        athletics: {
          ...(playingTimeOutlook !== undefined ? { playingTimeOutlook } : {}),
        },
        majors,
      },
      overlay: {
        coach_name: coachName,
        coach_email: coachEmail,
        positions_of_need: positionsOfNeed,
        notes,
      },
    });
  }

  return { rows, problems };
}
