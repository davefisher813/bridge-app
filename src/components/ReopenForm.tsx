"use client";

import { useActionState } from "react";
import type { ReopenActionState } from "@/lib/actions/reopen";
import { Button, Field, Form, SelectField } from "@/components/kit";

type ServerAction = (prevState: ReopenActionState, formData: FormData) => Promise<ReopenActionState>;

const EMPTY_STATE: ReopenActionState = { errors: {} };

export interface ReopenDefaults {
  transferKind: string;
  currentSchool: string;
  transferCount: number;
}

// Reopen Recruiting for an Enrolled or Graduated athlete: the transfer
// facts the fit engine needs before it can score them again. A
// withdrawn commitment needs none of this and never renders it.
export function ReopenForm({ action, kinds, defaults }: { action: ServerAction; kinds: { value: string; label: string }[]; defaults: ReopenDefaults }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string, fallback: string) => (state.values?.[key] === undefined ? fallback : String(state.values[key]));

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField name="transferKind" label="Transfer Type" defaultValue={value("transferKind", defaults.transferKind)} error={err("transferKind")} required>
        {kinds.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </SelectField>
      <Field name="currentSchool" label="Leaving From" defaultValue={value("currentSchool", defaults.currentSchool)} error={err("currentSchool")} maxLength={120} required />
      <Field name="eligibilityYearsRemaining" label="Eligibility Years Left" type="number" inputMode="numeric" min={0} max={5} step={1} defaultValue={value("eligibilityYearsRemaining", "")} error={err("eligibilityYearsRemaining")} required />
      <Field name="transferCount" label="Transfers So Far" type="number" inputMode="numeric" min={0} step={1} defaultValue={value("transferCount", String(defaults.transferCount))} error={err("transferCount")} hint="Counting this one." />
      <Field name="portalEntryDate" label="Portal Entry Date" type="date" defaultValue={value("portalEntryDate", "")} error={err("portalEntryDate")} hint="Leave blank if they are not in the portal yet." />
      <Button disabled={pending}>{pending ? "Saving..." : "Reopen Recruiting"}</Button>
    </Form>
  );
}
