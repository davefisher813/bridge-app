// Name matching, one rule everywhere. Pure: no database, no framework.
//
// A school or person typed as " Fixture High School" and one on file as
// "fixture high school" are the same name. The key is the one Postgres
// computes for school_name_key (migration 0008) and high_schools.name_key
// (migration 0040): lower(btrim(name)). The same key is used when the
// eligibility loader matches a course's school to a grading scale
// (src/lib/data/loadEligibility.ts), so a match here is a match there.

// Postgres btrim() with no second argument trims spaces only, and
// lower() lowercases. JavaScript's trim() also trims tabs and newlines,
// which Postgres would keep; a name with a trailing tab is not a name
// anyone typed on purpose, so trimming it here too is the kinder match.
export function nameKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

// An ilike pattern that matches the text literally, ignoring case. In
// PostgREST's ilike, % and _ are wildcards and \ escapes, so a school
// named "100% Prep" or "St_Mary" would otherwise match far more than
// itself.
export function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// The one row a typed name means, or null when it could mean more than
// one. Rows whose key differs from the name's are ignored, so the input
// can be a loose ilike result. When several rows share the name, the
// one in `preferState` wins if it is the only one there; otherwise the
// name is ambiguous and nothing is picked.
export function pickUnique<T extends { name: string; state?: string | null }>(rows: readonly T[], name: string, preferState?: string | null): T | null {
  const key = nameKey(name);
  if (!key) return null;
  const same = rows.filter((r) => nameKey(r.name) === key);
  if (same.length === 1) return same[0];
  if (same.length === 0) return null;
  const want = (preferState ?? "").trim().toUpperCase();
  if (!want) return null;
  const inState = same.filter((r) => (r.state ?? "").trim().toUpperCase() === want);
  return inState.length === 1 ? inState[0] : null;
}
