"use client";

import { useActionState } from "react";
import { SCHOOL_DIVISIONS } from "@/lib/validation/school";
import type { SchoolActionState } from "@/lib/actions/schools";

type ServerAction = (prevState: SchoolActionState, formData: FormData) => Promise<SchoolActionState>;

const EMPTY_STATE: SchoolActionState = { errors: {} };

const inputClass =
  "w-full rounded-[12px] border border-line bg-bg px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const labelClass = "mb-1.5 block text-[12px] font-bold text-muted";
const errorClass = "mt-1 text-[11.5px] font-semibold text-danger";

export function SchoolForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.errors.form && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[13px] font-semibold text-danger">
          {state.errors.form}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="name">
          School name
        </label>
        <input className={inputClass} id="name" name="name" placeholder="Test University" required />
        {err("name") && <p className={errorClass}>{err("name")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="division">
          Division
        </label>
        <select className={inputClass} id="division" name="division" defaultValue="D1">
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
        <p className="mt-1 text-[11.5px] text-muted">Comma-separated.</p>
      </div>

      <button type="submit" disabled={pending} className="mt-1 rounded-full bg-accent py-3 text-center text-[14px] font-bold text-white disabled:opacity-60">
        {pending ? "Adding..." : "Add school"}
      </button>
    </form>
  );
}
