// What the vault accepts, and how a file proves it is that thing.
//
// Seven formats: PDF, Word (DOC, DOCX), Excel (XLS, XLSX), CSV, JPG, PNG
// and TXT. A file is accepted only when its EXTENSION names one of them
// and its BYTES agree. The browser's own idea of the type is never used:
// a renamed file, a screenshot saved as .jpg that is really a PNG, a
// spreadsheet with a .pdf name, all fail on the bytes.
//
// Pure functions over plain bytes. No File, no Blob, no DOM, no Next, no
// Supabase, so the browser and the server run the very same check and a
// test can build a file out of a few numbers.

export type VaultFormat = "pdf" | "word" | "excel" | "csv" | "jpg" | "png" | "txt";

// The 10 MB limit is the documents bucket's (migration 0029) and the
// reader's. A scanned four page transcript fits with room to spare.
export const VAULT_MAX_BYTES = 10 * 1024 * 1024;

// Said to a person, in one place, so every refusal names the same seven.
export const VAULT_FORMATS_SENTENCE = "PDF, Word (DOC, DOCX), Excel (XLS, XLSX), CSV, JPG, PNG and TXT";

// The file picker's accept attribute. Extensions only: HEIC is left off
// on purpose, because an iPhone converts a camera photo to JPEG on the
// way into a picker only when HEIC is not among the accepted types.
export const VAULT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.txt";

const EXTENSION_TO_FORMAT: Record<string, { format: VaultFormat; mediaType: string }> = {
  pdf: { format: "pdf", mediaType: "application/pdf" },
  doc: { format: "word", mediaType: "application/msword" },
  docx: { format: "word", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xls: { format: "excel", mediaType: "application/vnd.ms-excel" },
  xlsx: { format: "excel", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  csv: { format: "csv", mediaType: "text/csv" },
  jpg: { format: "jpg", mediaType: "image/jpeg" },
  jpeg: { format: "jpg", mediaType: "image/jpeg" },
  png: { format: "png", mediaType: "image/png" },
  txt: { format: "txt", mediaType: "text/plain" },
};

// The types the bucket allows, in the order migration 0048 lists them.
export const VAULT_MEDIA_TYPES: readonly string[] = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/jpeg",
  "image/png",
];

export const FORMAT_LABEL: Record<VaultFormat, string> = {
  pdf: "PDF",
  word: "Word",
  excel: "Excel",
  csv: "CSV",
  jpg: "JPG",
  png: "PNG",
  txt: "TXT",
};

// What the bytes are, whatever the name says.
export type SniffedKind = "pdf" | "jpg" | "png" | "zip" | "ole2" | "text" | "gif" | "webp" | "heic" | "unknown";

const startsWith = (bytes: Uint8Array, sig: number[]): boolean => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

// Text has no signature. It is text when the first 64 KB holds no NUL
// byte and next to no control characters. Any 8-bit encoding passes (a
// CSV exported from Excel is usually Windows-1252, not UTF-8); a UTF-16
// file is recognised by its byte order mark.
function looksLikeText(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  const n = Math.min(bytes.length, 64 * 1024);
  if (n === 0) return false;
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c && b !== 0x1b) control++;
  }
  return control / n < 0.01;
}

// %PDF, anywhere in the first 1024 bytes: the PDF standard allows junk
// before the header and a few scanners write some.
function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length - 3, 1024);
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46) return true;
  }
  return false;
}

export function sniffBytes(bytes: Uint8Array): SniffedKind {
  if (hasPdfHeader(bytes)) return "pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif"; // GIF87a, GIF89a
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand)) return "heic";
  }
  // PK\x03\x04 (a zip with files), PK\x05\x06 (an empty zip).
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  // The OLE2 compound file header, the container of .doc and .xls.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole2";
  if (looksLikeText(bytes)) return "text";
  return "unknown";
}

// The file names inside a zip, read from its central directory (the
// index at the end). A .docx has word/document.xml, a .xlsx has
// xl/workbook.xml; a zip with neither is some other zip with a renamed
// extension. No library: a zip's index is a few fixed-size records.
export function zipEntryNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is the last 22 bytes plus a
  // comment of up to 64 KB. Scan backwards for its signature.
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  const decoder = new TextDecoder("utf-8");
  for (let i = 0; i < count && i < 5000; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (offset + 46 + nameLength > bytes.length) break;
    names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export type FormatCheck =
  | { ok: true; format: VaultFormat; extension: string; mediaType: string; size: number }
  | { ok: false; reason: string; code: "empty" | "too_big" | "not_accepted" | "mismatch" };

const KIND_PHRASE: Record<SniffedKind, string> = {
  pdf: "a PDF",
  jpg: "a JPG image",
  png: "a PNG image",
  zip: "a zip archive",
  ole2: "an old Office file",
  text: "plain text",
  gif: "a GIF image",
  webp: "a WebP image",
  heic: "a HEIC photo",
  unknown: "something Doc AI cannot identify",
};

export function notAcceptedMessage(fileName: string): string {
  return `${fileName || "That file"} is not a format Doc AI stores. It takes ${VAULT_FORMATS_SENTENCE}.`;
}

// The one check. Order: empty, too big, extension, then the bytes.
export function checkVaultFile(fileName: string, bytes: Uint8Array, maxBytes: number = VAULT_MAX_BYTES): FormatCheck {
  const label = fileName || "That file";
  if (bytes.length === 0) return { ok: false, code: "empty", reason: `${label} is empty.` };
  if (bytes.length > maxBytes) {
    const mb = (bytes.length / 1024 / 1024).toFixed(1);
    return { ok: false, code: "too_big", reason: `${label} is ${mb} MB. The limit is ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  }

  const extension = extensionOf(fileName);
  const claimed = EXTENSION_TO_FORMAT[extension];
  if (!claimed) return { ok: false, code: "not_accepted", reason: notAcceptedMessage(label) };

  const kind = sniffBytes(bytes);
  const agrees = (() => {
    switch (extension) {
      case "pdf":
        return kind === "pdf";
      case "jpg":
      case "jpeg":
        return kind === "jpg";
      case "png":
        return kind === "png";
      case "doc":
      case "xls":
        return kind === "ole2";
      case "docx":
        return kind === "zip" && zipEntryNames(bytes).includes("word/document.xml");
      case "xlsx":
        return kind === "zip" && zipEntryNames(bytes).includes("xl/workbook.xml");
      case "csv":
      case "txt":
        return kind === "text";
      default:
        return false;
    }
  })();

  if (!agrees) {
    return {
      ok: false,
      code: "mismatch",
      reason: `${label} does not match its name: its contents are ${KIND_PHRASE[kind]}, not .${extension}. Doc AI takes ${VAULT_FORMATS_SENTENCE}.`,
    };
  }
  return { ok: true, format: claimed.format, extension, mediaType: claimed.mediaType, size: bytes.length };
}

// A file name that is safe as the last part of a storage path.
export function safeStorageName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  return cleaned.slice(0, 80) || "file";
}

// Which formats the existing reader can read: PDF and photos only.
export function readerCanRead(format: VaultFormat): boolean {
  return format === "pdf" || format === "jpg" || format === "png";
}

// "512 bytes", "48 KB", "1.2 MB": a file's size as a person reads it.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// The format label for a stored document. Rows from before the vault
// carry it only as a media type; anything else reads as "File".
export function formatLabelOf(format: string | null | undefined, mediaType?: string | null): string {
  if (format && format in FORMAT_LABEL) return FORMAT_LABEL[format as VaultFormat];
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType === "image/jpeg") return "JPG";
  if (mediaType === "image/png") return "PNG";
  return "File";
}
