"use client";

import { useActionState } from "react";
import { ASSIGNMENT_TEXT_MAX } from "@/lib/data/assignments";
import type { AssignmentActionState } from "@/lib/actions/assignments";
import { Button, Form, Stack, TextAreaField } from "@/components/kit";

// Reviewing a submitted assignment (migration 0046). Admins only.
// Complete closes it. Needs Revision sends it back to the athlete login
// with a comment saying what to change, so the comment is required. The
// comment is shown to the family and never copied into the activity log.

type CompleteAction = (formData: FormData) => void | Promise<void>;
type ReviseAction = (prevState: AssignmentActionState, formData: FormData) => Promise<AssignmentActionState>;

const EMPTY_STATE: AssignmentActionState = { errors: {} };

export function AssignmentReview({ complete, revise }: { complete: CompleteAction; revise: ReviseAction }) {
  const [state, formAction, pending] = useActionState(revise, EMPTY_STATE);

  return (
    <Stack gap={4}>
      <Form action={complete}>
        <Button>Complete</Button>
      </Form>
      <Form action={formAction} error={state.errors.form}>
        <TextAreaField
          name="comment"
          label="What Needs to Change"
          hint="The athlete login sees this when it is sent back."
          maxLength={ASSIGNMENT_TEXT_MAX}
          defaultValue={state.comment ?? ""}
          error={state.errors.comment}
        />
        <Button variant="secondary" disabled={pending}>
          {pending ? "Sending Back..." : "Needs Revision"}
        </Button>
      </Form>
    </Stack>
  );
}
