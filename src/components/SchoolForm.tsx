"use client";

import { useActionState } from "react";
import { SCHOOL_DIVISIONS } from "@/lib/validation/school";
import type { SchoolActionState } from "@/lib/actions/schools";
import { Button, Field, Form, Grid2, SelectField } from "@/components/kit";

type ServerAction = (prevState: SchoolActionState, formData: FormData) => Promise<SchoolActionState>;

const EMPTY_STATE: SchoolActionState = { errors: {} };

export function SchoolForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="School name" error={err("name")} placeholder="Test University" required />
      <Grid2>
        <SelectField name="division" label="Division" error={err("division")} defaultValue="D1">
          {SCHOOL_DIVISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
        <Field name="conference" label="Conference" placeholder="Ivy League" />
      </Grid2>
      <Field name="sportsSponsored" label="Sports sponsored" placeholder="baseball, softball" hint="Comma separated." />
      <Button disabled={pending}>{pending ? "Adding..." : "Add School"}</Button>
    </Form>
  );
}
