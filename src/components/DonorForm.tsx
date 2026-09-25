"use client";

import { useActionState } from "react";
import type { FundraisingActionState } from "@/lib/actions/fundraising";
import { Button, Field, Form, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: FundraisingActionState, formData: FormData) => Promise<FundraisingActionState>;

const EMPTY_STATE: FundraisingActionState = { errors: {} };

const DONOR_TYPES = [
  { value: "individual", label: "Individual" },
  { value: "board_member", label: "Board member" },
  { value: "corporate", label: "Corporate" },
  { value: "foundation", label: "Foundation" },
  { value: "other", label: "Other" },
];

export function DonorForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" error={err("name")} required />

      <SelectField
        name="donorType"
        label="Type"
        error={err("donorType")}
        defaultValue="individual"
      >
        {DONOR_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>

      <Field name="email" label="Email" type="email" />

      <Field name="phone" label="Phone" type="tel" />

      <TextAreaField name="address" label="Address" rows={2} hint="For acknowledgment letters." />

      <TextAreaField name="notes" label="Notes" rows={2} />

      <Button disabled={pending}>{pending ? "Adding..." : "Add Donor"}</Button>
    </Form>
  );
}
