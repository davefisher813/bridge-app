"use client";

import { useActionState, useState } from "react";
import type { MemberActionState } from "@/lib/actions/members";
import { labelForRole } from "@/lib/org/roleLabels";
import { ASSIGNABLE_ROLES } from "@/lib/validation/member";
import { Button, Field, Form, Hidden, SelectField, SuggestField } from "@/components/kit";
import { RELATIONSHIPS } from "@/lib/copy/relationships";

type ServerAction = (prevState: MemberActionState, formData: FormData) => Promise<MemberActionState>;

const EMPTY_STATE: MemberActionState = { errors: {} };

export interface InviteAthleteOption {
  id: string;
  name: string;
}

// The access levels an Admin can hand out here: Admin, Viewer, Athlete
// (Dave, 2026-09-27). staff is retired and never offered. Athlete is
// offered only when the org has athletes to link one to: an athlete
// login with no athlete is a login to an empty screen, and the action
// refuses it.

// `pinned` is the Invite Athlete screen on an athlete's page (Dave's
// pick, 2026-09-21): the role is family and the athlete is this one, so
// neither is asked; what is asked is who this person is to the athlete.
//
// `suggest` is what the athlete's own parent and guardian contacts
// already say (Stage 4): their emails are suggested, and the name is
// filled in when there is exactly one of them.
export function InviteForm({
  action,
  athletes = [],
  pinned,
  suggest,
}: {
  action: ServerAction;
  athletes?: InviteAthleteOption[];
  pinned?: { athleteId: string; athleteName: string; returnTo: string };
  suggest?: { emails: string[]; name?: string };
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string) => (state.values?.[key] === undefined ? "" : String(state.values[key]));
  // Viewer by default: the level that changes nothing is the safe one.
  const [role, setRole] = useState(pinned ? "family" : value("role") || "member");
  const roles = athletes.length > 0 ? ASSIGNABLE_ROLES : ASSIGNABLE_ROLES.filter((r) => r !== "family");

  if (pinned) {
    return (
      <Form action={formAction} error={state.errors.form ?? state.errors.role ?? state.errors.athleteId}>
        <Hidden name="role" value="family" />
        <Hidden name="athleteId" value={pinned.athleteId} />
        <Hidden name="returnTo" value={pinned.returnTo} />
        <SuggestField
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          required
          hint={suggest?.emails.length ? "The parent and guardian contacts on file are suggested." : undefined}
          defaultValue={value("email")}
          error={err("email")}
          suggestions={suggest?.emails ?? []}
        />
        <SelectField name="relationship" label="Who They Are" defaultValue={value("relationship") || "parent"} error={err("relationship")}>
          {RELATIONSHIPS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </SelectField>
        <Field name="fullName" label="Name (optional)" autoComplete="off" defaultValue={state.values?.fullName === undefined ? (suggest?.name ?? "") : value("fullName")} />
        <Button disabled={pending}>{pending ? "Sending..." : "Send Invite"}</Button>
      </Form>
    );
  }

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="email" label="Email" type="email" autoComplete="off" inputMode="email" required defaultValue={value("email")} error={err("email")} />
      <SelectField
        name="role"
        label="Role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        error={err("role")}
        hint={
          role === "family"
            ? "Athlete access covers one athlete's record, read only, and nothing else."
            : "Admins add and edit everything, including members, schools and settings. Viewers see the program as names and stages, the year's giving and their own seat, and change nothing."
        }
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {labelForRole(r)}
          </option>
        ))}
      </SelectField>
      {role === "family" && (
        <>
          <SelectField name="athleteId" label="Athlete" defaultValue={value("athleteId")} error={err("athleteId")}>
            <option value="">Pick an athlete</option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectField>
          <SelectField name="relationship" label="Who They Are" defaultValue={value("relationship") || "parent"} error={err("relationship")}>
            {RELATIONSHIPS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </SelectField>
        </>
      )}
      <Field name="fullName" label="Name (optional)" autoComplete="off" defaultValue={value("fullName")} />
      <Button disabled={pending}>{pending ? "Sending..." : "Send Invite"}</Button>
    </Form>
  );
}
