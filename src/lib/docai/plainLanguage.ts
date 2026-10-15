// Extraction text is for people. A model sometimes narrates its own
// output ("so studentName is null", "the ADVISOR column is blank"); that
// is internal field talk and must not reach a document card. Pure, so the
// screen and the tests share it.
//
// A sentence that talks about the data's shape is dropped whole: an empty
// thing is better left out than described as a null or a column.

// null / undefined as words, a camelCase field name (studentName), a
// snake_case name (student_name), "column(s)", "field(s)", "JSON", "schema".
const DEV_WORDS = /\b(null|undefined|json|schema|columns?|fields?)\b/i;
const DEV_NAMES = /\b[a-z]+[A-Z][A-Za-z]+\b|\b[a-z]+_[a-z_]+\b/;

function sentencesOf(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]*(?:\s+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

export function hasDeveloperTalk(text: string): boolean {
  return DEV_WORDS.test(text) || DEV_NAMES.test(text);
}

// The text with any sentence of internal field talk removed. Empty when
// nothing user-facing is left.
export function plainText(text: string): string {
  if (!hasDeveloperTalk(text)) return text;
  return sentencesOf(text)
    .filter((s) => !hasDeveloperTalk(s))
    .join(" ");
}

// For lists of short lines (key facts, warnings): drop the lines that talk
// that way.
export function plainLines(lines: string[]): string[] {
  return lines.map(plainText).filter((l) => l.trim() !== "");
}

// Said to the model with every extraction (src/lib/docai/categories.ts).
export const PLAIN_LANGUAGE_RULE =
  "- Every sentence you write (summary, notes, key facts, warnings) is for a parent or coach, in plain words. Never mention field names, JSON, null, columns or the schema. When something is missing from the page, say what is missing in plain words (\"the page does not print a student name\") or leave it out.\n";
