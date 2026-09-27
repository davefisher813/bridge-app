"use client";

import { useActionState } from "react";
import type { ReopenActionState } from "@/lib/actions/reopen";
import type { Suggestion } from "@/components/kit";
import { Button, Field, Form, SelectField, SuggestField, TextAreaField } from "@/components/kit";

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
// `colleges` suggests the school they are leaving (Stage 4); a name that
// matches one school on file is remembered as that school.
export function ReopenForm({ action, kinds, defaults, colleges = [] }: { action: ServerAction; kinds: { value: string; label: string }[]; defaults: ReopenDefaults; colleges?: Suggestion[] }) {
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
      <SuggestField name="currentSchool" label="Leaving From" defaultValue={value("currentSchool", defaults.currentSchool)} error={err("currentSchool")} maxLength={120} required suggestions={colleges} />
      <Field name="eligibilityYearsRemaining" label="Eligibility Years Left" type="number" inputMode="numeric" min={0} max={5} step={1} defaultValue={value("eligibilityYearsRemaining", "")} error={err("eligibilityYearsRemaining")} required />
      <Field name="transferCount" label="Transfers So Far" type="number" inputMode="numeric" min={0} step={1} defaultValue={value("transferCount", String(defaults.transferCount))} error={err("transferCount")} hint="Counting this one." />
      <Field name="portalEntryDate" label="Portal Entry Date" type="date" defaultValue={value("portalEntryDate", "")} error={err("portalEntryDate")} hint="Leave blank if they are not in the portal yet." />
      <TextAreaField name="note" label="Note" hint="Optional. Staff only, filed on the athlete's notes." maxLength={4000} defaultValue={value("note", "")} error={err("note")} />
      <Button disabled={pending}>{pending ? "Saving..." : "Reopen Recruiting"}</Button>
    </Form>
  );
}
