"use client";

import { useActionState } from "react";
import type { OrgActionState } from "@/lib/actions/org";
import { Button, CheckField, Field, Form, Prose, Section, Stack } from "@/components/kit";

type ServerAction = (prev: OrgActionState, formData: FormData) => Promise<OrgActionState>;

const EMPTY: OrgActionState = { errors: {} };

// Plain data from the page, so nothing from a "use client" module has
// to reach the server as a value (see the law in dataLaws.test.ts).
export interface ModuleInput {
  key: string;
  title: string;
  hint: string;
  on: boolean;
}

// An org's name and its optional modules. Admin only; the page checks
// and so does the action. The access names (Admin, Viewer, Athlete) are
// fixed, so there is nothing to name here any more.
export function OrgSettingsForm({ action, name, modules }: { action: ServerAction; name: string; modules: ModuleInput[] }) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  const err = (k: string) => state.errors[k];
  const value = (k: string, fallback: string) => state.values?.[k] ?? fallback;

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" error={err("name")} defaultValue={value("name", name)} required maxLength={120} />

      <Section label="Modules" role="place" kind="checklist">
        <Stack gap={3}>
          {modules.map((m) => (
            <CheckField key={m.key} name={`module_${m.key}`} label={m.title} hint={m.hint} defaultChecked={state.values ? state.values[`module_${m.key}`] === "on" : m.on} />
          ))}
        </Stack>
        <Prose>Turning a module off hides its screens. Nothing in it is deleted, and turning it back on brings it all back.</Prose>
      </Section>

      <Button disabled={pending}>{pending ? "Saving..." : "Save Settings"}</Button>
    </Form>
  );
}
