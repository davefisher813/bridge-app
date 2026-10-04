"use client";

import { useActionState, useState } from "react";
import { GIFT_CATEGORIES, CATEGORY_LABEL, formatMoney } from "@/lib/fundraising/rollup";
import { GIFT_METHODS, METHOD_LABEL } from "@/lib/validation/gift";
import type { FundraisingActionState } from "@/lib/actions/fundraising";
import { Button, Field, Form, Grid2, SelectField, TextAreaField } from "@/components/kit";

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

// What a gift already says, for Edit Gift. The amount comes in as the
// text the field shows.
export interface GiftInitial {
  amount: string;
  receivedOn: string;
  method: string;
  donorId: string | null;
  category: string;
  campaignId: string | null;
  pledgeId: string | null;
  solicitedBy: string | null;
  inKindDescription: string | null;
  externalRef: string | null;
  notes: string | null;
}

export function GiftForm({
  action,
  donors,
  campaigns,
  openPledges,
  boardMembers,
  today,
  initial,
  submitLabel = "Record Gift",
}: {
  action: ServerAction;
  donors: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  openPledges: OpenPledge[];
  // Empty when the board module is off, which is what keeps the field
  // off the screen for an org that has no boards.
  boardMembers: BoardMemberOption[];
  today: string;
  initial?: GiftInitial;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  // The in-kind description is required only when the method is in
  // kind, so the field appears when it becomes required rather than
  // sitting there confusing everybody the rest of the time.
  const [method, setMethod] = useState<string>(initial?.method ?? "check");
  const [donorId, setDonorId] = useState<string>(initial?.donorId ?? "");

  const isInKind = method === "in_kind";
  // Only pledges belonging to the selected donor. A payment against
  // somebody else's promise is always a mistake, so it is not offered.
  const pledgesForDonor = donorId ? openPledges.filter((p) => p.donorId === donorId) : [];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field
        name="amount"
        label="Amount"
        error={err("amount")}
        inputMode="decimal"
        defaultValue={initial?.amount ?? ""}
        required
        hint="A negative amount records a refund or a correction."
      />

      <SelectField
        name="donorId"
        label="Donor"
        value={donorId}
        onChange={(e) => setDonorId(e.target.value)}
        hint="Leave anonymous for cash collected at an event."
      >
        <option value="">Anonymous</option>
        {donors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>

      <Grid2>
        <Field name="receivedOn" label="Received" type="date" error={err("receivedOn")} defaultValue={initial?.receivedOn ?? today} required />
        <SelectField name="method" label="How" error={err("method")} value={method} onChange={(e) => setMethod(e.target.value)}>
          {GIFT_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </SelectField>
      </Grid2>

      {isInKind && (
        <Field
          name="inKindDescription"
          label="What Was Given"
          error={err("inKindDescription")}
          defaultValue={initial?.inKindDescription ?? ""}
          hint="Counted as support, never as cash."
        />
      )}

      <SelectField name="category" label="Category" error={err("category")} defaultValue={initial?.category ?? "individual"}>
        {GIFT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABEL[c]}
          </option>
        ))}
      </SelectField>

      {campaigns.length > 0 && (
        <SelectField name="campaignId" label="Campaign" defaultValue={initial?.campaignId ?? ""}>
          <option value="">None</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      )}

      {pledgesForDonor.length > 0 && (
        <SelectField
          name="pledgeId"
          label="Pay Down a Pledge"
          defaultValue={initial?.pledgeId ?? ""}
          hint="Reduces what is outstanding."
        >
          <option value="">Not against a pledge</option>
          {pledgesForDonor.map((p) => (
            <option key={p.id} value={p.id}>
              {formatMoney(p.outstandingCents)} outstanding
            </option>
          ))}
        </SelectField>
      )}

      {boardMembers.length > 0 && (
        <SelectField
          name="solicitedBy"
          label="Brought in By"
          defaultValue={initial?.solicitedBy ?? ""}
        >
          <option value="">Nobody in particular</option>
          {boardMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}, {m.boardName}
            </option>
          ))}
        </SelectField>
      )}

      <Field
        name="externalRef"
        label="Reference"
        error={err("externalRef")}
        defaultValue={initial?.externalRef ?? ""}
        hint="The same reference can only be recorded once."
      />

      <TextAreaField name="notes" label="Notes" rows={2} defaultValue={initial?.notes ?? ""} />

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
