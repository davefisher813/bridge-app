"use client";

import { useActionState } from "react";
import type { EnrollActionState } from "@/lib/actions/enrollment";
import { Button, Field, Form, SelectField } from "@/components/kit";

type ServerAction = (prevState: EnrollActionState, formData: FormData) => Promise<EnrollActionState>;

const EMPTY_STATE: EnrollActionState = { errors: {} };

// schoolChoice is null when a Committed target already names the school.
// Otherwise the school is asked for here: the athlete's own Current
// School when one is on their record, or any school on file.
export interface EnrollSchoolChoice {
  currentSchool: string | null;
  schools: { id: string; label: string }[];
}

// Mark Enrolled and Mark Graduated: a school when nothing on file names
// one, and a date.
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
        <SelectField name="schoolId" label={schoolLabel} defaultValue={value("schoolId")} error={err("schoolId")} required={!schoolChoice.currentSchool}>
          <option value="">{schoolChoice.currentSchool ?? "Pick a School"}</option>
          {schoolChoice.schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
      )}
      <Field name={dateName} label={dateLabel} type="date" defaultValue={value(dateName) || today} error={err(dateName)} required />
      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
