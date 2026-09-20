"use client";

import { useActionState } from "react";
import type { PresetActionState } from "@/lib/actions/matching";
import { PRESETS, type ScoringPreset } from "@/lib/fit/contract";
import { Button, Form, SelectField } from "@/components/kit";

type ServerAction = (prevState: PresetActionState, formData: FormData) => Promise<PresetActionState>;

const EMPTY_STATE: PresetActionState = { errors: {} };

// The org's blend. docs/MATCHING_CONTRACT.md section 3: Money First is
// Bridge's default; saving recomputes every match in the org.
export function PresetForm({ action, current }: { action: ServerAction; current: ScoringPreset }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const keys = Object.keys(PRESETS) as ScoringPreset[];

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField name="preset" label="Scoring Preset" hint="How much academics, the program and money each count. Saving rescores every match." defaultValue={current} error={state.errors.preset}>
        {keys.map((k) => {
          const w = PRESETS[k].weights;
          return (
            <option key={k} value={k}>
              {`${PRESETS[k].label} (${Math.round(w.academic * 100)} / ${Math.round(w.athletic * 100)} / ${Math.round(w.financial * 100)})`}
            </option>
          );
        })}
      </SelectField>
      <Button disabled={pending} variant="secondary">
        {pending ? "Saving..." : "Save Preset"}
      </Button>
    </Form>
  );
}
