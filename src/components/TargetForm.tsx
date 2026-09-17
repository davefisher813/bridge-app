"use client";

import { useActionState, useState } from "react";
import { OFFER_TYPES, TARGET_STATUSES } from "@/lib/validation/target";
import type { TargetActionState } from "@/lib/actions/targets";
import { errorClass, fieldClass, inputClass, labelClass, submitClass } from "@/components/formStyles";

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
  offerType?: string;
  offerScholarshipPercent?: number;
}

const OFFER_TYPE_LABEL: Record<(typeof OFFER_TYPES)[number], string> = {
  scholarship: "Scholarship",
  written: "Written (non-scholarship)",
  verbal: "Verbal",
  preferred_walk_on: "Preferred walk-on",
  admission_only: "Admission only",
  walk_on: "Walk-on",
};

const EMPTY_STATE: TargetActionState = { errors: {} };

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
  const [offerType, setOfferType] = useState<string>(initialValues.offerType ?? "");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.errors.form && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[14.5px] font-semibold text-danger">
          {state.errors.form}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="athleteId">
          Athlete
        </label>
        <select className={fieldClass(err("athleteId"))} id="athleteId" name="athleteId" defaultValue={initialValues.athleteId ?? ""} required>
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
        <select className={fieldClass(err("schoolId"))} id="schoolId" name="schoolId" defaultValue={initialValues.schoolId ?? ""} required>
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
        <p className="mt-1 text-[12.5px] text-muted">Shows up on Today's "Upcoming" once set.</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="offerType">
          Offer
        </label>
        <select
          className={inputClass}
          id="offerType"
          name="offerType"
          value={offerType}
          onChange={(e) => setOfferType(e.target.value)}
        >
          <option value="">No offer yet</option>
          {OFFER_TYPES.map((t) => (
            <option key={t} value={t}>
              {OFFER_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[12.5px] text-muted">Separate from status - this is the actual offer on file, not just the pipeline stage.</p>
      </div>

      {offerType === "scholarship" && (
        <div>
          <label className={labelClass} htmlFor="offerScholarshipPercent">
            Scholarship percent
          </label>
          <input
            className={fieldClass(err("offerScholarshipPercent"))}
            id="offerScholarshipPercent"
            name="offerScholarshipPercent"
            type="number"
            min="0"
            max="100"
            defaultValue={initialValues.offerScholarshipPercent ?? ""}
          />
          {err("offerScholarshipPercent") && <p className={errorClass}>{err("offerScholarshipPercent")}</p>}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea className={`${inputClass} min-h-[90px] resize-y`} id="notes" name="notes" defaultValue={initialValues.notes ?? ""} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
