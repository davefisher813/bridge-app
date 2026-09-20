"use client";

import { useActionState } from "react";
import type { SchoolActionState } from "@/lib/actions/schools";
import { Button, Field, Form, Grid2, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: SchoolActionState, formData: FormData) => Promise<SchoolActionState>;

const EMPTY_STATE: SchoolActionState = { errors: {} };

// What this org knows privately about a shared school. Positions of need
// move the match score for an athlete whose position and grad year fit
// (docs/MATCHING_CONTRACT.md sections 3 and 4).
export function OrgSchoolNoteForm({
  action,
  initialValues = {},
}: {
  action: ServerAction;
  initialValues?: { coachName?: string; coachEmail?: string; positionsOfNeed?: string; notes?: string };
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <Field name="coachName" label="Head Coach" defaultValue={initialValues.coachName ?? ""} error={err("coachName")} />
        <Field name="coachEmail" label="Coach Email" type="email" inputMode="email" autoCapitalize="none" defaultValue={initialValues.coachEmail ?? ""} error={err("coachEmail")} />
      </Grid2>
      <Field
        name="positionsOfNeed"
        label="Positions of Need"
        hint="Position and grad year, separated by semicolons. For example, SS 2027; RHP 2028."
        defaultValue={initialValues.positionsOfNeed ?? ""}
        error={err("positionsOfNeed")}
      />
      <TextAreaField name="notes" label="Notes" rows={3} defaultValue={initialValues.notes ?? ""} error={err("notes")} />
      <Button disabled={pending}>{pending ? "Saving..." : "Save Notes"}</Button>
    </Form>
  );
}
