"use client";

import { useActionState } from "react";
import type { ExtractedEditState } from "@/lib/actions/documents";
import type { EditField } from "@/lib/data/extractedEdit";
import { Button, CheckField, Field, Form, SelectField } from "@/components/kit";

// Correcting what was read off a document before it is applied (audit
// crud F5). The fields come from src/lib/data/extractedEdit.ts, the same
// list the action reads back, so the form can not offer a field the
// action ignores.

type ServerAction = (prevState: ExtractedEditState, formData: FormData) => Promise<ExtractedEditState>;

const EMPTY_STATE: ExtractedEditState = { errors: {} };

export function ExtractedEditForm({ action, fields }: { action: ServerAction; fields: EditField[] }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      {fields.map((f) =>
        f.kind === "check" ? (
          <CheckField key={f.name} id={`fix-${f.name}`} name={f.name} label={f.label} hint={f.hint} defaultChecked={f.checked ?? false} />
        ) : f.kind === "select" ? (
          <SelectField key={f.name} id={`fix-${f.name}`} name={f.name} label={f.label} hint={f.hint} defaultValue={f.value} error={state.errors[f.name]}>
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        ) : (
          <Field
            key={f.name}
            id={`fix-${f.name}`}
            name={f.name}
            label={f.label}
            hint={f.hint}
            type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
            inputMode={f.kind === "number" ? "decimal" : undefined}
            step={f.kind === "number" ? "any" : undefined}
            maxLength={f.kind === "text" ? 200 : undefined}
            defaultValue={f.value}
            error={state.errors[f.name]}
          />
        ),
      )}
      <Button disabled={pending}>{pending ? "Saving..." : "Save Corrections"}</Button>
    </Form>
  );
}
