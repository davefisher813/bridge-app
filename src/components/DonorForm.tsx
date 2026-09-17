"use client";

import { useActionState } from "react";
import type { FundraisingActionState } from "@/lib/actions/fundraising";
import { errorClass, fieldClass, inputClass, labelClass, submitClass } from "@/components/formStyles";

type ServerAction = (prevState: FundraisingActionState, formData: FormData) => Promise<FundraisingActionState>;

const EMPTY_STATE: FundraisingActionState = { errors: {} };

const DONOR_TYPES = [
  { value: "individual", label: "Individual" },
  { value: "board_member", label: "Board member" },
  { value: "corporate", label: "Corporate" },
  { value: "foundation", label: "Foundation" },
  { value: "other", label: "Other" },
];

export function DonorForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.errors.form && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[14.5px] font-semibold text-danger">
          {state.errors.form}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="name">
          Name
        </label>
        <input className={fieldClass(err("name"))} id="name" name="name" required />
        {err("name") && <p className={errorClass}>{err("name")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="donorType">
          Type
        </label>
        <select className={fieldClass(err("donorType"))} id="donorType" name="donorType" defaultValue="individual">
          {DONOR_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {err("donorType") && <p className={errorClass}>{err("donorType")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Board member is its own type because board giving is a separate line on the P&amp;L.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="email">
          Email
        </label>
        <input className={inputClass} id="email" name="email" type="email" />
      </div>

      <div>
        <label className={labelClass} htmlFor="phone">
          Phone
        </label>
        <input className={inputClass} id="phone" name="phone" type="tel" />
      </div>

      <div>
        <label className={labelClass} htmlFor="address">
          Address
        </label>
        <textarea className={inputClass} id="address" name="address" rows={2} />
        <p className="mt-1 text-[12.5px] leading-tight text-muted">Needed on an acknowledgment letter, which is why it is here.</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea className={inputClass} id="notes" name="notes" rows={2} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Adding..." : "Add donor"}
      </button>
    </form>
  );
}
