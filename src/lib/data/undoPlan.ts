// Deciding what an undo may put back, separated from the writing of it.
//
// This lives outside src/lib/actions/documents.ts because that file is a
// "use server" module, where every export has to be an async server
// action, so nothing in it can be unit tested directly. The rule here is
// the part that is easy to get subtly wrong and expensive to get wrong
// in production, so it is the part that gets tests.
//
// The rule: restore a field only when its current value is still what
// this document wrote. If somebody corrected the GPA by hand after the
// apply, their value is the current truth, and reverting it to a number
// from before the document existed would be a worse mistake than
// leaving it.

export interface FieldChange {
  before: unknown;
  after: unknown;
}

export interface UndoPlan {
  // Column to the value it should be set back to.
  restore: Record<string, unknown>;
  // Columns deliberately left alone because they have changed since.
  kept: string[];
}

// Supabase returns numeric(3,2) as a string and dates as strings, so
// `===` answers "is this still the value we wrote" wrong for exactly the
// columns an undo touches. 3.1 and "3.10" are the same stored value.
export function sameStoredValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    // null and undefined both mean "nothing stored", and which one comes
    // back depends on whether the column was selected.
    const aEmpty = a === null || a === undefined;
    const bEmpty = b === null || b === undefined;
    return aEmpty && bEmpty;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  const na = Number(a);
  const nb = Number(b);
  // Number("") is 0 and Number(" ") is 0, so empty strings must not fall
  // into the numeric branch and compare equal to zero.
  const numeric = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
  if (numeric(a) && numeric(b)) return na === nb;
  return String(a) === String(b);
}

// The same stored value, all the way down: a jsonb column (a target's
// aid) comes back from Postgres with its keys in Postgres's own order, so
// comparing JSON.stringify of the two never matched and an undo never
// put the aid back. Objects compare key by key in any order, arrays item
// by item in order, and each leaf as sameStoredValue does.
export function sameJsonValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameJsonValue(v, b[i]));
  }
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
  if (isObj(a) || isObj(b)) {
    if (!isObj(a) || !isObj(b)) return false;
    // A key holding null or nothing is the same as a missing key.
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!sameJsonValue(a[k], b[k])) return false;
    return true;
  }
  return sameStoredValue(a, b);
}

export function planFieldRestore(current: Record<string, unknown> | null, fields: Record<string, FieldChange>): UndoPlan {
  const restore: Record<string, unknown> = {};
  const kept: string[] = [];

  for (const [column, change] of Object.entries(fields ?? {})) {
    const now = current?.[column] ?? null;
    if (sameStoredValue(now, change.after)) restore[column] = change.before ?? null;
    else kept.push(column);
  }

  return { restore, kept };
}

export function readableColumn(column: string): string {
  if (column === "gpa") return "GPA";
  if (column === "gpa_verified") return "verified flag";
  if (column === "date_of_birth") return "date of birth";
  return column.replace(/_/g, " ");
}

// ── Undo for a bulk advisor change ───────────────────────────────────
// One bulk Assign Advisor changes many athletes at once; one Undo puts
// every athlete's previous advisor back. As with a document's fields, an
// athlete is restored only while their advisor is still what the bulk
// action set: if somebody changed it by hand since, their choice is the
// current truth and is left alone.

export interface AdvisorUndoEntry {
  athleteId: string;
  // Who advised before; null for nobody.
  before: string | null;
}

export interface AdvisorUndo {
  // Who the bulk action assigned; null when it cleared.
  assigned: string | null;
  entries: AdvisorUndoEntry[];
}

export interface AdvisorRestorePlan {
  // One group per previous advisor, so each restore is one write.
  groups: { advisorId: string | null; athleteIds: string[] }[];
  // Left alone: their advisor changed since, or they are gone.
  kept: string[];
}

export function planAdvisorRestore(undo: AdvisorUndo, current: ReadonlyMap<string, string | null>): AdvisorRestorePlan {
  const byAdvisor = new Map<string | null, string[]>();
  const kept: string[] = [];
  for (const e of undo.entries) {
    if (current.has(e.athleteId) && (current.get(e.athleteId) ?? null) === undo.assigned) byAdvisor.set(e.before, [...(byAdvisor.get(e.before) ?? []), e.athleteId]);
    else kept.push(e.athleteId);
  }
  return { groups: [...byAdvisor.entries()].map(([advisorId, athleteIds]) => ({ advisorId, athleteIds })), kept };
}

// The Undo travels in the page's query string, as the single-athlete one
// does, so nothing is stored. Ids lose their dashes to stay short: 200
// athletes is about 7KB. Shape: <assigned|none>~<before|none>:<id>,<id>;<before|none>:<id>
const HEX32 = /^[0-9a-f]{32}$/;
const dashless = (id: string) => id.replace(/-/g, "").toLowerCase();
const dashed = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export function encodeAdvisorUndo(undo: AdvisorUndo): string {
  const groups = new Map<string, string[]>();
  for (const e of undo.entries) {
    const k = e.before ? dashless(e.before) : "none";
    groups.set(k, [...(groups.get(k) ?? []), dashless(e.athleteId)]);
  }
  const body = [...groups.entries()].map(([k, ids]) => `${k}:${ids.join(",")}`).join(";");
  return `${undo.assigned ? dashless(undo.assigned) : "none"}~${body}`;
}

export function decodeAdvisorUndo(token: unknown): AdvisorUndo | null {
  if (typeof token !== "string" || token.length > 12000) return null;
  const [head, body, ...extra] = token.split("~");
  if (extra.length || head === undefined || !body) return null;
  if (head !== "none" && !HEX32.test(head)) return null;
  const entries: AdvisorUndoEntry[] = [];
  for (const group of body.split(";")) {
    const [who, list, ...more] = group.split(":");
    if (more.length || who === undefined || !list) return null;
    if (who !== "none" && !HEX32.test(who)) return null;
    for (const id of list.split(",")) {
      if (!HEX32.test(id)) return null;
      entries.push({ athleteId: dashed(id), before: who === "none" ? null : dashed(who) });
    }
  }
  if (entries.length === 0 || entries.length > 200) return null;
  return { assigned: head === "none" ? null : dashed(head), entries };
}
