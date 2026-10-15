// Undo for a bulk Suggest Who and What. Pure, so it is testable without a
// database (the action file is "use server" and exports only actions).
//
// A refresh remembers what the document said just before (SuggestionBefore,
// written into documents.suggestion_before with the run's id and the
// suggested_at it wrote). Undo puts those fields back, for exactly the
// documents the run touched, and only where nothing has happened since:
//
//   - the document was refreshed again since (suggested_at moved on), or
//   - a person confirmed it or marked it not about an athlete since.
//
// Either way the person's later word or the newer suggestion stays.
// A bulk Suggest never links or confirms anything, so there is nothing to
// unlink; the link and the confirmed athlete are never touched here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SuggestionFields {
  suggested_type: string | null;
  suggested_type_confidence: number | null;
  suggested_type_reasons: string[];
  identity_status: string | null;
  identity_candidates: unknown[];
  suggested_at: string | null;
}

export interface SuggestionBefore extends SuggestionFields {
  // The bulk run that replaced these fields; null for a single refresh.
  run: string | null;
  // The suggested_at the refresh wrote, to tell "still that refresh" later.
  replaced_at: string;
}

export interface SuggestUndoToken {
  run: string;
  ids: string[];
}

export function encodeSuggestUndo(t: SuggestUndoToken): string {
  return `${t.run}.${t.ids.join(",")}`;
}

export function decodeSuggestUndo(raw: unknown): SuggestUndoToken | null {
  if (typeof raw !== "string") return null;
  const [run, list, ...rest] = raw.split(".");
  if (rest.length > 0 || !run || !list || !UUID.test(run)) return null;
  const ids = list.split(",");
  if (ids.length === 0 || ids.length > 200 || !ids.every((id) => UUID.test(id))) return null;
  return { run, ids: [...new Set(ids)] };
}

// What a row may carry before it has ever been suggested for.
export type MaybeSuggestionFields = { [K in keyof SuggestionFields]?: SuggestionFields[K] | null };

export function snapshotBefore(doc: MaybeSuggestionFields, run: string | null, replacedAt: string): SuggestionBefore {
  return {
    suggested_type: doc.suggested_type ?? null,
    suggested_type_confidence: doc.suggested_type_confidence ?? null,
    suggested_type_reasons: doc.suggested_type_reasons ?? [],
    identity_status: doc.identity_status ?? null,
    identity_candidates: doc.identity_candidates ?? [],
    suggested_at: doc.suggested_at ?? null,
    run,
    replaced_at: replacedAt,
  };
}

// The database hands a timestamp back as "2026-10-15T17:55:32.123+00:00"
// where the app wrote "2026-10-15T17:55:32.123Z": the same instant, a
// different string. Comparing strings called every Undo "changed since".
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isNaN(ta) || Number.isNaN(tb) ? a === b : ta === tb;
}

const DECIDED = new Set(["confirmed", "not_an_athlete"]);

export interface UndoRow extends SuggestionFields {
  id: string;
  suggestion_before: SuggestionBefore | null;
}

export type UndoOutcome = { id: string; restore: SuggestionFields & { suggestion_before: null } } | { id: string; kept: "not_this_run" | "changed_since" };

// What to write back for each document, or why it is left alone.
export function planSuggestUndo(run: string, rows: UndoRow[]): UndoOutcome[] {
  return rows.map((r): UndoOutcome => {
    const b = r.suggestion_before;
    if (!b || b.run !== run) return { id: r.id, kept: "not_this_run" };
    const refreshedSince = !sameInstant(r.suggested_at, b.replaced_at);
    const decidedSince = DECIDED.has(r.identity_status ?? "") && !DECIDED.has(b.identity_status ?? "");
    if (refreshedSince || decidedSince) return { id: r.id, kept: "changed_since" };
    return {
      id: r.id,
      restore: {
        suggested_type: b.suggested_type,
        suggested_type_confidence: b.suggested_type_confidence,
        suggested_type_reasons: b.suggested_type_reasons,
        // A decided document keeps its decision; the run never changed it.
        identity_status: DECIDED.has(r.identity_status ?? "") ? r.identity_status : b.identity_status,
        identity_candidates: b.identity_candidates,
        suggested_at: b.suggested_at,
        suggestion_before: null,
      },
    };
  });
}
