// What the document screen shows of a stored file (Doc AI Piece 6). Pure:
// no Next, no Supabase, no DOM, so a law can ask it directly.
//
//   photo  a JPG or PNG, shown on the page from the download route's
//          inline mode
//   pdf    opened in the browser's own viewer, in a new tab
//   text   Word (.docx), Excel (.xlsx), CSV and text: the text the reader
//          gets (textExtract.ts, readerText), capped, so a person can
//          check what was read
//   none   anything else (an old .doc or .xls): the download only

import { formatOfName, type VaultFormat } from "@/lib/vault/format";

export type PreviewKind = "photo" | "pdf" | "text" | "none";

// A document's format: the column, or for a row written before the vault
// set it (an assignment's file, migration 0046) its media type.
export function storedFormatOf(format: string | null | undefined, mediaType: string | null | undefined): VaultFormat | null {
  if (format && ["pdf", "word", "excel", "csv", "jpg", "png", "txt"].includes(format)) return format as VaultFormat;
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/png") return "png";
  return null;
}

// One stored page's format: its own name first (a multi-file upload can
// mix a PDF and a photo), else the document's.
export function pageFormatOf(path: string, docFormat: VaultFormat | null): VaultFormat | null {
  return formatOfName(path)?.format ?? docFormat;
}

export function previewKindOf(format: VaultFormat | null, name: string): PreviewKind {
  if (format === "jpg" || format === "png") return "photo";
  if (format === "pdf") return "pdf";
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (["docx", "xlsx", "csv", "txt"].includes(ext)) return "text";
  return "none";
}

// The media type a page may be shown inline as: a PDF or a photo, by the
// stored name. Anything else is only ever a download.
export function inlineMediaTypeOf(path: string): string | null {
  const known = formatOfName(path);
  if (!known) return null;
  return known.format === "pdf" || known.format === "jpg" || known.format === "png" ? known.mediaType : null;
}

// How much of a file's text the screen shows before it says the rest was
// left out. The reader gets up to MAX_READER_CHARS; a phone screen needs
// far less to tell whether the right file was read.
export const PREVIEW_TEXT_MAX = 4000;

// `kept` is how many of the file's characters are shown, said beside a
// cut block ("The first 4,000 of 16,089 characters").
export function capPreviewText(text: string, max: number = PREVIEW_TEXT_MAX): { shown: string; cut: boolean; kept: number; total: number } {
  const total = text.length;
  if (total <= max) return { shown: text, cut: false, kept: total, total };
  return { shown: `${text.slice(0, max).trimEnd()}...`, cut: true, kept: max, total };
}
