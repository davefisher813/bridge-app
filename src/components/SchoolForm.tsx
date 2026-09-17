"use client";

import { useActionState } from "react";
import { SCHOOL_DIVISIONS } from "@/lib/validation/school";
import type { SchoolActionState } from "@/lib/actions/schools";
import { errorClass, fieldClass, inputClass, labelClass, submitClass } from "@/components/formStyles";

type ServerAction = (prevState: SchoolActionState, formData: FormData) => Promise<SchoolActionState>;

const EMPTY_STATE: SchoolActionState = { errors: {} };

export function SchoolForm({ action }: { action: ServerAction }) {
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
          School name
        </label>
        <input className={fieldClass(err("name"))} id="name" name="name" placeholder="Test University" required />
        {err("name") && <p className={errorClass}>{err("name")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="division">
          Division
        </label>
        <select className={fieldClass(err("division"))} id="division" name="division" defaultValue="D1">
          {SCHOOL_DIVISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {err("division") && <p className={errorClass}>{err("division")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="conference">
          Conference
        </label>
        <input className={inputClass} id="conference" name="conference" placeholder="Ivy League" />
      </div>

      <div>
        <label className={labelClass} htmlFor="sportsSponsored">
          Sports sponsored
        </label>
        <input className={inputClass} id="sportsSponsored" name="sportsSponsored" placeholder="baseball, softball" />
        <p className="mt-1 text-[12.5px] text-muted">Comma-separated.</p>
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Adding..." : "Add school"}
      </button>
    </form>
  );
}
