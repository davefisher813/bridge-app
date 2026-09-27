"use client";

import { useActionState } from "react";
import type { FundraisingActionState } from "@/lib/actions/fundraising";
import { Button, Field, Form, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: FundraisingActionState, formData: FormData) => Promise<FundraisingActionState>;

const EMPTY_STATE: FundraisingActionState = { errors: {} };

const DONOR_TYPES = [
  { value: "individual", label: "Individual" },
  { value: "board_member", label: "Board Member" },
  { value: "corporate", label: "Corporate" },
  { value: "foundation", label: "Foundation" },
  { value: "other", label: "Other" },
];

// What a donor already says, for Edit Donor.
export interface DonorInitial {
  name: string;
  donorType: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}

export function DonorForm({ action, initial, submitLabel = "Add Donor" }: { action: ServerAction; initial?: DonorInitial; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" error={err("name")} defaultValue={initial?.name ?? ""} required />

      <SelectField
        name="donorType"
        label="Type"
        error={err("donorType")}
        defaultValue={initial?.donorType ?? "individual"}
      >
        {DONOR_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>

      <Field name="email" label="Email" type="email" defaultValue={initial?.email ?? ""} />

      <Field name="phone" label="Phone" type="tel" defaultValue={initial?.phone ?? ""} />

      <TextAreaField name="address" label="Address" rows={2} hint="For acknowledgment letters." defaultValue={initial?.address ?? ""} />

      <TextAreaField name="notes" label="Notes" rows={2} defaultValue={initial?.notes ?? ""} />

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
