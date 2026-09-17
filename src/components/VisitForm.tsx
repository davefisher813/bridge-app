"use client";

import { useActionState } from "react";
import { VISIT_TYPES } from "@/lib/validation/visit";
import type { VisitActionState } from "@/lib/actions/visits";
import { inputClass, labelClass, submitSmallClass } from "@/components/formStyles";

type ServerAction = (prevState: VisitActionState, formData: FormData) => Promise<VisitActionState>;

const EMPTY_STATE: VisitActionState = { errors: {} };

const VISIT_TYPE_LABEL: Record<(typeof VISIT_TYPES)[number], string> = {
  official: "Official",
  unofficial: "Unofficial",
  junior_day: "Junior day",
  camp: "Camp",
  other: "Other",
};

export function VisitForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-[16px] border border-line bg-bg/50 p-3.5">
      {state.errors.form && <div className="text-[13.5px] font-semibold text-danger">{state.errors.form}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="visitType">
            Type
          </label>
          <select className={inputClass} id="visitType" name="visitType" defaultValue="unofficial">
            {VISIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {VISIT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="visitDate">
            Date
          </label>
          <input className={inputClass} id="visitDate" name="visitDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="impression">
          Impression
        </label>
        <input className={inputClass} id="impression" name="impression" placeholder="How'd it go" />
      </div>
      <div>
        <label className={labelClass} htmlFor="nextStep">
          Next step
        </label>
        <input className={inputClass} id="nextStep" name="nextStep" placeholder="What happens next" />
      </div>
      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <input className={inputClass} id="notes" name="notes" />
      </div>
      <button type="submit" disabled={pending} className={submitSmallClass}>
        {pending ? "Logging..." : "Log visit"}
      </button>
    </form>
  );
}
