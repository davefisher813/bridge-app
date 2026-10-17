import { readableFileName } from "@/lib/documents/displayName";

// Files that are plainly the same document under different names stack
// into one row ("bridge-assignments-johan-diaz.pdf", "assignment-2-johan-diaz.pdf"
// and "Johan Diaz - Assignment 2.pdf"; "ncaa-eligibility-junior-pena.pdf" and
// "Junior Pena - NCAA Eligibility Center.pdf"), whatever their state or
// whether either is linked to an athlete. The key is the words left in
// the readable file name once filler and numbers are taken out, in a
// fixed order, kept apart by kind (PDFs with PDFs, spreadsheets with
// spreadsheets). The same words are the search that lists every one.
const NOISE = new Set(["bridge", "assignment", "assignments", "copy", "final", "center", "the", "and", "of", "ii", "iii", "iv", "jr", "sr"]);

function kindOf(fileName: string, mediaType?: string | null): string {
  const m = `${mediaType ?? ""} ${fileName}`;
  if (/pdf/i.test(m)) return "pdf";
  if (/sheet|excel|csv|\.(xlsx?|csv)$/i.test(m)) return "sheet";
  if (/image|\.(jpe?g|png|heic|gif)$/i.test(m)) return "image";
  if (/word|\.docx?$/i.test(m)) return "doc";
  return "other";
}

export function assignmentStackKey(fileName: string, mediaType?: string | null): { key: string; who: string } | null {
  const words = readableFileName(fileName)
    .toLowerCase()
    .replace(/[^a-z' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w) && w.length > 1);
  // One word is too little to say two files are the same document.
  if (words.length < 2) return null;
  const sorted = [...new Set(words)].sort();
  return { key: `${kindOf(fileName, mediaType)}|${sorted.join(" ")}`, who: sorted.join(" ") };
}

const RANK: Record<string, number> = { needs_review: 0, ready: 1, uploaded: 2, processing: 3, archived: 4 };

// Stacks the rows that share a key. The one that most needs attention
// leads (newest breaks a tie); the rest are counted behind it.
export function stackAssignments<T extends { id: string; file_name: string; media_type?: string | null; lifecycle?: string | null; created_at: string }>(rows: T[]): { hidden: Set<string>; behind: Map<string, { others: T[]; who: string }> } {
  const groups = new Map<string, { who: string; docs: T[] }>();
  for (const r of rows) {
    const k = assignmentStackKey(r.file_name, r.media_type);
    if (!k) continue;
    const g = groups.get(k.key) ?? { who: k.who, docs: [] };
    g.docs.push(r);
    groups.set(k.key, g);
  }
  const hidden = new Set<string>();
  const behind = new Map<string, { others: T[]; who: string }>();
  for (const g of groups.values()) {
    if (g.docs.length < 2) continue;
    const sorted = [...g.docs].sort((a, b) => (RANK[a.lifecycle ?? ""] ?? 9) - (RANK[b.lifecycle ?? ""] ?? 9) || b.created_at.localeCompare(a.created_at));
    const [lead, ...others] = sorted as [T, ...T[]];
    behind.set(lead.id, { others, who: g.who });
    for (const o of others) hidden.add(o.id);
  }
  return { hidden, behind };
}
