import { readableFileName } from "@/lib/documents/displayName";

// An athlete's assignment files arrive under different names
// ("bridge-assignments-johan-diaz.pdf", "assignment-2-johan-diaz.pdf",
// "Johan Diaz - Assignment 2.pdf") and in different states, so a title
// match never catches them. They stack on what is left of the file name
// once the assignment words and numbers are taken out, kept apart by
// kind (PDFs with PDFs, spreadsheets with spreadsheets). The remainder is
// also the search that lists every one of them.
const NOISE = /\b(bridge|assignments?|copy|final|v?\d+)\b/gi;

export function assignmentStackKey(fileName: string, mediaType?: string | null): { key: string; who: string } | null {
  if (!/assignment/i.test(fileName)) return null;
  const who = readableFileName(fileName).replace(NOISE, " ").replace(/[^A-Za-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!who) return null;
  const kind = /pdf/i.test(mediaType ?? fileName) ? "pdf" : /sheet|excel|csv/i.test(mediaType ?? "") || /\.(xlsx?|csv)$/i.test(fileName) ? "sheet" : "other";
  return { key: `${kind}|${who.toLowerCase()}`, who };
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
