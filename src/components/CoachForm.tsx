"use client";

import { useActionState } from "react";
import type { CoachActionState } from "@/lib/actions/coaches";
import { Button, CheckField, Field, Form, Grid2 } from "@/components/kit";

type ServerAction = (prevState: CoachActionState, formData: FormData) => Promise<CoachActionState>;

const EMPTY_STATE: CoachActionState = { errors: {} };

export interface CoachFormInitialValues {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  isRecruitingCoordinator?: boolean;
}

// One coach in the shared directory. The school is the page the form
// sits on, so it is never a field.
export function CoachForm({ action, initialValues = {}, submitLabel }: { action: ServerAction; initialValues?: CoachFormInitialValues; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" autoComplete="off" defaultValue={initialValues.name ?? ""} error={err("name")} required />
      <Field name="title" label="Title" hint="For example, Head Coach or Assistant Coach." defaultValue={initialValues.title ?? ""} error={err("title")} />
      <Grid2>
        <Field name="email" label="Email" type="email" inputMode="email" autoCapitalize="none" defaultValue={initialValues.email ?? ""} error={err("email")} />
        <Field name="phone" label="Phone" type="tel" inputMode="tel" defaultValue={initialValues.phone ?? ""} error={err("phone")} />
      </Grid2>
      <CheckField name="isRecruitingCoordinator" label="Runs Recruiting" hint="The first person to write to about an athlete." defaultChecked={initialValues.isRecruitingCoordinator ?? false} />
      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
