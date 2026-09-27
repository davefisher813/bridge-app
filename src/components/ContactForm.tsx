"use client";

import { useActionState, useState } from "react";
import { CONTACT_ROLES } from "@/lib/validation/contact";
import type { ContactActionState } from "@/lib/actions/contacts";
import type { CoachOption } from "@/lib/data/lookups";
import { nameKey } from "@/lib/lookup/nameKey";
import { Button, Field, Form, Grid2, SelectField, SuggestField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: ContactActionState, formData: FormData) => Promise<ContactActionState>;

export interface ContactFormSchoolOption {
  id: string;
  label: string;
}

// What the edit screen prefills (audit crud F16).
export interface ContactFormInitial {
  name: string;
  role: string;
  schoolId: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
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

// The coach at the picked college whose name was typed, when exactly one
// matches. The same rule as matchCoach in src/lib/data/lookups.ts, which
// the server runs again on save.
function coachNamed(options: readonly CoachOption[] | undefined, name: string): CoachOption | null {
  const key = nameKey(name);
  if (!key || !options) return null;
  const same = options.filter((o) => nameKey(o.value) === key);
  return same.length === 1 ? same[0] : null;
}

// Add a contact on the athlete page, or edit one on its own screen.
// Picking a college suggests its coaches by name (Stage 4); picking a
// coach fills a blank email and phone from the directory, and never
// overwrites what was typed.
export function ContactForm({
  action,
  schools,
  coaches = {},
  initial,
  submitLabel = "Add Contact",
}: {
  action: ServerAction;
  schools: ContactFormSchoolOption[];
  coaches?: Record<string, CoachOption[]>;
  initial?: ContactFormInitial;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  const [schoolId, setSchoolId] = useState<string>(initial?.schoolId ?? "");
  const [name, setName] = useState<string>(initial?.name ?? "");
  const [email, setEmail] = useState<string>(initial?.email ?? "");
  const [phone, setPhone] = useState<string>(initial?.phone ?? "");
  const schoolCoaches = schoolId ? (coaches[schoolId] ?? []) : [];

  // A saved add clears the form for the next contact. The fields are held
  // here, so the browser's own reset after an action does not reach them.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (!initial && Object.keys(state.errors).length === 0) {
      setSchoolId("");
      setName("");
      setEmail("");
      setPhone("");
    }
  }

  function typeName(value: string) {
    setName(value);
    const coach = coachNamed(schoolCoaches, value);
    if (!coach) return;
    if (!email.trim() && coach.email) setEmail(coach.email);
    if (!phone.trim() && coach.phone) setPhone(coach.phone);
  }

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField name="schoolId" label="School (if a College Coach)" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
        <option value="">No school</option>
        {schools.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </SelectField>
      <Grid2>
        <SuggestField
          name="name"
          label="Name"
          hint={schoolCoaches.length > 0 ? "Pick one of the school's coaches or type a name." : "For example, T. Reilly."}
          value={name}
          onChange={(e) => typeName(e.target.value)}
          required
          error={err("name")}
          suggestions={schoolCoaches}
        />
        <SelectField name="role" label="Role" defaultValue={initial?.role ?? "hs_coach"}>
          {CONTACT_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Grid2>
        <Field name="email" label="Email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err("email")} />
        <Field name="phone" label="Phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Grid2>
      <TextAreaField name="notes" label="Notes" maxLength={2000} defaultValue={initial?.notes ?? ""} />
      <Button variant="secondary" disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </Form>
  );
}
