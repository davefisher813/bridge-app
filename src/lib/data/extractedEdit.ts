// Which fields of a reading staff may correct before it is applied, and
// how a posted correction becomes a new reading (audit crud F5). Plain
// functions over plain objects, outside the "use server" action file, so
// the edit screen builds its form from the same list the action reads
// and a law can drive both.
//
// Only the fields an apply actually writes, or that decide where it
// lands (the school a letter names, the date a metric was measured). The
// result is checked against the category's own Zod schema by the caller
// before it is stored, so this module shapes input and never vouches for
// it.

import { METRICS, SOURCES } from "@/lib/fit/contract";
import type { DocCategoryId } from "@/lib/docai/types";

export type EditKind = "text" | "number" | "date" | "select" | "check";

export interface EditField {
  // The form field name and the path into the reading, dot separated
  // (tests.0.totalScore).
  name: string;
  label: string;
  kind: EditKind;
  // The current value, as the form shows it.
  value: string;
  checked?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
}

const GPA_SCALES = ["4.0", "5.0", "10", "20", "100", "other"];
const OFFER_TYPES: [string, string][] = [
  ["verbal", "Verbal"],
  ["written", "Written"],
  ["scholarship", "Scholarship"],
  ["walk_on", "Walk-On"],
  ["preferred_walk_on", "Preferred Walk-On"],
  ["admission_only", "Admission Only"],
  ["other", "Other"],
];
const AID_TYPES: [string, string][] = [
  ["award_letter", "Award Letter"],
  ["fafsa_sar", "FAFSA Report"],
  ["css_profile", "CSS Profile"],
  ["efc_report", "EFC Report"],
  ["other", "Other"],
];
const RECOMMENDER_TITLES = ["Coach", "Teacher", "Counselor", "Mentor", "Other"];

const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const shown = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function text(name: string, label: string, value: unknown, hint?: string): EditField {
  return { name, label, kind: "text", value: shown(value), hint };
}
function numberField(name: string, label: string, value: unknown, hint?: string): EditField {
  return { name, label, kind: "number", value: typeof value === "number" && Number.isFinite(value) ? String(value) : "", hint };
}
function date(name: string, label: string, value: unknown): EditField {
  return { name, label, kind: "date", value: typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "" };
}
function select(name: string, label: string, value: unknown, options: { value: string; label: string }[]): EditField {
  const v = shown(value);
  return { name, label, kind: "select", value: options.some((o) => o.value === v) ? v : (options[options.length - 1]?.value ?? ""), options };
}

// The correctable fields of one reading, in the order they matter.
export function editableFields(category: DocCategoryId, extracted: Record<string, unknown>): EditField[] {
  const e = extracted;
  switch (category) {
    case "transcript":
      return [
        text("studentName", "Name on Document", e.studentName),
        text("school", "School", e.school, "The high school in the header. It fills a blank High School on the athlete."),
        numberField("gradYear", "Grad Year", e.gradYear),
        numberField("gpa", "GPA", e.gpa, "As printed. It is put on the 4.0 scale when applied."),
        select("gpaScale", "GPA Scale", e.gpaScale, GPA_SCALES.map((s) => ({ value: s, label: s === "other" ? "Other" : s }))),
        { name: "gpaVerified", label: "GPA Printed by the School", kind: "check", value: "", checked: e.gpaVerified === true },
        date("dateOfBirth", "Date of Birth", e.dateOfBirth),
      ];
    case "test_scores": {
      const tests = Array.isArray(e.tests) ? (e.tests as { type?: string; testDate?: string | null; totalScore?: number | null }[]) : [];
      return [
        text("studentName", "Name on Document", e.studentName),
        ...tests.flatMap((t, i) => [
          numberField(`tests.${i}.totalScore`, `${t.type ?? "Test"} ${i + 1} Total`, t.totalScore),
          date(`tests.${i}.testDate`, `${t.type ?? "Test"} ${i + 1} Date`, t.testDate),
        ]),
      ];
    }
    case "offer_letter":
      return [
        text("college", "College", e.college, "Spelled as on file under Schools, so the offer lands on the right one."),
        select("offerType", "Offer Type", e.offerType, opts(OFFER_TYPES)),
        numberField("scholarshipPercent", "Scholarship Percent", e.scholarshipPercent),
        text("coachName", "Coach", e.coachName),
        date("offerDate", "Offer Date", e.offerDate),
      ];
    case "financial_aid":
      return [
        select("documentType", "Document Type", e.documentType, opts(AID_TYPES)),
        text("college", "College", e.college),
        text("academicYear", "Academic Year", e.academicYear),
        numberField("totalCostOfAttendance", "Cost of Attendance", e.totalCostOfAttendance),
        numberField("netCost", "Net Cost", e.netCost),
      ];
    case "recommendation":
      return [
        text("recommenderName", "Recommender", e.recommenderName),
        select("recommenderTitle", "Their Role", e.recommenderTitle, RECOMMENDER_TITLES.map((t) => ({ value: t, label: t }))),
        text("recommenderOrg", "Their Organization", e.recommenderOrg),
        date("letterDate", "Letter Date", e.letterDate),
      ];
    case "metrics": {
      const items = Array.isArray(e.metrics) ? (e.metrics as { key?: string; value?: number }[]) : [];
      const label = new Map(METRICS.map((m) => [m.key, m.unit ? `${m.label} (${m.unit})` : m.label]));
      return [
        select("source", "Measured By", e.source, SOURCES.map((s) => ({ value: s.key, label: s.label }))),
        text("eventName", "Event", e.eventName),
        date("measuredOn", "Measured On", typeof e.measuredOn === "string" && /^\d{4}-\d{2}$/.test(e.measuredOn) ? `${e.measuredOn}-01` : e.measuredOn),
        ...items.map((m, i) => numberField(`metrics.${i}.value`, label.get(String(m.key)) ?? String(m.key ?? "Metric"), m.value)),
      ];
    }
    default:
      return [];
  }
}

// Writes one value at a dot path, copying every object and array on the
// way so the stored reading is never mutated in place.
function setAt(target: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return target;
  const copy: Record<string, unknown> | unknown[] = Array.isArray(target) ? [...(target as unknown[])] : { ...target };
  const key: string | number = Array.isArray(copy) ? Number(head) : head;
  if (rest.length === 0) {
    (copy as Record<string | number, unknown>)[key] = value;
  } else {
    const child = (copy as Record<string | number, unknown>)[key];
    (copy as Record<string | number, unknown>)[key] = setAt((child && typeof child === "object" ? child : {}) as Record<string, unknown>, rest, value);
  }
  return copy as Record<string, unknown>;
}

export interface EditResult {
  ok: boolean;
  extracted: Record<string, unknown>;
  errors: Record<string, string>;
}

// A posted correction applied over the stored reading. Only the fields
// editableFields lists are read, so a crafted post cannot add a key or
// reach one the screen does not offer. A blank box clears the value.
export function applyExtractedEdits(category: DocCategoryId, extracted: Record<string, unknown>, formData: FormData): EditResult {
  const fields = editableFields(category, extracted);
  const errors: Record<string, string> = {};
  let next: Record<string, unknown> = extracted;
  for (const f of fields) {
    const raw = formData.get(f.name);
    let value: unknown;
    if (f.kind === "check") {
      value = raw === "on" || raw === "true";
    } else {
      const s = raw === null ? f.value : String(raw).trim();
      if (f.kind === "number") {
        if (s === "") value = null;
        else {
          const n = Number(s);
          if (!Number.isFinite(n)) {
            errors[f.name] = `${f.label} is a number.`;
            continue;
          }
          value = n;
        }
      } else if (f.kind === "date") {
        if (s !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          errors[f.name] = `${f.label} is a date.`;
          continue;
        }
        value = s === "" ? null : s;
      } else if (f.kind === "select") {
        if (!f.options?.some((o) => o.value === s)) {
          errors[f.name] = `Pick one of the choices for ${f.label}.`;
          continue;
        }
        value = s;
      } else {
        if (s.length > 200) {
          errors[f.name] = `Keep ${f.label} under 200 characters.`;
          continue;
        }
        value = s === "" ? null : s;
      }
    }
    next = setAt(next, f.name.split("."), value);
  }
  return { ok: Object.keys(errors).length === 0, extracted: next, errors };
}
