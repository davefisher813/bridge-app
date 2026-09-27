"use client";

import { useActionState } from "react";
import { CHECKIN_KINDS, CHECKIN_KIND_LABEL } from "@/lib/checkins";
import type { CheckinActionState } from "@/lib/actions/checkins";
import { Button, Field, Form, Grid2, SelectField, TextAreaField } from "@/components/kit";

// Logging a check-in on an athlete. Staff only: the log and its notes
// never reach a family login (migration 0039), and the hint says so.

type ServerAction = (prevState: CheckinActionState, formData: FormData) => Promise<CheckinActionState>;

const EMPTY_STATE: CheckinActionState = { errors: {} };

export function CheckinForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <SelectField name="kind" label="Type" defaultValue="call" error={state.errors.kind}>
          {CHECKIN_KINDS.map((k) => (
            <option key={k} value={k}>
              {CHECKIN_KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
        <Field name="occurredOn" label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} error={state.errors.occurredOn} />
      </Grid2>
      <TextAreaField name="notes" label="Notes" hint="Staff only." maxLength={2000} error={state.errors.notes} />
      <Button variant="secondary" disabled={pending}>
        {pending ? "Logging..." : "Log Check-In"}
      </Button>
    </Form>
  );
}
