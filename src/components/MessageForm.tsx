"use client";

import { useActionState } from "react";
import type { MessageActionState } from "@/lib/actions/messages";
import { Button, Form, TextAreaField } from "@/components/kit";

// The composer under an athlete's thread. The same form on the staff
// thread and the family thread, bound to sendMessage by the page.

type ServerAction = (prevState: MessageActionState, formData: FormData) => Promise<MessageActionState>;

const EMPTY_STATE: MessageActionState = { errors: {} };

export function MessageForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      <TextAreaField name="body" label="Message" maxLength={4000} defaultValue={state.body ?? ""} error={state.errors.body} />
      <Button disabled={pending}>{pending ? "Sending..." : "Send"}</Button>
    </Form>
  );
}
