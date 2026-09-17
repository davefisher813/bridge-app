"use client";

import { useActionState } from "react";
import { GIFT_CATEGORIES, CATEGORY_LABEL, formatMoney, toCents } from "@/lib/fundraising/rollup";
import type { FundraisingActionState } from "@/lib/actions/fundraising";
import { errorClass, fieldClass, inputClass, labelClass, submitClass } from "@/components/formStyles";
import { useState } from "react";

type ServerAction = (prevState: FundraisingActionState, formData: FormData) => Promise<FundraisingActionState>;

const EMPTY_STATE: FundraisingActionState = { errors: {} };

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[14.5px] font-semibold text-danger">{message}</div>
  );
}

// ── Budget ───────────────────────────────────────────────────────────
// Five numbers, one per P&L row, plus a running total. The total is
// computed as you type rather than after saving, because a budget that
// does not add up to what the board approved is the mistake worth
// catching before it is stored.
export function BudgetForm({
  action,
  fiscalYear,
  current,
}: {
  action: ServerAction;
  fiscalYear: number;
  current: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [values, setValues] = useState<Record<string, string>>(current);
  const err = (key: string) => state.errors[key];

  const totalCents = GIFT_CATEGORIES.reduce((sum, c) => sum + toCents(values[c] ?? ""), 0);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.errors.form} />

      <div className="flex flex-col gap-3">
        {GIFT_CATEGORIES.map((c) => (
          <div key={c}>
            <label className={labelClass} htmlFor={`budget_${c}`}>
              {CATEGORY_LABEL[c]}
            </label>
            <input
              className={`${fieldClass(err(`budget_${c}`))} tabular-nums`}
              id={`budget_${c}`}
              name={`budget_${c}`}
              inputMode="decimal"
              placeholder="$0"
              value={values[c] ?? ""}
              onChange={(e) => setValues({ ...values, [c]: e.target.value })}
            />
            {err(`budget_${c}`) && <p className={errorClass}>{err(`budget_${c}`)}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-[10px] border-l-[5px] border-l-ios-blue bg-paper px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[14.5px] font-bold text-ink">Total for {fiscalYear}</div>
          <div className="text-[16px] font-extrabold tabular-nums text-ink">{formatMoney(totalCents)}</div>
        </div>
      </div>

      <p className="text-[12.5px] leading-tight text-muted">
        Leave a category blank and the overview says no target rather than showing it at 0%. Those are different statements and only one
        of them is a problem.
      </p>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving..." : "Save the budget"}
      </button>
    </form>
  );
}

// ── Campaign ─────────────────────────────────────────────────────────
const CAMPAIGN_KINDS = [
  { value: "event", label: "Event" },
  { value: "appeal", label: "Appeal" },
  { value: "grant", label: "Grant" },
  { value: "other", label: "Other" },
];

export function CampaignForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.errors.form} />

      <div>
        <label className={labelClass} htmlFor="name">
          Name
        </label>
        <input className={fieldClass(err("name"))} id="name" name="name" required />
        {err("name") && <p className={errorClass}>{err("name")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="kind">
          Kind
        </label>
        <select className={fieldClass(err("kind"))} id="kind" name="kind" defaultValue="event">
          {CAMPAIGN_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {err("kind") && <p className={errorClass}>{err("kind")}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="startsOn">
            Starts
          </label>
          <input className={inputClass} id="startsOn" name="startsOn" type="date" />
        </div>
        <div>
          <label className={labelClass} htmlFor="endsOn">
            Ends
          </label>
          <input className={fieldClass(err("endsOn"))} id="endsOn" name="endsOn" type="date" />
          {err("endsOn") && <p className={errorClass}>{err("endsOn")}</p>}
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="goalAmount">
          Goal
        </label>
        <input
          className={`${fieldClass(err("goalAmount"))} tabular-nums`}
          id="goalAmount"
          name="goalAmount"
          inputMode="decimal"
          placeholder="$0"
        />
        {err("goalAmount") && <p className={errorClass}>{err("goalAmount")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Measured against cash raised. Pledges show beside the bar, never inside it, so promises cannot complete a campaign.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea className={inputClass} id="notes" name="notes" rows={2} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Creating..." : "Create it"}
      </button>
    </form>
  );
}

// ── Pledge ───────────────────────────────────────────────────────────
export function PledgeForm({
  action,
  donors,
  campaigns,
  today,
}: {
  action: ServerAction;
  donors: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.errors.form} />

      <div>
        <label className={labelClass} htmlFor="donorId">
          Who promised it
        </label>
        <select className={fieldClass(err("donorId"))} id="donorId" name="donorId" defaultValue="" required>
          <option value="" disabled>
            Pick a donor
          </option>
          {donors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {err("donorId") && <p className={errorClass}>{err("donorId")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Required, unlike a gift. An anonymous promise is not one anybody can follow up on.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="amount">
          Amount
        </label>
        <input
          className={`${fieldClass(err("amount"))} text-[20px] font-bold tabular-nums`}
          id="amount"
          name="amount"
          inputMode="decimal"
          placeholder="$0.00"
          required
        />
        {err("amount") && <p className={errorClass}>{err("amount")}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="promisedOn">
            Promised
          </label>
          <input
            className={`${fieldClass(err("promisedOn"))} tabular-nums`}
            id="promisedOn"
            name="promisedOn"
            type="date"
            defaultValue={today}
            required
          />
          {err("promisedOn") && <p className={errorClass}>{err("promisedOn")}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="dueOn">
            Due
          </label>
          <input className={`${fieldClass(err("dueOn"))} tabular-nums`} id="dueOn" name="dueOn" type="date" />
          {err("dueOn") && <p className={errorClass}>{err("dueOn")}</p>}
        </div>
      </div>

      <p className="text-[12.5px] leading-tight text-muted">
        Leave the due date blank if none was given. It will show as outstanding and never as overdue, which is the honest reading.
      </p>

      {campaigns.length > 0 && (
        <div>
          <label className={labelClass} htmlFor="campaignId">
            Campaign
          </label>
          <select className={inputClass} id="campaignId" name="campaignId" defaultValue="">
            <option value="">None</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea className={inputClass} id="notes" name="notes" rows={2} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Recording..." : "Record the pledge"}
      </button>
    </form>
  );
}

// ── Grant ────────────────────────────────────────────────────────────
const GRANT_STATUSES = [
  { value: "researching", label: "Researching" },
  { value: "applied", label: "Applied" },
  { value: "pending", label: "Awaiting decision" },
  { value: "awarded", label: "Awarded" },
  { value: "declined", label: "Declined" },
  { value: "closed", label: "Closed" },
];

export function GrantForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [status, setStatus] = useState("researching");
  const err = (key: string) => state.errors[key];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.errors.form} />

      <div>
        <label className={labelClass} htmlFor="funderName">
          Funder
        </label>
        <input className={fieldClass(err("funderName"))} id="funderName" name="funderName" required />
        {err("funderName") && <p className={errorClass}>{err("funderName")}</p>}
      </div>

      <div>
        <label className={labelClass} htmlFor="status">
          Where it stands
        </label>
        <select
          className={fieldClass(err("status"))}
          id="status"
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {GRANT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {err("status") && <p className={errorClass}>{err("status")}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="amountRequested">
            Requesting
          </label>
          <input className={`${inputClass} tabular-nums`} id="amountRequested" name="amountRequested" inputMode="decimal" placeholder="$0" />
        </div>
        <div>
          <label className={labelClass} htmlFor="deadlineOn">
            Deadline
          </label>
          <input className={`${inputClass} tabular-nums`} id="deadlineOn" name="deadlineOn" type="date" />
        </div>
      </div>

      {/* Only once it has been awarded, because until then there is no
          amount and asking for one invites a guess. */}
      {status === "awarded" && (
        <div>
          <label className={labelClass} htmlFor="amountAwarded">
            Amount awarded
          </label>
          <input
            className={`${fieldClass(err("amountAwarded"))} tabular-nums`}
            id="amountAwarded"
            name="amountAwarded"
            inputMode="decimal"
            placeholder="$0"
          />
          {err("amountAwarded") && <p className={errorClass}>{err("amountAwarded")}</p>}
          <p className="mt-1 text-[12.5px] leading-tight text-muted">
            The money itself is recorded separately as a gift in the Foundation Grants category, so an award is never counted both as a
            win here and as revenue there.
          </p>
        </div>
      )}

      <div>
        <div className={labelClass}>Dates that bite later</div>
        <p className="mb-2 text-[12.5px] leading-tight text-muted">
          Most of a grant&apos;s life happens before any money exists, and these are the ones that get missed.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="appliedOn">
              Submitted
            </label>
            <input className={`${inputClass} tabular-nums`} id="appliedOn" name="appliedOn" type="date" />
          </div>
          <div>
            <label className={labelClass} htmlFor="decisionExpectedOn">
              Decision expected
            </label>
            <input className={`${inputClass} tabular-nums`} id="decisionExpectedOn" name="decisionExpectedOn" type="date" />
          </div>
        </div>
        <div className="mt-2">
          <label className={labelClass} htmlFor="reportDueOn">
            Report due
          </label>
          <input className={`${inputClass} tabular-nums`} id="reportDueOn" name="reportDueOn" type="date" />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea className={inputClass} id="notes" name="notes" rows={2} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving..." : "Track it"}
      </button>
    </form>
  );
}
