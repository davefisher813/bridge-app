"use client";

import { useActionState } from "react";
import type { OrgActionState } from "@/lib/actions/org";
import { Button, Field, Form } from "@/components/kit";

type ServerAction = (prev: OrgActionState, formData: FormData) => Promise<OrgActionState>;

const EMPTY: OrgActionState = { errors: {} };

// A name, and optionally the web address. Left blank, the address is
// built from the name.
export function CreateOrgForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  const err = (k: string) => state.errors[k];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Organization Name" error={err("name")} defaultValue={state.values?.name ?? ""} required maxLength={120} autoComplete="organization" />
      <Field
        name="slug"
        label="Web Address"
        error={err("slug")}
        defaultValue={state.values?.slug ?? ""}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={48}
      />
      <Button disabled={pending}>{pending ? "Creating..." : "Create Organization"}</Button>
    </Form>
  );
}
