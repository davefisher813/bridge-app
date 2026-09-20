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
    <Form action={formAction} error={state.errors.form}>
      <Field
        name="amount"
        label="Amount"
        error={err("amount")}
        inputMode="decimal"
        required
        hint="A negative amount records a refund or a correction."
      />

      <SelectField
        name="donorId"
        label="Donor"
        value={donorId}
        onChange={(e) => setDonorId(e.target.value)}
        hint="Leave it anonymous for cash in a bucket at an event. It still counts in the total and not in the supporter count."
      >
        <option value="">Anonymous</option>
        {donors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>

      <Grid2>
        <Field name="receivedOn" label="Received" type="date" error={err("receivedOn")} defaultValue={today} required />
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
          hint="Counted as support, never as cash. An in-kind amount with no description cannot be substantiated later."
        />
      )}

      <SelectField name="category" label="Category" error={err("category")} defaultValue="individual" hint="The same five rows as the P&L the board already sees.">
        {GIFT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABEL[c]}
          </option>
        ))}
      </SelectField>

      {campaigns.length > 0 && (
        <SelectField name="campaignId" label="Campaign" defaultValue="">
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
          defaultValue=""
          hint="Linking it reduces what is outstanding instead of leaving the promise open alongside the payment."
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
          defaultValue=""
          hint="Credits this toward their give/get. If they are also the donor, it still counts once."
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
        hint="Optional, and the same reference can only be recorded once, so a payment cannot be entered twice by accident."
      />

      <TextAreaField name="notes" label="Notes" rows={2} />

      <Button disabled={pending}>{pending ? "Recording..." : "Record Gift"}</Button>
    </Form>
  );
}
