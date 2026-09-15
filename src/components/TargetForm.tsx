"use client";

import { useActionState } from "react";
import { TARGET_STATUSES } from "@/lib/validation/target";
import type { TargetActionState } from "@/lib/actions/targets";

type ServerAction = (prevState: TargetActionState, formData: FormData) => Promise<TargetActionState>;

export interface TargetFormOption {
  id: string;
  label: string;
}

export interface TargetFormInitialValues {
  athleteId?: string;
  schoolId?: string;
  status?: string;
  coachName?: string;
  notes?: string;
  visitDate?: string;
}

const EMPTY_STATE: TargetActionState = { errors: {} };

const inputClass =
  "w-full rounded-[12px] border border-line bg-bg px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const labelClass = "mb-1.5 block text-[12px] font-bold text-muted";
const errorClass = "mt-1 text-[11.5px] font-semibold text-danger";

export function TargetForm({
  action,
  athletes,
  schools,
  initialValues = {},
  submitLabel,
}: {
  action: ServerAction;
  athletes: TargetFormOption[];
  schools: TargetFormOption[];
  initialValues?: TargetFormInitialValues;
  submitLabel: string;
}) {
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
        <label className={labelClass} htmlFor="athleteId">
          Athlete
        </label>
        <select className={inputClass} id="athleteId" name="athleteId" defaultValue={initialValues.athleteId ?? ""} required>
          <option value="" disabled>
            Select an athlete
          </option>
          {athletes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        {err("athleteId") && <p className={errorClass}>{err("athleteId")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="schoolId">
          School
        </label>
        <select className={inputClass} id="schoolId" name="schoolId" defaultValue={initialValues.schoolId ?? ""} required>
          <option value="" disabled>
            Select a school
          </option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {err("schoolId") && <p className={errorClass}>{err("schoolId")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="status">
          Status
        </label>
        <select className={inputClass} id="status" name="status" defaultValue={initialValues.status ?? "Target"}>
          {TARGET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="coachName">
          Coach name
        </label>
        <input className={inputClass} id="coachName" name="coachName" defaultValue={initialValues.coachName ?? ""} placeholder="T. Reilly" />
      </div>

      <div>
        <label className={labelClass} htmlFor="visitDate">
          Visit date
        </label>
        <input className={inputClass} id="visitDate" name="visitDate" type="date" defaultValue={initialValues.visitDate ?? ""} />
        <p className="mt-1 text-[11.5px] text-muted">Shows up on Today's "Upcoming" once set.</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea className={`${inputClass} min-h-[90px] resize-y`} id="notes" name="notes" defaultValue={initialValues.notes ?? ""} />
      </div>

      <button type="submit" disabled={pending} className="mt-1 rounded-full bg-accent py-3 text-center text-[14px] font-bold text-white disabled:opacity-60">
        {pending ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
