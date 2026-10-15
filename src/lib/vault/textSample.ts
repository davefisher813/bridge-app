// The plain words of a stored file, for Piece 2's suggestions: enough of
// them to see a name or a heading, never read for facts. Server only
// (node:zlib). Best effort by design: a file this cannot read gives null,
// and the suggestion falls back to the file name. Nothing is ever refused
// or changed because of what this does or does not find.
//
//   TXT, CSV  the text itself
//   DOCX      word/document.xml, tags removed
//   XLSX      sheet names and every cell's text (xl/sharedStrings.xml)
//   PDF       text drawn with Tj or TJ in each content stream. Works for
//             most PDFs a program wrote; gives little for a scan or a PDF
//             whose fonts use custom codes. Said so on the screen.
//   DOC, XLS, JPG, PNG: null (old binary formats and pictures).

import { inflateRawSync, inflateSync } from "node:zlib";
import type { VaultFormat } from "./format";

export const SAMPLE_MAX_CHARS = 20_000;
const MAX_INFLATED_BYTES = 4 * 1024 * 1024; // a zip bomb stops here
const MAX_PDF_STREAMS = 200;

export function textSample(format: VaultFormat, bytes: Uint8Array): string | null {
  try {
    const text = sampleOf(format, bytes);
    if (!text) return null;
    const squeezed = text.replace(/\s+/g, " ").trim();
    return squeezed ? squeezed.slice(0, SAMPLE_MAX_CHARS) : null;
  } catch {
    return null;
  }
}

function sampleOf(format: VaultFormat, bytes: Uint8Array): string | null {
  switch (format) {
    case "txt":
    case "csv":
      return decodeText(bytes.subarray(0, SAMPLE_MAX_CHARS * 4));
    case "word": {
      const xml = zipEntry(bytes, "word/document.xml");
      // Paragraph ends become spaces so words do not run together.
      return xml ? stripXml(xml.replace(/<\/w:p>/g, " ")) : null;
    }
    case "excel": {
      const workbook = zipEntry(bytes, "xl/workbook.xml");
      const sheetNames = workbook ? [...workbook.matchAll(/<sheet[^>]*\bname="([^"]*)"/g)].map((m) => m[1]).join(" ") : "";
      const strings = zipEntry(bytes, "xl/sharedStrings.xml");
      const cells = strings ? stripXml(strings.replace(/<\/si>/g, " ")) : "";
      return `${decodeEntities(sheetNames)} ${cells}`;
    }
    case "pdf":
      return pdfText(bytes);
    default:
      return null;
  }
}

function decodeText(bytes: Uint8Array): string {
  // UTF-8 when it is valid, otherwise Windows-1252 (an Excel CSV export).
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function stripXml(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, " "));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

// One named entry out of a zip, read through its central directory.
// Stored (0) and deflated (8) entries; anything else gives null.
export function zipEntry(bytes: Uint8Array, wanted: string): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder("utf-8");
  for (let i = 0; i < count && i < 5000; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === wanted) {
      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return null;
      const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const data = bytes.subarray(start, start + compressedSize);
      if (method === 0) return utf8.decode(data);
      if (method === 8) return utf8.decode(inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES }));
      return null;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

// Text a PDF draws: literal strings before Tj, and the strings inside a
// TJ array. Each content stream is inflated if it is Flate-compressed.
function pdfText(bytes: Uint8Array): string | null {
  const latin1 = new TextDecoder("latin1");
  const raw = latin1.decode(bytes);
  const out: string[] = [];
  let length = 0;
  const re = /stream\r?\n/g;
  let streams = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && streams < MAX_PDF_STREAMS && length < SAMPLE_MAX_CHARS) {
    streams++;
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const header = raw.slice(Math.max(0, m.index - 300), m.index);
    let content: string | null = null;
    const chunk = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(header)) {
      try {
        content = latin1.decode(inflateSync(chunk, { maxOutputLength: MAX_INFLATED_BYTES }));
      } catch {
        content = null;
      }
    } else if (!/\/Filter/.test(header)) {
      content = latin1.decode(chunk);
    }
    if (content && /T[Jj]/.test(content)) {
      const words = drawnText(content);
      if (words) {
        out.push(words);
        length += words.length;
      }
    }
    re.lastIndex = end + 9;
  }
  return out.length ? out.join(" ") : null;
}

function drawnText(content: string): string {
  const parts: string[] = [];
  // (literal) Tj   and   [ (a) -20 (b) ] TJ
  for (const m of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
    if (m[1] !== undefined) parts.push(unescapePdf(m[1]));
    else if (m[2] !== undefined) parts.push([...m[2].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => unescapePdf(x[1]!)).join(""));
  }
  return parts.join(" ");
}

function unescapePdf(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, c: string) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ({ n: " ", r: " ", t: " ", b: "", f: "" } as Record<string, string>)[c] ?? c;
  });
}
