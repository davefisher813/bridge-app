// A CSV a spreadsheet can open without running anything. Pure: no Next,
// no Supabase.
//
// Every cell is quoted, quotes are doubled, and a cell that begins with
// = + - @ (or a tab or carriage return) gets a leading apostrophe so
// Excel and Sheets read it as text and never as a formula
// (OWASP "CSV injection"). Lines end CRLF; a byte order mark leads so
// Excel reads UTF-8 names correctly.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// The roster export. A deliberately short list: what the roster screen
// already shows, plus the advisor's name and the graduation year when one
// is stored. No contact details, no notes, no ids.
export const ROSTER_CSV_HEADER = ["Name", "Sport", "Position", "Status", "Recruit Type", "Grad Year", "Advisor", "GPA"] as const;

export interface RosterCsvRow {
  name: string;
  sport: string;
  position: string | null;
  status: string;
  recruitType: string;
  gradYear: number | null;
  advisor: string | null;
  gpa: number | string | null;
}

export function rosterCsv(rows: readonly RosterCsvRow[]): string {
  return toCsv(
    ROSTER_CSV_HEADER,
    rows.map((r) => [r.name, r.sport, r.position, r.status, r.recruitType, r.gradYear, r.advisor, r.gpa != null ? Number(r.gpa).toFixed(2) : null]),
  );
}

// The stored graduation year, if the athlete's detail has one.
export function gradYearOf(detail: unknown): number | null {
  const v = (detail as { gradYear?: unknown } | null | undefined)?.gradYear;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}
