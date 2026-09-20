"use client";

import { useActionState } from "react";
import { CONTACT_ROLES } from "@/lib/validation/contact";
import type { ContactActionState } from "@/lib/actions/contacts";
import { Button, Field, Form, Grid2, SelectField } from "@/components/kit";

type ServerAction = (prevState: ContactActionState, formData: FormData) => Promise<ContactActionState>;

export interface ContactFormSchoolOption {
  id: string;
  label: string;
}

const EMPTY_STATE: ContactActionState = { errors: {} };

const ROLE_LABEL: Record<(typeof CONTACT_ROLES)[number], string> = {
  hs_coach: "HS coach",
  travel_coach: "Travel coach",
  parent_guardian: "Parent/guardian",
  advisor: "Advisor",
  college_coach: "College coach",
  other: "Other",
};

export function ContactForm({ action, schools }: { action: ServerAction; schools: ContactFormSchoolOption[] }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <Field name="name" label="Name" placeholder="T. Reilly" required error={err("name")} />
        <SelectField name="role" label="Role" defaultValue="hs_coach">
          {CONTACT_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <SelectField name="schoolId" label="School (if a College Coach)" defaultValue="">
        <option value="">No school</option>
        {schools.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </SelectField>
      <Grid2>
        <Field name="email" label="Email" type="email" inputMode="email" error={err("email")} />
        <Field name="phone" label="Phone" type="tel" inputMode="tel" />
      </Grid2>
      <Field name="notes" label="Notes" />
      <Button variant="secondary" disabled={pending}>
        {pending ? "Adding..." : "Add Contact"}
      </Button>
    </Form>
  );
}
