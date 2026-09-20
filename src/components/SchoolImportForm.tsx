"use client";

import { useActionState } from "react";
import type { ImportActionState } from "@/lib/actions/schools";
import { Button, FileField, Form, Label, Notice, Stack } from "@/components/kit";

type ServerAction = (prevState: ImportActionState, formData: FormData) => Promise<ImportActionState>;

const EMPTY_STATE: ImportActionState = { errors: {}, problems: [] };

// The CSV import. docs/MATCHING_CONTRACT.md section 4: rows with
// problems are listed by line and column; nothing half-imports.
export function SchoolImportForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const shown = state.problems.slice(0, 25);

  return (
    <Form action={formAction} error={state.errors.form}>
      <FileField name="file" label="Choose a CSV" hint={state.errors.file ?? "Exported from the template. Nothing imports until every row is clean."} accept=".csv,text/csv" required />
      {state.problems.length > 0 && (
        <Stack gap={2}>
          <Notice tone="danger" title={`${state.problems.length} ${state.problems.length === 1 ? "Problem" : "Problems"} in the File`}>
            Fix these and choose the file again. No school was imported.
          </Notice>
          {shown.map((p, i) => (
            <Label key={i}>{`Line ${p.line}, ${p.column}: ${p.message}`}</Label>
          ))}
          {state.problems.length > shown.length && <Label>{`And ${state.problems.length - shown.length} more.`}</Label>}
        </Stack>
      )}
      <Button disabled={pending}>{pending ? "Importing..." : "Import Schools"}</Button>
    </Form>
  );
}
