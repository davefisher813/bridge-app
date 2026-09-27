"use client";

import { useActionState, useState } from "react";
import type { EnrollActionState } from "@/lib/actions/enrollment";
import { Button, Field, Form, SelectField, SuggestField, TextAreaField } from "@/components/kit";
import { nameKey } from "@/lib/lookup/nameKey";
import { SCHOOL_DIVISIONS } from "@/lib/validation/school";

type ServerAction = (prevState: EnrollActionState, formData: FormData) => Promise<EnrollActionState>;

const EMPTY_STATE: EnrollActionState = { errors: {} };

// schoolChoice is null when a Committed target already names the school.
// Otherwise the school is asked for here: the athlete's own Current
// School when one is on their record, or any school on file.
export interface EnrollSchoolChoice {
  currentSchool: string | null;
  schools: { id: string; name: string; division: string }[];
  // The schools row the athlete's Current School was matched to, when
  // it was (Stage 4): filled in already, so the enrollment names that row.
  selectedId?: string | null;
  // A name not on file can be added here, with its division, by someone
  // who edits the shared directory (Dave, 2026-09-27: "Should be able
  // to add a school").
  canAddSchool?: boolean;
}

// Mark Enrolled and Mark Graduated: a school when nothing on file names
// one, a date, and an optional note for the athlete's staff log.
export function EnrollForm({
  action,
  today,
  schoolChoice,
  schoolLabel = "Enrolled At",
  dateName = "enrolledOn",
  dateLabel = "Enrolled On",
  submitLabel = "Mark Enrolled",
}: {
  action: ServerAction;
  today: string;
  schoolChoice: EnrollSchoolChoice | null;
  schoolLabel?: string;
  dateName?: string;
  dateLabel?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string) => (state.values?.[key] === undefined ? "" : String(state.values[key]));
  const preset = schoolChoice?.selectedId ? (schoolChoice.schools.find((s) => s.id === schoolChoice.selectedId)?.name ?? "") : "";
  const [typed, setTyped] = useState(value("schoolName") || preset);
  const unknownName = !!schoolChoice && typed.trim() !== "" && !schoolChoice.schools.some((s) => nameKey(s.name) === nameKey(typed));

  return (
    <Form action={formAction} error={state.errors.form}>
      {schoolChoice && (
        <>
          {/* Type to search every school on file (Dave, 2026-09-27: a
              list of every school was a scroll, not a pick). */}
          <SuggestField
            name="schoolName"
            label={schoolLabel}
            placeholder={schoolChoice.currentSchool ?? "Search Schools"}
            suggestions={schoolChoice.schools.map((s) => ({ value: s.name, label: s.division }))}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            hint={unknownName ? (schoolChoice.canAddSchool ? "Not on file yet. It will be added with the division below." : "Not on file yet. An Admin can add it under Schools.") : "Start typing to search."}
            error={err("schoolId")}
            required={!schoolChoice.currentSchool}
          />
          {unknownName && schoolChoice.canAddSchool && (
            <SelectField name="division" label="Division" defaultValue={value("division")} error={err("division")} required>
              <option value="">Pick a Division</option>
              {SCHOOL_DIVISIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </SelectField>
          )}
        </>
      )}
      <Field name={dateName} label={dateLabel} type="date" defaultValue={value(dateName) || today} error={err(dateName)} required />
      <TextAreaField name="note" label="Note" hint="Optional. Admins only, filed on the athlete's notes." maxLength={4000} defaultValue={value("note")} error={err("note")} />
      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
