"use client";

import { useActionState } from "react";
import type { MeetingActionState } from "@/lib/actions/meetings";
import { MEETING_LOCATION_MAX, MEETING_NOTES_MAX, MEETING_TITLE_MAX } from "@/lib/validation/meeting";
import { Button, Field, Form, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prev: MeetingActionState, formData: FormData) => Promise<MeetingActionState>;

export interface MeetingInitial {
  title: string;
  meetsOn: string;
  boardId: string | null;
  location: string | null;
  notes: string | null;
}

export function MeetingForm({ action, boards, initial, submitLabel = "Add Meeting" }: { action: ServerAction; boards: { id: string; name: string }[]; initial?: MeetingInitial; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, { errors: {} });
  const err = (k: string) => state.errors[k];
  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="title" label="Title" error={err("title")} defaultValue={initial?.title ?? ""} maxLength={MEETING_TITLE_MAX} required />
      <Field name="meetsOn" label="Date" type="date" error={err("meetsOn")} defaultValue={initial?.meetsOn ?? ""} required />
      {boards.length > 0 && (
        <SelectField name="boardId" label="Board" error={err("boardId")} defaultValue={initial?.boardId ?? ""}>
          <option value="">Not for one board</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
      )}
      <Field name="location" label="Where" error={err("location")} defaultValue={initial?.location ?? ""} maxLength={MEETING_LOCATION_MAX} />
      <TextAreaField name="notes" label="Notes" rows={4} error={err("notes")} defaultValue={initial?.notes ?? ""} maxLength={MEETING_NOTES_MAX} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </Form>
  );
}
