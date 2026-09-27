"use client";

import { useActionState } from "react";
import type { NoteActionState } from "@/lib/actions/athletes";
import { Button, Form, TextAreaField } from "@/components/kit";

// A staff note typed straight onto the athlete page (Stage 4). Staff
// only: notes live in their own table that no family or member login can
// read (migration 0040). The id is explicit because the page also holds
// the contact form, whose Notes field would otherwise share it.

type ServerAction = (prevState: NoteActionState, formData: FormData) => Promise<NoteActionState>;

const EMPTY_STATE: NoteActionState = { errors: {} };

export function AthleteNoteForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      <TextAreaField id="athleteNote" name="body" label="Add a Note" hint="Staff only, never shown to the family." maxLength={4000} defaultValue={state.body ?? ""} error={state.errors.body} />
      <Button variant="secondary" disabled={pending}>
        {pending ? "Saving..." : "Add Note"}
      </Button>
    </Form>
  );
}
