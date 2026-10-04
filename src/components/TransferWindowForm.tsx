"use client";

import { useActionState } from "react";
import type { TransferWindowActionState } from "@/lib/actions/transferWindows";
import { SPORTS } from "@/lib/fit/contract";
import { TRANSFER_DIVISIONS } from "@/lib/validation/transferWindow";
import { Button, Field, Form, Grid2, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: TransferWindowActionState, formData: FormData) => Promise<TransferWindowActionState>;

const EMPTY_STATE: TransferWindowActionState = { errors: {} };

export interface TransferWindowInitialValues {
  sport?: string;
  division?: string;
  seasonYear?: string;
  windowLabel?: string;
  opensOn?: string;
  closesOn?: string;
  sourceUrl?: string;
  notes?: string;
}

// Adding a window and correcting one (crud F22): the same fields, the
// window on file filled in when editing. What was typed survives a
// refusal, since the action hands the values back.
export function TransferWindowForm({ action, initialValues = {}, submitLabel = "Add Window" }: { action: ServerAction; initialValues?: TransferWindowInitialValues; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: keyof TransferWindowInitialValues) => (state.values?.[key] === undefined ? (initialValues[key] ?? "") : String(state.values[key]));

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <SelectField name="sport" label="Sport" defaultValue={value("sport") || "baseball"} error={err("sport")}>
          {SPORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <SelectField name="division" label="Division" defaultValue={value("division") || "D1"} error={err("division")}>
          {TRANSFER_DIVISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Grid2>
        <Field name="seasonYear" label="Season" hint="Like 2026-27." defaultValue={value("seasonYear")} error={err("seasonYear")} />
        <Field name="windowLabel" label="Window" defaultValue={value("windowLabel")} error={err("windowLabel")} />
      </Grid2>
      <Grid2>
        <Field name="opensOn" label="Opens" type="date" defaultValue={value("opensOn")} error={err("opensOn")} />
        <Field name="closesOn" label="Closes" type="date" defaultValue={value("closesOn")} error={err("closesOn")} />
      </Grid2>
      <Field name="sourceUrl" label="Source" type="url" inputMode="url" defaultValue={value("sourceUrl")} error={err("sourceUrl")} />
      <TextAreaField name="notes" label="Notes" rows={3} maxLength={4000} defaultValue={value("notes")} error={err("notes")} />
      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
