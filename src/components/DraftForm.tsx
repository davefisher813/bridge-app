"use client";

import { useActionState } from "react";
import type { EnrollActionState } from "@/lib/actions/enrollment";
import { Button, Field, Form, Grid2 } from "@/components/kit";

type ServerAction = (prevState: EnrollActionState, formData: FormData) => Promise<EnrollActionState>;

const EMPTY_STATE: EnrollActionState = { errors: {} };

// Mark Drafted: the team, and the round and year when known (Dave's
// pick, 2026-09-26).
export function DraftForm({ action, initial, submitLabel }: { action: ServerAction; initial: { team?: string; round?: number; year?: number }; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string, fallback?: string | number) => (state.values?.[key] === undefined ? (fallback === undefined ? "" : String(fallback)) : String(state.values[key]));

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="draftTeam" label="Team" hint="For example, New York Yankees." maxLength={80} defaultValue={value("draftTeam", initial.team)} error={err("draftTeam")} required />
      <Grid2>
        <Field name="draftRound" label="Round" type="number" min="1" max="99" inputMode="numeric" defaultValue={value("draftRound", initial.round)} error={err("draftRound")} />
        <Field name="draftYear" label="Year" type="number" min="1900" max="2200" inputMode="numeric" defaultValue={value("draftYear", initial.year)} error={err("draftYear")} />
      </Grid2>
      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
