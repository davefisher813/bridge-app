"use client";

import { useActionState, useState } from "react";
import type { MemberActionState } from "@/lib/actions/members";
import type { RoleLabels } from "@/lib/org/roleLabels";
import { labelForRole } from "@/lib/org/roleLabels";
import { ORG_ROLES } from "@/lib/validation/member";
import { Button, Field, Form, Hidden, SelectField } from "@/components/kit";
import { RELATIONSHIPS } from "@/lib/copy/relationships";

type ServerAction = (prevState: MemberActionState, formData: FormData) => Promise<MemberActionState>;

const EMPTY_STATE: MemberActionState = { errors: {} };

export interface InviteAthleteOption {
  id: string;
  name: string;
}

// The roles an owner can hand out here. Family is offered only when the
// org has athletes to link a family to: a family login without an
// athlete is a login to an empty screen, and the action refuses it.

// `pinned` is the Invite Family screen on an athlete's page (Dave's
// pick, 2026-09-21): the role is family and the athlete is this one, so
// neither is asked; what is asked is who this person is to the athlete.
export function InviteForm({
  action,
  roleLabels,
  athletes = [],
  pinned,
}: {
  action: ServerAction;
  roleLabels: RoleLabels;
  athletes?: InviteAthleteOption[];
  pinned?: { athleteId: string; athleteName: string; returnTo: string };
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string) => (state.values?.[key] === undefined ? "" : String(state.values[key]));
  const L = (role: (typeof ORG_ROLES)[number]) => labelForRole(roleLabels, role);
  const [role, setRole] = useState(pinned ? "family" : value("role") || "staff");
  const roles = athletes.length > 0 ? ORG_ROLES : ORG_ROLES.filter((r) => r !== "family");

  if (pinned) {
    return (
      <Form action={formAction} error={state.errors.form ?? state.errors.role ?? state.errors.athleteId}>
        <Hidden name="role" value="family" />
        <Hidden name="athleteId" value={pinned.athleteId} />
        <Hidden name="returnTo" value={pinned.returnTo} />
        <Field name="email" label="Email" type="email" autoComplete="off" inputMode="email" required defaultValue={value("email")} error={err("email")} />
        <SelectField name="relationship" label="Who They Are" defaultValue={value("relationship") || "parent"} error={err("relationship")} hint={`To ${pinned.athleteName}. Shown on their row, nothing more.`}>
          {RELATIONSHIPS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </SelectField>
        <Field name="fullName" label="Name (optional)" autoComplete="off" defaultValue={value("fullName")} />
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
            ? `${L("family")} sees one athlete's record, read only, and nothing else.`
            : `${L("staff")}s add and edit athletes, targets and documents. ${L("member")}s see the program as names and stages, the year's giving and their own seat, and change nothing. ${L("owner")}s can also manage members and schools.`
        }
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {L(r)}
          </option>
        ))}
      </SelectField>
      {role === "family" && (
        <>
          <SelectField name="athleteId" label="Athlete" defaultValue={value("athleteId")} error={err("athleteId")} hint="The one athlete this person will see.">
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
