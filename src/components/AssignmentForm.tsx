"use client";

import { useActionState } from "react";
import {
  ASSIGNMENT_CATEGORIES,
  ASSIGNMENT_CATEGORY_LABEL,
  ASSIGNMENT_KINDS,
  ASSIGNMENT_KIND_LABEL,
  ASSIGNMENT_TEXT_MAX,
  ASSIGNMENT_TITLE_MAX,
} from "@/lib/data/assignments";
import type { AssignmentActionState } from "@/lib/actions/assignments";
import { Button, Field, Form, Grid2, SelectField, TextAreaField } from "@/components/kit";

// A new assignment for an athlete (migration 0046). Admins only. The
// Kind decides what the athlete login is asked for: Upload asks for a
// file and a note, the others take a note only.

type ServerAction = (prevState: AssignmentActionState, formData: FormData) => Promise<AssignmentActionState>;

const EMPTY_STATE: AssignmentActionState = { errors: {} };

export function AssignmentForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="title" label="Title" maxLength={ASSIGNMENT_TITLE_MAX} required error={state.errors.title} />
      <TextAreaField
        name="instructions"
        label="Instructions"
        maxLength={ASSIGNMENT_TEXT_MAX}
        error={state.errors.instructions}
      />
      <Grid2>
        <SelectField name="category" label="Category" defaultValue="other" error={state.errors.category}>
          {ASSIGNMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {ASSIGNMENT_CATEGORY_LABEL[c]}
            </option>
          ))}
        </SelectField>
        <SelectField name="kind" label="Kind" defaultValue="other" error={state.errors.kind}>
          {ASSIGNMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {ASSIGNMENT_KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Field name="dueOn" label="Due Date" type="date" error={state.errors.dueOn} />
      <Button disabled={pending}>{pending ? "Saving..." : "Create Assignment"}</Button>
    </Form>
  );
}
