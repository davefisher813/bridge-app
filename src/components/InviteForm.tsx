"use client";

import { useActionState } from "react";
import type { MemberActionState } from "@/lib/actions/members";
import type { RoleLabels } from "@/lib/org/roleLabels";
import { labelForRole } from "@/lib/org/roleLabels";
import { ORG_ROLES } from "@/lib/validation/member";
import { Button, Field, Form, SelectField } from "@/components/kit";

type ServerAction = (prevState: MemberActionState, formData: FormData) => Promise<MemberActionState>;

const EMPTY_STATE: MemberActionState = { errors: {} };

export function InviteForm({ action, roleLabels }: { action: ServerAction; roleLabels: RoleLabels }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string) => (state.values?.[key] === undefined ? "" : String(state.values[key]));
  const L = (role: (typeof ORG_ROLES)[number]) => labelForRole(roleLabels, role);

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="email" label="Email" type="email" autoComplete="off" inputMode="email" required defaultValue={value("email")} error={err("email")} />
      <SelectField
        name="role"
        label="Role"
        defaultValue={value("role") || "staff"}
        error={err("role")}
        hint={`${L("staff")}s add and edit athletes, targets and documents. ${L("member")}s can see everything and change nothing. ${L("owner")}s can also manage members and schools.`}
      >
        {ORG_ROLES.map((r) => (
          <option key={r} value={r}>
            {L(r)}
          </option>
        ))}
      </SelectField>
      <Field name="fullName" label="Name (optional)" autoComplete="off" defaultValue={value("fullName")} />
      <Button disabled={pending}>{pending ? "Sending..." : "Send Invite"}</Button>
    </Form>
  );
}
