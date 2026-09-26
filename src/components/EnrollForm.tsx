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

export function EnrollForm({ action, today, schoolChoice }: { action: ServerAction; today: string; schoolChoice: EnrollSchoolChoice | null }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string) => (state.values?.[key] === undefined ? "" : String(state.values[key]));

  return (
    <Form action={formAction} error={state.errors.form}>
      {schoolChoice && (
        <SelectField name="schoolId" label="Enrolled At" defaultValue={value("schoolId")} error={err("schoolId")} required={!schoolChoice.currentSchool}>
          <option value="">{schoolChoice.currentSchool ?? "Pick a School"}</option>
          {schoolChoice.schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
      )}
      <Field name="enrolledOn" label="Enrolled On" type="date" defaultValue={value("enrolledOn") || today} error={err("enrolledOn")} required />
      <Button disabled={pending}>{pending ? "Marking Enrolled..." : "Mark Enrolled"}</Button>
    </Form>
  );
}
