"use client";

import { useActionState } from "react";
import type { EnrollActionState } from "@/lib/actions/enrollment";
import { Button, Field, Form } from "@/components/kit";

type ServerAction = (prevState: EnrollActionState, formData: FormData) => Promise<EnrollActionState>;

const EMPTY_STATE: EnrollActionState = { errors: {} };

export function EnrollForm({ action, today }: { action: ServerAction; today: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string) => (state.values?.[key] === undefined ? "" : String(state.values[key]));

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="enrolledOn" label="Enrolled On" type="date" defaultValue={value("enrolledOn") || today} error={err("enrolledOn")} required />
      <Button disabled={pending}>{pending ? "Marking Enrolled..." : "Mark Enrolled"}</Button>
    </Form>
  );
}
