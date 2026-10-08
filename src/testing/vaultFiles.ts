// Synthetic files for the vault tests: a few bytes each, built to carry
// exactly the signature a real file of that format starts with. No real
// document, no real person. Shared by the unit tests, the action tests
// and the browser tests so they all agree on what "a DOCX" is.

const enc = new TextEncoder();

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

// A real, minimal zip: stored (uncompressed) entries, a central
// directory and an end record. Enough for the index reader to list names.
export function makeZip(entries: Record<string, string>): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  let count = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = [...enc.encode(name)];
    const data = [...enc.encode(content)];
    const offset = local.length;
    local.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
    count++;
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(central.length), ...u32(local.length), ...u16(0)];
  return new Uint8Array([...local, ...central, ...end]);
}

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export type SyntheticKind = "pdf" | "docx" | "xlsx" | "doc" | "xls" | "csv" | "jpg" | "png" | "txt" | "gif" | "webp" | "heic" | "zip" | "binary" | "empty";

export function makeFile(kind: SyntheticKind, filler = 64): Uint8Array {
  const pad = new Array(filler).fill(0x20);
  switch (kind) {
    case "pdf":
      return new Uint8Array([...enc.encode("%PDF-1.4\n1 0 obj<<>>endobj\n"), ...pad, ...enc.encode("\n%%EOF")]);
    case "docx":
      return makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": "<w:document/>" });
    case "xlsx":
      return makeZip({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<workbook/>" });
    case "zip":
      return makeZip({ "readme.txt": "just a zip" });
    case "doc":
    case "xls":
      return new Uint8Array([...OLE2, ...new Array(filler).fill(0x00)]);
    case "csv":
      return enc.encode("name,role\nTest Athlete,Athlete\nTest Parent,Parent\n");
    case "txt":
      return enc.encode("A plain text note for the vault.\nSecond line.\n");
    case "jpg":
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(filler).fill(0x11), 0xff, 0xd9]);
    case "png":
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(filler).fill(0x22)]);
    case "gif":
      return new Uint8Array([...enc.encode("GIF89a"), ...new Array(filler).fill(0x33)]);
    case "webp":
      return new Uint8Array([...enc.encode("RIFF"), 0, 0, 0, 0, ...enc.encode("WEBP"), ...new Array(filler).fill(0x44)]);
    case "heic":
      return new Uint8Array([0, 0, 0, 24, ...enc.encode("ftyp"), ...enc.encode("heic"), ...new Array(filler).fill(0x55)]);
    case "binary":
      return new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x00, 0x00, 0x04, 0x05, ...new Array(filler).fill(0x06)]);
    case "empty":
      return new Uint8Array(0);
  }
}

// The name a test uses for a kind, with an extension that agrees.
export const GOOD_NAMES: Record<"pdf" | "docx" | "xlsx" | "doc" | "xls" | "csv" | "jpg" | "png" | "txt", string> = {
  pdf: "test-transcript.pdf",
  docx: "test-letter.docx",
  xlsx: "test-sheet.xlsx",
  doc: "test-letter.doc",
  xls: "test-sheet.xls",
  csv: "test-list.csv",
  jpg: "test-photo.jpg",
  png: "test-scan.png",
  txt: "test-note.txt",
};
