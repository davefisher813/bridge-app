// What a model actually returns is close to the schema, not identical
// to it. A GPA comes back as "3.5" in quotes, a date as 04/11/2026, an
// empty field as "" or "N/A" instead of null, a boolean as the word
// "true". Every one of those used to fail the schema, and a failed
// schema throws the WHOLE document away: a perfect four-year
// transcript lost over a quoted number.
//
// These are the preprocessors the schemas in schemas.ts wrap their
// fields in. Each one turns the shapes a model plausibly produces into
// the shape the schema wants, and leaves anything else alone so the
// schema still refuses it. Nothing here guesses at a value: a string
// that is not a number stays a string and fails; "N/A" becomes null
// rather than zero.
//
// Pure, like the rest of this directory.

import { z } from "zod";

const EMPTY = new Set(["", "null", "none", "n/a", "na", "unknown", "not listed", "not printed", "not shown", "-", "--"]);

// "" and the phrases a model uses for "it is not on the page" are null.
export function emptyToNull(v: unknown): unknown {
  if (v === undefined) return v;
  if (typeof v === "string" && EMPTY.has(v.trim().toLowerCase())) return null;
  return v;
}

// A number, or a string that is one: "3.5", "1,250", "86%", "$42,000",
// "6.85s", "88 mph". The unit is dropped because the schema names it.
export function toNumber(v: unknown): unknown {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (EMPTY.has(s)) return null;
  const m = s.replace(/[$,]/g, "").match(/^(-?\d+(?:\.\d+)?)\s*(%|s|sec|mph|in|lb|lbs|pts)?$/);
  if (!m) return v;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : v;
}

// A graduation year: 2027, "2027", "Class of 2027", "'27". Null for the
// "not printed" phrases; anything else is left for the schema to refuse.
export function toYear(v: unknown): unknown {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (EMPTY.has(s)) return null;
  const four = s.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  if (four) return Number(four[1]);
  const two = s.match(/^(?:class of\s*)?'?(\d{2})$/);
  if (two) return 2000 + Number(two[1]);
  return v;
}

// A GPA as printed: 3.5, "3.5", "3.5/4.0", "3.5 out of 4", "86.2".
export function toGpa(v: unknown): unknown {
  if (typeof v !== "string") return toNumber(v);
  return toNumber(v.replace(/\s*(?:\/|out of)\s*\d+(?:\.\d+)?\s*$/i, ""));
}

export function toBoolean(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (["true", "yes", "y", "official"].includes(s)) return true;
  if (["false", "no", "n", "unofficial"].includes(s)) return false;
  if (EMPTY.has(s)) return null;
  return v;
}

const MONTHS: Record<string, string> = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03", apr: "04", april: "04", may: "05",
  jun: "06", june: "06", jul: "07", july: "07", aug: "08", august: "08", sep: "09", sept: "09", september: "09",
  oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12",
};

function pad(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

// A date the way documents print them, as YYYY-MM-DD, YYYY-MM or YYYY.
// Returns null for the "not printed" phrases and leaves an
// unrecognisable string alone so the schema can refuse it.
//
// American order (month first) is assumed for a slashed date, because
// every document this reads is from a US school, a US test agency or a
// US college. A slashed date whose first number cannot be a month is
// read day-first instead of being refused.
export function normalizeDate(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  const low = s.toLowerCase();
  if (EMPTY.has(low)) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2]!)}`;
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
  if (/^\d{4}$/.test(s)) return s;

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [month, day] = a > 12 && b <= 12 ? [b, a] : [a, b];
    return `${m[3]}-${pad(String(month))}-${pad(String(day))}`;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[2]}-${pad(m[1]!)}`;

  // "April 11, 2026", "Apr 11 2026", "11 April 2026", "August 2026".
  m = low.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1]!]) return `${m[3]}-${MONTHS[m[1]!]}-${pad(m[2]!)}`;
  m = low.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[2]!]) return `${m[3]}-${MONTHS[m[2]!]}-${pad(m[1]!)}`;
  m = low.match(/^([a-z]+)\.?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1]!]) return `${m[2]}-${MONTHS[m[1]!]}`;

  return v;
}

// A date the calendar has. A regex says 2026-02-30 is a date; Postgres
// does not, and a rejected row used to take the rest of the write down
// with it.
export function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

// A dated string is one of YYYY-MM-DD (a real day), YYYY-MM or YYYY.
export function isDatedString(s: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isRealDate(s);
  if (/^\d{4}-\d{2}$/.test(s)) return Number(s.slice(5)) >= 1 && Number(s.slice(5)) <= 12;
  return /^\d{4}$/.test(s);
}

// Whole days between an ISO day and now; positive when the day is in
// the future.
export function daysAhead(iso: string, now = new Date()): number {
  const day = /^\d{4}-\d{2}$/.test(iso) ? `${iso}-01` : /^\d{4}$/.test(iso) ? `${iso}-01-01` : iso;
  return Math.round((new Date(`${day}T00:00:00Z`).getTime() - now.getTime()) / 86400000);
}

// ── Schema building blocks ──────────────────────────────────────────
// Each wraps the strict type in the preprocessor above, so a schema
// reads as strict while accepting what a model actually sends.

export const num = () => z.preprocess(toNumber, z.number().finite());
export const int = () => z.preprocess((v) => {
  const n = toNumber(v);
  return typeof n === "number" ? Math.round(n) : n;
}, z.number().int());
export const bool = () => z.preprocess(toBoolean, z.boolean());
export const str = () => z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string());
// A string that may be missing from the page: "" and "N/A" read as null.
export const strOrNull = () => z.preprocess((v) => emptyToNull(typeof v === "string" ? v.trim() : v), z.string().min(1).nullable());
// A printed date, normalised, and refused if it is not a calendar date.
export const dated = () => z.preprocess(normalizeDate, z.string().refine(isDatedString, "not a date"));
export const datedOrNull = () => z.preprocess(normalizeDate, z.string().refine(isDatedString, "not a date").nullable());

// An enum with a safe default. For a field where an unlisted value
// should not throw the whole document away: a course load of "Honors"
// becomes the nearest listed value's absence, not a failed transcript.
// Matching is case-insensitive and ignores punctuation, so "Walk-On"
// and "walk_on" are the same choice.
export function enumOr<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byCanon = new Map<string, T[number]>(values.map((v) => [canon(v), v] as const));
  return z.preprocess((v) => {
    if (typeof v !== "string") return v == null ? fallback : v;
    const c = canon(v);
    const exact = byCanon.get(c);
    if (exact) return exact;
    // "ACT Composite" is ACT, "walk-on offer" is walk_on: the longest
    // listed value the text starts with.
    const prefix = [...byCanon.entries()].filter(([k]) => k && c.startsWith(k)).sort((a, b) => b[0].length - a[0].length)[0];
    return prefix ? prefix[1] : fallback;
  }, z.enum(values as unknown as [T[number], ...T[number][]]));
}
