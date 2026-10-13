// A document's title (migration 0069): what it is, in place of the file
// name it came in with. Pure, so the action and a law share one rule.

export const MAX_DOCUMENT_TITLE = 200;

export type TitleParse = { ok: true; title: string | null } | { ok: false; error: string };

// Spaces collapsed and trimmed; blank means no title (the file name
// shows). Same bounds as the column's check.
export function parseDocumentTitle(raw: unknown): TitleParse {
  const title = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: true, title: null };
  if (title.length > MAX_DOCUMENT_TITLE) return { ok: false, error: `A title is at most ${MAX_DOCUMENT_TITLE} characters.` };
  return { ok: true, title };
}

// What a document is called on a screen: its title, else its file name.
export function documentDisplayName(doc: { title?: string | null; file_name: string }): string {
  return doc.title?.trim() ? doc.title : doc.file_name;
}
