"use client";

import { useActionState } from "react";
import { VISIT_TYPES } from "@/lib/validation/visit";
import type { VisitActionState } from "@/lib/actions/visits";
import { Button, Field, Form, Grid2, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: VisitActionState, formData: FormData) => Promise<VisitActionState>;

const EMPTY_STATE: VisitActionState = { errors: {} };

const VISIT_TYPE_LABEL: Record<(typeof VISIT_TYPES)[number], string> = {
  official: "Official",
  unofficial: "Unofficial",
  junior_day: "Junior day",
  camp: "Camp",
  other: "Other",
};

export interface VisitFormInitialValues {
  visitType?: string;
  visitDate?: string;
  impression?: string;
  nextStep?: string;
  notes?: string;
}

// Logging a visit on a target, and correcting one already logged. The
// three free-text boxes are multi-line: an impression of a campus visit
// is rarely one line.
export function VisitForm({ action, initialValues, submitLabel = "Log Visit" }: { action: ServerAction; initialValues?: VisitFormInitialValues; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const editing = initialValues !== undefined;

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <SelectField name="visitType" label="Type" defaultValue={initialValues?.visitType ?? "unofficial"} error={state.errors.visitType}>
          {VISIT_TYPES.map((t) => (
            <option key={t} value={t}>
              {VISIT_TYPE_LABEL[t]}
            </option>
          ))}
        </SelectField>
        <Field
          name="visitDate"
          label="Date"
          type="date"
          defaultValue={editing ? (initialValues?.visitDate ?? "") : new Date().toISOString().slice(0, 10)}
          error={state.errors.visitDate}
        />
      </Grid2>
      <TextAreaField name="impression" label="Impression" hint="How it went." rows={3} defaultValue={initialValues?.impression ?? ""} />
      <TextAreaField name="nextStep" label="Next Step" hint="What happens next." rows={2} defaultValue={initialValues?.nextStep ?? ""} />
      <TextAreaField name="notes" label="Notes" rows={3} defaultValue={initialValues?.notes ?? ""} />
      <Button variant={editing ? "primary" : "secondary"} disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </Form>
  );
}
