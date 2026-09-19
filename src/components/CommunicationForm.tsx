"use client";

import { useActionState } from "react";
import { COMMUNICATION_KINDS } from "@/lib/validation/communication";
import type { CommunicationActionState } from "@/lib/actions/communications";
import { Button, Field, Form, Grid2, SelectField } from "@/components/kit";

type ServerAction = (prevState: CommunicationActionState, formData: FormData) => Promise<CommunicationActionState>;

const EMPTY_STATE: CommunicationActionState = { errors: {} };

const KIND_LABEL: Record<string, string> = {
  call: "Call",
  text: "Text",
  email: "Email",
  visit: "Visit",
  other: "Other",
};

export function CommunicationForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <SelectField name="kind" label="Type" defaultValue="call">
          {COMMUNICATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
        <Field name="occurredOn" label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
      </Grid2>
      <Field name="notes" label="Notes" placeholder="What was discussed" />
      <Button variant="secondary" disabled={pending}>
        {pending ? "Logging..." : "Log Communication"}
      </Button>
    </Form>
  );
}
