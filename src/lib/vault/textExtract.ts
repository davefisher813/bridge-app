// The text inside a Word, Excel, CSV or text file, for the reader (Dave,
// Oct 11: every document runs through Doc AI, and the org's scholarship
// proposals are DOCX and its college lists XLSX). The model reads PDFs
// and photos itself; these formats are turned into plain text here, on
// the server, and sent as a text document through the same pipeline.
//
// No dependency: DOCX and XLSX are zip files of XML, and a zip is a
// directory at the end of the file plus deflate, which Node's zlib does.
// Server only (node:zlib). The old binary .doc and .xls are not zips and
// are not read; readerTextBlocker says so before anything is uploaded.

import { inflateRawSync } from "node:zlib";
import { readerTextBlocker } from "./format";

// What one file may turn into. A 400 page export is not read whole:
// past this the text is cut and the reading says so.
export const MAX_READER_CHARS = 150_000;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;

export type TextResult = { ok: true; text: string; truncated: boolean } | { ok: false; reason: string };

const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

// ── zip ─────────────────────────────────────────────────────────────

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  // The end-of-central-directory record, searched for from the end.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("damaged zip directory");
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (size > MAX_ENTRY_BYTES) continue;
    if (u32(bytes, local) !== 0x04034b50) continue;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES })));
  }
  return out;
}

// ── XML ─────────────────────────────────────────────────────────────

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const utf8 = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

// Word: the page headers, then the body, then the page footers (a
// letterhead's name and date often live in a header). Runs of text,
// paragraphs as lines, table cells split by " | " and rows as lines, so a
// table reads as a table.
export function docxToText(bytes: Uint8Array): string {
  const files = unzip(bytes);
  const body = files.get("word/document.xml");
  if (!body) throw new Error("no document body in this Word file");
  const numbered = (kind: "header" | "footer") => {
    const re = kind === "header" ? /^word\/header(\d*)\.xml$/ : /^word\/footer(\d*)\.xml$/;
    return [...files.keys()]
      .filter((k) => re.test(k))
      .sort((a, b) => Number(a.match(re)![1] || 0) - Number(b.match(re)![1] || 0));
  };
  const parts = [...numbered("header"), "word/document.xml", ...numbered("footer")].map((k) => wordPartText(utf8(files.get(k)!))).filter((t) => t !== "");
  return tidy(parts.join("\n\n"));
}

function wordPartText(source: string): string {
  const xml = source
    // A paragraph inside a table cell is a space, not a new line, so a
    // row stays on one line.
    .replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => cell.replace(/<\/w:p>/g, " "))
    .replace(/<w:tab\/>/g, "\u0001")
    // A line or page break, with or without attributes (<w:br w:type="page"/>).
    .replace(/<w:(br|cr)\b[^>]*\/>/g, "\u0002")
    .replace(/<\/w:p>/g, "\u0002")
    .replace(/<\/w:tc>/g, "\u0003")
    .replace(/<\/w:tr>/g, "\u0002");
  const parts: string[] = [];
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|([\u0001\u0002\u0003])/g)) {
    if (m[1] !== undefined) parts.push(decodeEntities(m[1]));
    else parts.push(m[2] === "\u0001" ? "\t" : m[2] === "\u0003" ? " | " : "\n");
  }
  // A row's last cell leaves a trailing separator.
  return tidy(parts.join("").replace(/[ ]*\|[ ]*\n/g, "\n").replace(/ {2,}/g, " "));
}

const colIndex = (ref: string) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

// One attribute out of one XML element's attribute text.
const attrOf = (attrs: string, name: string): string | undefined => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`));
  return m ? decodeEntities(m[1]!) : undefined;
};

// Excel's built-in number formats that show a date or a time (stored the
// same way, as a serial): 14 to 22 and 45 to 47.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

// A custom format code that shows a date: a day, a month or a year once
// the quoted text, escapes, padding, colours and locales are taken out.
// An elapsed time ([h]:mm, mm:ss) is not a date.
export function isDateFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "")
    .replace(/\[[^\]]*\]/g, "");
  if (/[dy]/i.test(bare)) return true;
  // An m beside an hour or a second ([h]:mm, h:mm, mm:ss) is minutes.
  const elapsed = /\[(h+|m+|s+)\]/i.test(code);
  return /m/i.test(bare) && !elapsed && !/[hs]/i.test(bare);
}

// The cell styles (s="n" on a cell, an index into cellXfs) whose number
// format is a date.
function dateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<(?:\w+:)?numFmt\b([^>]*?)\/?>/g)) {
    const id = Number(attrOf(m[1]!, "numFmtId"));
    const code = attrOf(m[1]!, "formatCode");
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
  }
  const xfs = stylesXml.match(/<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/)?.[1] ?? "";
  let i = 0;
  for (const m of xfs.matchAll(/<(?:\w+:)?xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/(?:\w+:)?xf>)/g)) {
    const id = Number(attrOf(m[1]!, "numFmtId") ?? 0);
    const code = custom.get(id);
    if (code !== undefined ? isDateFormatCode(code) : BUILTIN_DATE_FORMATS.has(id)) out.add(i);
    i++;
  }
  return out;
}

// An Excel date serial as YYYY-MM-DD. The 1900 system counts from
// 1899-12-30 (with Excel's phantom 29 Feb 1900 at serial 60); the 1904
// system from 1904-01-01.
export function excelSerialToDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const days = Math.floor(serial);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + (!date1904 && days < 60 ? days + 1 : days) * 86_400_000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Each sheet in the workbook's own order, by its own name: workbook.xml
// names a relationship per sheet and the workbook's relationships say
// which file that is. The files are not always numbered in tab order.
function sheetFiles(files: Map<string, Uint8Array>): { name: string; path: string }[] {
  const wb = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const targets = new Map<string, string>();
    for (const m of utf8(rels).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const id = attrOf(m[1]!, "Id");
      const target = attrOf(m[1]!, "Target");
      if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    }
    const out: { name: string; path: string }[] = [];
    for (const m of utf8(wb).matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
      const rid = attrOf(m[1]!, "r:id");
      const path = rid ? targets.get(rid) : undefined;
      if (path && files.has(path)) out.push({ name: attrOf(m[1]!, "name") ?? path, path });
    }
    if (out.length) return out;
  }
  // Nothing to map by: the sheet files in number order.
  const names = wb ? [...utf8(wb).matchAll(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeEntities(m[1]!)) : [];
  return [...files.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]))
    .map((path, i) => ({ name: names[i] ?? `Sheet ${i + 1}`, path }));
}

// Every SpreadsheetML element below may carry a namespace prefix
// (<x:c>, <x:row>, <x:si>): some exporters write the main namespace
// under a prefix instead of as the default, so each element name takes
// an optional "<prefix>:" in front.
// Excel: each sheet by name, each row as its cells split by " | ", with
// empty cells kept so columns line up. Shared strings, inline strings,
// numbers and booleans as they are stored, and a number formatted as a
// date as that date (YYYY-MM-DD), not the serial Excel keeps.
export function xlsxToText(bytes: Uint8Array): string {
  const files = unzip(bytes);
  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml");
  if (ss) for (const si of utf8(ss).matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)) shared.push(decodeEntities([...si[1]!.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g)].map((t) => t[1]).join("")));
  const styles = files.get("xl/styles.xml");
  const dates = dateStyles(styles ? utf8(styles) : null);
  const wb = files.get("xl/workbook.xml");
  const date1904 = wb ? /<(?:\w+:)?workbookPr\b[^>]*\bdate1904="(1|true)"/.test(utf8(wb)) : false;
  const sheets = sheetFiles(files);
  if (!sheets.length) throw new Error("no sheets in this Excel file");
  const out: string[] = [];
  for (const sheet of sheets) {
    out.push(`Sheet: ${sheet.name}`);
    for (const row of utf8(files.get(sheet.path)!).matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attrs = c[1]!;
        const inner = c[2] ?? "";
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/\bt="([a-zA-Z]+)"/)?.[1];
        const style = attrs.match(/\bs="(\d+)"/)?.[1];
        const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        let value = "";
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = decodeEntities([...inner.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/g)].map((t) => t[1]).join(""));
        else if (type === "b" && v !== undefined) value = v === "1" ? "TRUE" : "FALSE";
        else if (v !== undefined && (type === undefined || type === "n") && style !== undefined && dates.has(Number(style))) value = excelSerialToDate(Number(v), date1904) ?? decodeEntities(v);
        else if (v !== undefined) value = decodeEntities(v);
        const at = ref ? colIndex(ref) : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = value.replace(/\s+/g, " ").trim();
      }
      if (cells.some((c) => c !== "")) out.push(cells.join(" | "));
    }
  }
  return tidy(out.join("\n"));
}

// CSV and text: UTF-8, UTF-16 by its byte order mark, else Windows-1252
// (what Excel writes a CSV in).
export function plainText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return tidy(new TextDecoder("utf-16le").decode(bytes));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return tidy(new TextDecoder("utf-16be").decode(bytes));
  try {
    return tidy(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return tidy(new TextDecoder("windows-1252").decode(bytes));
  }
}

function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The text the reader gets for one stored file, or the plain reason it
// cannot have any.
export function readerText(name: string, bytes: Uint8Array): TextResult {
  const blocked = readerTextBlocker(name);
  if (blocked) return { ok: false, reason: blocked };
  const ext = extOf(name);
  let text: string;
  try {
    if (ext === "docx") text = docxToText(bytes);
    else if (ext === "xlsx") text = xlsxToText(bytes);
    else if (ext === "csv" || ext === "txt") text = plainText(bytes);
    else return { ok: false, reason: "The reader reads PDF, photos, Word (.docx), Excel (.xlsx), CSV and text files." };
  } catch (e) {
    return { ok: false, reason: `${name} could not be opened to read: ${(e as Error).message}.` };
  }
  if (!text) return { ok: false, reason: `${name} has no text in it to read.` };
  const truncated = text.length > MAX_READER_CHARS;
  return { ok: true, text: truncated ? `${text.slice(0, MAX_READER_CHARS)}\n\n[The rest of the file was cut here.]` : text, truncated };
}
