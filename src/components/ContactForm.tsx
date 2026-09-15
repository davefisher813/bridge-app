"use client";

import { useActionState } from "react";
import { CONTACT_ROLES } from "@/lib/validation/contact";
import type { ContactActionState } from "@/lib/actions/contacts";

type ServerAction = (prevState: ContactActionState, formData: FormData) => Promise<ContactActionState>;

export interface ContactFormSchoolOption {
  id: string;
  label: string;
}

const EMPTY_STATE: ContactActionState = { errors: {} };

const inputClass =
  "w-full rounded-[12px] border border-line bg-bg px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const labelClass = "mb-1.5 block text-[12px] font-bold text-muted";
const errorClass = "mt-1 text-[11.5px] font-semibold text-danger";

const ROLE_LABEL: Record<(typeof CONTACT_ROLES)[number], string> = {
  hs_coach: "HS coach",
  travel_coach: "Travel coach",
  parent_guardian: "Parent/guardian",
  advisor: "Advisor",
  college_coach: "College coach",
  other: "Other",
};

export function ContactForm({ action, schools }: { action: ServerAction; schools: ContactFormSchoolOption[] }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-[16px] border border-line bg-bg/50 p-3.5">
      {state.errors.form && <div className="text-[12.5px] font-semibold text-danger">{state.errors.form}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="name">
            Name
          </label>
          <input className={inputClass} id="name" name="name" placeholder="T. Reilly" required />
          {err("name") && <p className={errorClass}>{err("name")}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="role">
            Role
          </label>
          <select className={inputClass} id="role" name="role" defaultValue="hs_coach">
            {CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="schoolId">
          School (if a college coach)
        </label>
        <select className={inputClass} id="schoolId" name="schoolId" defaultValue="">
          <option value="">No school</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="email">
            Email
          </label>
          <input className={inputClass} id="email" name="email" type="email" />
          {err("email") && <p className={errorClass}>{err("email")}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="phone">
            Phone
          </label>
          <input className={inputClass} id="phone" name="phone" type="tel" />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <input className={inputClass} id="notes" name="notes" />
      </div>
      <button type="submit" disabled={pending} className="rounded-full bg-accent py-2.5 text-center text-[13px] font-bold text-white disabled:opacity-60">
        {pending ? "Adding..." : "Add contact"}
      </button>
    </form>
  );
}
