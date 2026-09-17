"use client";

import { useActionState, useState } from "react";
import { GIFT_CATEGORIES, CATEGORY_LABEL, formatMoney } from "@/lib/fundraising/rollup";
import { GIFT_METHODS, METHOD_LABEL } from "@/lib/validation/gift";
import type { FundraisingActionState } from "@/lib/actions/fundraising";
import { errorClass, fieldClass, inputClass, labelClass, submitClass } from "@/components/formStyles";

type ServerAction = (prevState: FundraisingActionState, formData: FormData) => Promise<FundraisingActionState>;

const EMPTY_STATE: FundraisingActionState = { errors: {} };

export interface BoardMemberOption {
  id: string;
  name: string;
  boardName: string;
}

export interface OpenPledge {
  id: string;
  donorId: string | null;
  donorName: string;
  outstandingCents: number;
}

export function GiftForm({
  action,
  donors,
  campaigns,
  openPledges,
  boardMembers,
  today,
}: {
  action: ServerAction;
  donors: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  openPledges: OpenPledge[];
  // Empty when the board module is off, which is what keeps the field
  // off the screen for an org that has no boards.
  boardMembers: BoardMemberOption[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  // The in-kind description is required only when the method is in
  // kind, so the field appears when it becomes required rather than
  // sitting there confusing everybody the rest of the time.
  const [method, setMethod] = useState<string>("check");
  const [donorId, setDonorId] = useState<string>("");

  const isInKind = method === "in_kind";
  // Only pledges belonging to the selected donor. A payment against
  // somebody else's promise is always a mistake, so it is not offered.
  const pledgesForDonor = donorId ? openPledges.filter((p) => p.donorId === donorId) : [];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.errors.form && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[14.5px] font-semibold text-danger">
          {state.errors.form}
        </div>
      )}

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
        <p className="mt-1 text-[12.5px] leading-tight text-muted">A negative amount records a refund or a correction.</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="donorId">
          Donor
        </label>
        <select className={inputClass} id="donorId" name="donorId" value={donorId} onChange={(e) => setDonorId(e.target.value)}>
          <option value="">Anonymous</option>
          {donors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Leave it anonymous for cash in a bucket at an event. It still counts in the total and not in the supporter count.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="receivedOn">
            Received
          </label>
          <input
            className={`${fieldClass(err("receivedOn"))} tabular-nums`}
            id="receivedOn"
            name="receivedOn"
            type="date"
            defaultValue={today}
            required
          />
          {err("receivedOn") && <p className={errorClass}>{err("receivedOn")}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="method">
            How
          </label>
          <select className={fieldClass(err("method"))} id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {GIFT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
          {err("method") && <p className={errorClass}>{err("method")}</p>}
        </div>
      </div>

      {isInKind && (
        <div>
          <label className={labelClass} htmlFor="inKindDescription">
            What was given
          </label>
          <input
            className={fieldClass(err("inKindDescription"))}
            id="inKindDescription"
            name="inKindDescription"
            placeholder="Two cases of water, printing for the event"
          />
          {err("inKindDescription") && <p className={errorClass}>{err("inKindDescription")}</p>}
          <p className="mt-1 text-[12.5px] leading-tight text-muted">
            Counted as support, never as cash. An in-kind amount with no description cannot be substantiated later.
          </p>
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="category">
          Category
        </label>
        <select className={fieldClass(err("category"))} id="category" name="category" defaultValue="individual">
          {GIFT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        {err("category") && <p className={errorClass}>{err("category")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">The same five rows as the P&amp;L the board already sees.</p>
      </div>

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

      {pledgesForDonor.length > 0 && (
        <div>
          <label className={labelClass} htmlFor="pledgeId">
            Pay down a pledge
          </label>
          <select className={inputClass} id="pledgeId" name="pledgeId" defaultValue="">
            <option value="">Not against a pledge</option>
            {pledgesForDonor.map((p) => (
              <option key={p.id} value={p.id}>
                {formatMoney(p.outstandingCents)} outstanding
              </option>
            ))}
          </select>
          <p className="mt-1 text-[12.5px] leading-tight text-muted">
            Linking it reduces what is outstanding instead of leaving the promise open alongside the payment.
          </p>
        </div>
      )}

      {boardMembers.length > 0 && (
        <div>
          <label className={labelClass} htmlFor="solicitedBy">
            Brought in by
          </label>
          <select className={inputClass} id="solicitedBy" name="solicitedBy" defaultValue="">
            <option value="">Nobody in particular</option>
            {boardMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}, {m.boardName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[12.5px] leading-tight text-muted">
            Credits this toward their give/get. If they are also the donor, it still counts once.
          </p>
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="externalRef">
          Reference
        </label>
        <input className={fieldClass(err("externalRef"))} id="externalRef" name="externalRef" placeholder="Stripe payment id or check number" />
        {err("externalRef") && <p className={errorClass}>{err("externalRef")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Optional, and the same reference can only be recorded once, so a payment cannot be entered twice by accident.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea className={inputClass} id="notes" name="notes" rows={2} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Recording..." : "Record it"}
      </button>
    </form>
  );
}
