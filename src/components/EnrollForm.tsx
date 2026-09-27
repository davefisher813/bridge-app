"use client";

import { useActionState } from "react";
import type { EnrollActionState } from "@/lib/actions/enrollment";
import { Button, Field, Form, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: EnrollActionState, formData: FormData) => Promise<EnrollActionState>;

const EMPTY_STATE: EnrollActionState = { errors: {} };

// schoolChoice is null when a Committed target already names the school.
// Otherwise the school is asked for here: the athlete's own Current
// School when one is on their record, or any school on file.
export interface EnrollSchoolChoice {
  currentSchool: string | null;
  schools: { id: string; label: string }[];
  // The schools row the athlete's Current School was matched to, when
  // it was (Stage 4): picked already, so the enrollment names that row.
  selectedId?: string | null;
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

  return (
    <Form action={formAction} error={state.errors.form}>
      {schoolChoice && (
        <SelectField name="schoolId" label={schoolLabel} defaultValue={value("schoolId") || (schoolChoice.selectedId && schoolChoice.schools.some((s) => s.id === schoolChoice.selectedId) ? schoolChoice.selectedId : "")} error={err("schoolId")} required={!schoolChoice.currentSchool}>
          <option value="">{schoolChoice.currentSchool ?? "Pick a School"}</option>
          {schoolChoice.schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
      )}
      <Field name={dateName} label={dateLabel} type="date" defaultValue={value(dateName) || today} error={err(dateName)} required />
      <TextAreaField name="note" label="Note" hint="Optional. Staff only, filed on the athlete's notes." maxLength={4000} defaultValue={value("note")} error={err("note")} />
      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
