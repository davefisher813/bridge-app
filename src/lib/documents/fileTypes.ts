// Document types the reader does not read (migration 0054). A board's
// bylaws or an athlete's profile sheet is stored and labelled, never read:
// there is no reading schema for it and nothing on an athlete it would
// fill. The reader's own six types stay in src/lib/docai/categories.ts.

export const FILE_TYPES = ["board_document", "athlete_profile", "other"] as const;
export type FileTypeId = (typeof FILE_TYPES)[number];

export const FILE_TYPE_LABEL: Record<FileTypeId, string> = {
  board_document: "Board Document",
  athlete_profile: "Athlete Profile",
  other: "Other",
};

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
  const reader = doc.category ?? doc.requested_category ?? null;
  if (reader) return readerLabels[reader] ?? reader.replace(/_/g, " ");
  if (isFileType(doc.filed_as)) return FILE_TYPE_LABEL[doc.filed_as];
  return null;
}
