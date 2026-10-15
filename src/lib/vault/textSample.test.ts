import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { makeZip } from "@/testing/vaultFiles";
import { SAMPLE_MAX_CHARS, textSample } from "./textSample";

const enc = new TextEncoder();

function pdfWith(streams: { body: string; flate?: boolean }[]): Uint8Array {
  const parts: Uint8Array[] = [enc.encode("%PDF-1.4\n")];
  streams.forEach((s, i) => {
    const data = s.flate ? new Uint8Array(deflateSync(enc.encode(s.body))) : enc.encode(s.body);
    parts.push(enc.encode(`${i + 1} 0 obj\n<< /Length ${data.length}${s.flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`), data, enc.encode("\nendstream\nendobj\n"));
  });
  parts.push(enc.encode("%%EOF"));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("textSample", () => {
  it("reads TXT and CSV, including a Windows-1252 export", () => {
    expect(textSample("txt", enc.encode("Student: Jordan Alvarez\nTranscript"))).toBe("Student: Jordan Alvarez Transcript");
    expect(textSample("csv", new Uint8Array([0x4a, 0x6f, 0x73, 0xe9]))).toBe("José");
  });

  it("reads a Word file's paragraphs without running words together", () => {
    const docx = makeZip({ "word/document.xml": "<w:document><w:p><w:r><w:t>College</w:t></w:r></w:p><w:p><w:r><w:t>List &amp; Notes</w:t></w:r></w:p></w:document>" });
    expect(textSample("word", docx)).toBe("College List & Notes");
  });

  it("reads an Excel file's sheet names and cell text", () => {
    const xlsx = makeZip({
      "xl/workbook.xml": '<workbook><sheets><sheet name="Assignment Tracker" sheetId="1"/></sheets></workbook>',
      "xl/sharedStrings.xml": "<sst><si><t>Athlete</t></si><si><t>Jordan Alvarez</t></si></sst>",
    });
    expect(textSample("excel", xlsx)).toBe("Assignment Tracker Athlete Jordan Alvarez");
  });

  it("reads text a PDF draws, compressed or not", () => {
    const pdf = pdfWith([
      { body: "BT /F1 12 Tf (Official Transcript) Tj ET" },
      { body: "BT [(Jordan) -250 (Alvarez)] TJ ET", flate: true },
    ]);
    expect(textSample("pdf", pdf)).toBe("Official Transcript JordanAlvarez");
  });

  it("gives null, never an error, for what it cannot read", () => {
    expect(textSample("pdf", enc.encode("%PDF-1.4 nothing drawn"))).toBeNull();
    expect(textSample("word", enc.encode("not a zip"))).toBeNull();
    expect(textSample("jpg", new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(textSample("pdf", pdfWith([{ body: "garbage", flate: false }]))).toBeNull();
  });

  it("stops at the sample size", () => {
    expect(textSample("txt", enc.encode("word ".repeat(10_000)))!.length).toBeLessThanOrEqual(SAMPLE_MAX_CHARS);
  });

  it("refuses a zip bomb instead of filling memory", () => {
    const bomb = pdfWith([{ body: `BT (${"A".repeat(5 * 1024 * 1024)}) Tj ET`, flate: true }]);
    expect(textSample("pdf", bomb)).toBeNull();
  });
});
