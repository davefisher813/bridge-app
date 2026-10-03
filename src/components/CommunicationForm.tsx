"use client";

import { orgToday } from "@/lib/datetime/today";
import { useActionState } from "react";
import { COMMUNICATION_KINDS } from "@/lib/validation/communication";
import type { CommunicationActionState } from "@/lib/actions/communications";
import { Button, Field, Form, Grid2, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: CommunicationActionState, formData: FormData) => Promise<CommunicationActionState>;

const EMPTY_STATE: CommunicationActionState = { errors: {} };

const KIND_LABEL: Record<string, string> = {
  call: "Call",
  text: "Text",
  email: "Email",
  visit: "Visit",
  other: "Other",
};

export interface CommunicationFormInitialValues {
  kind?: string;
  occurredOn?: string;
  notes?: string;
}

// Logging a contact on a target, and correcting one already logged: the
// same fields either way, so a wrong date is fixed where it was typed.
export function CommunicationForm({
  action,
  initialValues,
  submitLabel = "Log Communication",
}: {
  action: ServerAction;
  initialValues?: CommunicationFormInitialValues;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const editing = initialValues !== undefined;

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <SelectField name="kind" label="Type" defaultValue={initialValues?.kind ?? "call"} error={state.errors.kind}>
          {COMMUNICATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
        <Field
          name="occurredOn"
          label="Date"
          type="date"
          defaultValue={editing ? (initialValues?.occurredOn ?? "") : orgToday()}
          error={state.errors.occurredOn}
        />
      </Grid2>
      <TextAreaField name="notes" label="Notes" rows={3} defaultValue={initialValues?.notes ?? ""} error={state.errors.notes} />
      <Button variant={editing ? "primary" : "secondary"} disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </Form>
  );
}
