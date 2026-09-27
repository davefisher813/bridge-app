"use client";

import { useActionState, useState } from "react";
import type { SchoolActionState } from "@/lib/actions/schools";
import { nameKey } from "@/lib/lookup/nameKey";
import { Button, Field, Form, Grid2, SuggestField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: SchoolActionState, formData: FormData) => Promise<SchoolActionState>;

const EMPTY_STATE: SchoolActionState = { errors: {} };

export interface NoteCoachOption {
  value: string;
  label?: string;
  email: string | null;
}

// What this org knows privately about a shared school. Positions of need
// move the match score for an athlete whose position and grad year fit
// (docs/MATCHING_CONTRACT.md sections 3 and 4).
//
// Head Coach suggests the school's staff from the directory (Stage 4,
// B4). Picking one fills Coach Email when it is blank; a typed email is
// never overwritten. The server does the same fill on save, so it holds
// without the browser too.
export function OrgSchoolNoteForm({
  action,
  coaches = [],
  initialValues = {},
}: {
  action: ServerAction;
  coaches?: NoteCoachOption[];
  initialValues?: { coachName?: string; coachEmail?: string; positionsOfNeed?: string; notes?: string };
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const [email, setEmail] = useState(initialValues.coachEmail ?? "");

  function pickCoach(name: string) {
    if (email.trim()) return;
    const same = coaches.filter((c) => nameKey(c.value) === nameKey(name));
    if (same.length === 1 && same[0].email) setEmail(same[0].email);
  }

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <SuggestField
          id="note-coach"
          name="coachName"
          label="Head Coach"
          suggestions={coaches.map((c) => ({ value: c.value, label: c.label }))}
          defaultValue={initialValues.coachName ?? ""}
          onChange={(e) => pickCoach(e.target.value)}
          error={err("coachName")}
        />
        <Field
          name="coachEmail"
          label="Coach Email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={err("coachEmail")}
        />
      </Grid2>
      <Field
        name="positionsOfNeed"
        label="Positions of Need"
        hint="Position and grad year, separated by semicolons. For example, SS 2027; RHP 2028."
        defaultValue={initialValues.positionsOfNeed ?? ""}
        error={err("positionsOfNeed")}
      />
      <TextAreaField name="notes" label="Notes" rows={3} defaultValue={initialValues.notes ?? ""} error={err("notes")} />
      <Button disabled={pending}>{pending ? "Saving..." : "Save Notes"}</Button>
    </Form>
  );
}
