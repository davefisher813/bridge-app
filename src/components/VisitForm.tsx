"use client";

import { useActionState } from "react";
import { VISIT_TYPES } from "@/lib/validation/visit";
import type { VisitActionState } from "@/lib/actions/visits";
import { Button, Field, Form, Grid2, SelectField } from "@/components/kit";

type ServerAction = (prevState: VisitActionState, formData: FormData) => Promise<VisitActionState>;

const EMPTY_STATE: VisitActionState = { errors: {} };

const VISIT_TYPE_LABEL: Record<(typeof VISIT_TYPES)[number], string> = {
  official: "Official",
  unofficial: "Unofficial",
  junior_day: "Junior day",
  camp: "Camp",
  other: "Other",
};

export function VisitForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <SelectField name="visitType" label="Type" defaultValue="unofficial">
          {VISIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {VISIT_TYPE_LABEL[t]}
            </option>
          ))}
        </SelectField>
        <Field name="visitDate" label="Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
      </Grid2>
      <Field name="impression" label="Impression" hint="How it went." />
      <Field name="nextStep" label="Next Step" hint="What happens next." />
      <Field name="notes" label="Notes" />
      <Button variant="secondary" disabled={pending}>
        {pending ? "Logging..." : "Log Visit"}
      </Button>
    </Form>
  );
}
