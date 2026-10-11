// Document types the reader does not read (migration 0054). A board's
// bylaws is stored and labelled, never read. An athlete's profile sheet
// was one of these until Oct 11, when it became a reader type of its
// own (migration 0059); rows filed that way before read as it.

import type { DocCategoryId } from "@/lib/docai/types";

// The six types the reader reads, in the order the upload form shows
// them. The one list both the upload form and the document screen use, so
// the two can never offer different types again (Alfred, 2026-10-10).
export const READER_TYPES: { id: DocCategoryId; label: string }[] = [
  { id: "transcript", label: "Transcript" },
  { id: "test_scores", label: "Test Scores" },
  { id: "offer_letter", label: "Offer Letter" },
  { id: "recommendation", label: "Recommendation" },
  { id: "financial_aid", label: "Financial Aid" },
  { id: "metrics", label: "Metrics Report" },
  { id: "athlete_profile", label: "Athlete Profile" },
];

export function isReaderType(v: unknown): v is DocCategoryId {
  return typeof v === "string" && READER_TYPES.some((t) => t.id === v);
}

export const FILE_TYPES = ["board_document", "other"] as const;
export type FileTypeId = (typeof FILE_TYPES)[number];

export const FILE_TYPE_LABEL: Record<FileTypeId, string> = {
  board_document: "Board Document",
  other: "Other",
};

// filed_as values from before a type became readable. The column still
// allows them (migration 0054's check), and such a row is that reader
// type: Read Again and the File As picker treat it so.
const LEGACY_FILED_AS_READER: Record<string, DocCategoryId> = { athlete_profile: "athlete_profile" };

// The type the reader reads a document as: the one it settled on, the
// one asked for, or a legacy filed_as that is a reader type now.
export function readerTypeOf(doc: { category?: string | null; requested_category?: string | null; filed_as?: string | null }): DocCategoryId | null {
  const t = doc.category ?? doc.requested_category ?? (doc.filed_as ? LEGACY_FILED_AS_READER[doc.filed_as] : undefined) ?? null;
  return isReaderType(t) ? t : null;
}

export function isFileType(v: unknown): v is FileTypeId {
  return typeof v === "string" && (FILE_TYPES as readonly string[]).includes(v);
}

// The type a person sees for a document: the reader's settled type, else
// the type it was uploaded as (a Word file tagged Transcript is still a
// transcript even though the reader cannot read Word), else what it was
// filed as, else nothing.
export function documentTypeLabel(
  doc: { category?: string | null; requested_category?: string | null; filed_as?: string | null },
  readerLabels: Record<string, string>,
): string | null {
  const reader = doc.category ?? doc.requested_category ?? readerTypeOf(doc);
  if (reader) return readerLabels[reader] ?? READER_TYPES.find((t) => t.id === reader)?.label ?? reader.replace(/_/g, " ");
  if (isFileType(doc.filed_as)) return FILE_TYPE_LABEL[doc.filed_as];
  return null;
}
