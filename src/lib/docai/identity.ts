// Holding a reading to what is printed on the page (Oct 11 live test).
// Two readings of one file named two different schools, one of them
// printed nowhere on it; a transcript that prints no name was matched to
// an athlete by name; a recommender's role flipped between readings.
// Pure: no model call, no database. The pipeline hands it a reading,
// the model's own quotes, and the reading it replaces.

// The fields that say whose document this is and where it is from. A
// wrong one misfiles a document; a value here is only kept if the model
// could quote the printed line it came from.
export const IDENTITY_FIELDS = ["studentName", "school", "college", "recommenderName", "recommenderOrg"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

// What a re-read is compared on: the identity fields plus the ones a
// reviewer would read as a different letter if they changed.
export const COMPARED_FIELDS = [...IDENTITY_FIELDS, "recommenderTitle", "gradYear"] as const;

export const FIELD_LABEL: Record<string, string> = {
  studentName: "student name",
  school: "school",
  college: "college",
  recommenderName: "recommender",
  recommenderOrg: "recommender's organization",
  recommenderTitle: "recommender's role",
  gradYear: "class year",
};

// The prefix every contradiction warning starts with, so the review
// screen can lift them out and show them first.
export const CONTRADICTION_PREFIX = "Contradicts the earlier reading:";

const norm = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const present = (v: unknown): v is string | number => (typeof v === "string" && v.trim() !== "") || typeof v === "number";

// Each identity value the model returned without a quote that contains
// it. The quote is the model's own, so this cannot prove a value is on
// the page; what it catches is a value the model could not even point
// to, which is what an invented school looks like.
export function unquotedIdentity(extracted: Record<string, unknown>): IdentityField[] {
  const evidence = (extracted.evidence && typeof extracted.evidence === "object" ? extracted.evidence : {}) as Record<string, unknown>;
  return IDENTITY_FIELDS.filter((f) => {
    const value = extracted[f];
    if (!present(value)) return false;
    const quote = evidence[f];
    if (typeof quote !== "string" || !quote.trim()) return true;
    return !norm(quote).includes(norm(String(value)));
  });
}

export interface Contradiction {
  field: string;
  before: string;
  after: string;
}

// The fields a re-read changed. A value that appears or disappears
// counts: a reading that named a school and one that says none is
// printed are not the same reading.
export function contradictions(prior: Record<string, unknown> | null | undefined, next: Record<string, unknown>): Contradiction[] {
  if (!prior) return [];
  const out: Contradiction[] = [];
  for (const f of COMPARED_FIELDS) {
    const a = present(prior[f]) ? String(prior[f]) : "";
    const b = present(next[f]) ? String(next[f]) : "";
    if (!a && !b) continue;
    if (norm(a) === norm(b)) continue;
    out.push({ field: f, before: a || "nothing", after: b || "nothing" });
  }
  return out;
}

export function contradictionWarning(c: Contradiction): string {
  return `${CONTRADICTION_PREFIX} the ${FIELD_LABEL[c.field] ?? c.field} was "${c.before}", this reading says "${c.after}". Check the page before applying.`;
}
