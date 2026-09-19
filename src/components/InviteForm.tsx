"use client";

import { useActionState } from "react";
import type { MemberActionState } from "@/lib/actions/members";
import type { RoleLabels } from "@/lib/org/roleLabels";
import { labelForRole } from "@/lib/org/roleLabels";
import { ORG_ROLES } from "@/lib/validation/member";
import { errorClass, fieldClass, inputClass, labelClass, submitClass } from "@/components/formStyles";

type ServerAction = (prevState: MemberActionState, formData: FormData) => Promise<MemberActionState>;

const EMPTY_STATE: MemberActionState = { errors: {} };

export function InviteForm({ action, roleLabels }: { action: ServerAction; roleLabels: RoleLabels }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const value = (key: string) => (state.values?.[key] === undefined ? "" : String(state.values[key]));
  const L = (role: (typeof ORG_ROLES)[number]) => labelForRole(roleLabels, role);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-[16px] border border-line p-3.5">
      {state.errors.form && <div className="text-[13.5px] font-semibold text-danger">{state.errors.form}</div>}

      <div>
        <label className={labelClass} htmlFor="email">
          Email
        </label>
        <input className={fieldClass(err("email"))} id="email" name="email" type="email" autoComplete="off" inputMode="email" required defaultValue={value("email")} />
        {err("email") && <p className={errorClass}>{err("email")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="role">
          Role
        </label>
        <select className={fieldClass(err("role"))} id="role" name="role" defaultValue={value("role") || "staff"}>
          {ORG_ROLES.map((r) => (
            <option key={r} value={r}>
              {L(r)}
            </option>
          ))}
        </select>
        {err("role") && <p className={errorClass}>{err("role")}</p>}
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {L("staff")}s add and edit athletes, targets and documents. {L("member")}s can see everything and change nothing. {L("owner")}s can also manage
          members and schools.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="fullName">
          Name (optional)
        </label>
        <input className={inputClass} id="fullName" name="fullName" autoComplete="off" defaultValue={value("fullName")} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Sending..." : "Send Invite"}
      </button>
    </form>
  );
}
