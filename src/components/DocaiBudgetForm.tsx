"use client";

import { useActionState } from "react";
import type { BudgetActionState } from "@/lib/actions/docaiBudget";
import { Button, Field, Form } from "@/components/kit";

type ServerAction = (prevState: BudgetActionState, formData: FormData) => Promise<BudgetActionState>;

const EMPTY_STATE: BudgetActionState = { errors: {} };

// The month's cap on document reading, in dollars. Owner only.
export function DocaiBudgetForm({ action, currentCents }: { action: ServerAction; currentCents: number }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="budget" label="Monthly Budget" type="number" inputMode="decimal" min={0} step={1} defaultValue={(currentCents / 100).toFixed(0)} hint="Dollars per calendar month. Zero turns document reading off." error={state.errors.budget} />
      <Button disabled={pending} variant="secondary">
        {pending ? "Saving..." : "Save Budget"}
      </Button>
    </Form>
  );
}
