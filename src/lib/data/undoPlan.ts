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
