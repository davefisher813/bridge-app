"use client";

import { useActionState } from "react";
import { COMMUNICATION_KINDS } from "@/lib/validation/communication";
import type { CommunicationActionState } from "@/lib/actions/communications";
import { inputClass, labelClass, submitSmallClass } from "@/components/formStyles";

type ServerAction = (prevState: CommunicationActionState, formData: FormData) => Promise<CommunicationActionState>;

const EMPTY_STATE: CommunicationActionState = { errors: {} };

const KIND_LABEL: Record<string, string> = {
  call: "Call",
  text: "Text",
  email: "Email",
  visit: "Visit",
  other: "Other",
};

export function CommunicationForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-[16px] border border-line bg-bg/50 p-3.5">
      {state.errors.form && <div className="text-[13.5px] font-semibold text-danger">{state.errors.form}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="kind">
            Type
          </label>
          <select className={inputClass} id="kind" name="kind" defaultValue="call">
            {COMMUNICATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="occurredOn">
            Date
          </label>
          <input className={inputClass} id="occurredOn" name="occurredOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <input className={inputClass} id="notes" name="notes" placeholder="What was discussed" />
      </div>
      <button type="submit" disabled={pending} className={submitSmallClass}>
        {pending ? "Logging..." : "Log communication"}
      </button>
    </form>
  );
}
