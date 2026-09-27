"use client";

import { useActionState } from "react";
import type { OrgActionState } from "@/lib/actions/org";
import { Button, CheckField, Field, Form, Prose, Section, Stack } from "@/components/kit";

type ServerAction = (prev: OrgActionState, formData: FormData) => Promise<OrgActionState>;

const EMPTY: OrgActionState = { errors: {} };

// Plain data from the page, so nothing from a "use client" module has
// to reach the server as a value (see the law in dataLaws.test.ts).
export interface RoleLabelInput {
  role: string;
  label: string;
  fallback: string;
  hint: string;
}

export interface ModuleInput {
  key: string;
  title: string;
  hint: string;
  on: boolean;
}

// An org's name, what it calls each role, and its optional modules.
// Owner only; the page checks and so does the action.
export function OrgSettingsForm({ action, name, roles, modules }: { action: ServerAction; name: string; roles: RoleLabelInput[]; modules: ModuleInput[] }) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  const err = (k: string) => state.errors[k];
  const value = (k: string, fallback: string) => state.values?.[k] ?? fallback;

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" error={err("name")} defaultValue={value("name", name)} required maxLength={120} />

      <Section label="What You Call Each Role" role="people" kind="people">
        <Prose>Only the words on screen change. What each role may do stays the same.</Prose>
        <Stack gap={3}>
          {roles.map((r) => (
            <Field key={r.role} name={`label_${r.role}`} label={r.fallback} hint={r.hint} error={err(`label_${r.role}`)} defaultValue={value(`label_${r.role}`, r.label)} placeholder={r.fallback} maxLength={40} />
          ))}
        </Stack>
      </Section>

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
