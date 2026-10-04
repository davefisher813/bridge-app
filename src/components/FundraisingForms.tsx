"use client";

import { useActionState, useState } from "react";
import { GIFT_CATEGORIES, CATEGORY_LABEL, formatMoney, toCents } from "@/lib/fundraising/rollup";
import type { FundraisingActionState } from "@/lib/actions/fundraising";
import { Body, Button, Field, Form, Grid2, Prose, Row, Section, SelectField, Stack, SuggestField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: FundraisingActionState, formData: FormData) => Promise<FundraisingActionState>;

const EMPTY_STATE: FundraisingActionState = { errors: {} };

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
    <Form action={formAction} error={state.errors.form}>
      <Stack>
        {GIFT_CATEGORIES.map((c) => (
          <Field
            key={c}
            name={`budget_${c}`}
            label={CATEGORY_LABEL[c]}
            error={err(`budget_${c}`)}
            inputMode="decimal"
            value={values[c] ?? ""}
            onChange={(e) => setValues({ ...values, [c]: e.target.value })}
          />
        ))}
      </Stack>

      <Row
        kind="money"
        role="contact"
        emphasis="bold"
        title={`Total for ${fiscalYear}`}
        trailing={
          <Body weight="bold" numeric>
            {formatMoney(totalCents)}
          </Body>
        }
      />


      <Button disabled={pending}>{pending ? "Saving..." : "Save the Budget"}</Button>
    </Form>
  );
}

// ── Campaign ─────────────────────────────────────────────────────────
const CAMPAIGN_KINDS = [
  { value: "event", label: "Event" },
  { value: "appeal", label: "Appeal" },
  { value: "grant", label: "Grant" },
  { value: "other", label: "Other" },
];

// What a campaign already says, for Edit Campaign.
export interface CampaignInitial {
  name: string;
  kind: string;
  startsOn: string | null;
  endsOn: string | null;
  goalAmount: string | null;
  notes: string | null;
}

export function CampaignForm({ action, initial, submitLabel = "Create Campaign" }: { action: ServerAction; initial?: CampaignInitial; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" error={err("name")} defaultValue={initial?.name ?? ""} required />

      <SelectField name="kind" label="Kind" error={err("kind")} defaultValue={initial?.kind ?? "event"}>
        {CAMPAIGN_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </SelectField>

      <Grid2>
        <Field name="startsOn" label="Starts" type="date" defaultValue={initial?.startsOn ?? ""} />
        <Field name="endsOn" label="Ends" type="date" error={err("endsOn")} defaultValue={initial?.endsOn ?? ""} />
      </Grid2>

      <Field
        name="goalAmount"
        label="Goal"
        error={err("goalAmount")}
        inputMode="decimal"
        defaultValue={initial?.goalAmount ?? ""}
      />

      <TextAreaField name="notes" label="Notes" rows={2} defaultValue={initial?.notes ?? ""} />

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}

// ── Pledge ───────────────────────────────────────────────────────────
// What a pledge already says, for Edit Pledge. Status is open or written
// off; fulfilled follows from the payments and is not picked.
export interface PledgeInitial {
  donorId: string;
  amount: string;
  promisedOn: string;
  dueOn: string | null;
  campaignId: string | null;
  notes: string | null;
  status: string;
}

export function PledgeForm({
  action,
  donors,
  campaigns,
  today,
  initial,
  submitLabel = "Record the Pledge",
}: {
  action: ServerAction;
  donors: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  today: string;
  initial?: PledgeInitial;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField
        name="donorId"
        label="Who Promised It"
        error={err("donorId")}
        defaultValue={initial?.donorId ?? ""}
        required
      >
        <option value="" disabled>
          Pick a donor
        </option>
        {donors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>

      <Field name="amount" label="Amount" error={err("amount")} inputMode="decimal" defaultValue={initial?.amount ?? ""} required />

      <Grid2>
        <Field name="promisedOn" label="Promised" type="date" error={err("promisedOn")} defaultValue={initial?.promisedOn ?? today} required />
        <Field name="dueOn" label="Due" type="date" error={err("dueOn")} defaultValue={initial?.dueOn ?? ""} />
      </Grid2>


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

      {initial && (
        <SelectField name="status" label="Still Expected" defaultValue={initial.status === "written_off" ? "written_off" : "open"}>
          <option value="open">Yes, keep following up</option>
          <option value="written_off">No, write it off</option>
        </SelectField>
      )}

      <TextAreaField name="notes" label="Notes" rows={2} defaultValue={initial?.notes ?? ""} />

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
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

// What a grant already says, for Edit Grant. Money comes in as the text
// the field shows.
export interface GrantInitial {
  funderName: string;
  status: string;
  amountRequested: string | null;
  amountAwarded: string | null;
  deadlineOn: string | null;
  appliedOn: string | null;
  decisionExpectedOn: string | null;
  reportDueOn: string | null;
  notes: string | null;
}

export function GrantForm({ action, funders = [], initial, submitLabel = "Track It" }: { action: ServerAction; funders?: string[]; initial?: GrantInitial; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [status, setStatus] = useState(initial?.status ?? "researching");
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      {/* The donor names on file, so a foundation already in the address
          book is one tap, and saving links the grant to that donor. */}
      <SuggestField name="funderName" label="Funder" error={err("funderName")} suggestions={funders} defaultValue={initial?.funderName ?? ""} required />

      <SelectField name="status" label="Where It Stands" error={err("status")} value={status} onChange={(e) => setStatus(e.target.value)}>
        {GRANT_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </SelectField>

      <Grid2>
        <Field name="amountRequested" label="Requesting" inputMode="decimal" defaultValue={initial?.amountRequested ?? ""} />
        <Field name="deadlineOn" label="Deadline" type="date" defaultValue={initial?.deadlineOn ?? ""} />
      </Grid2>

      {/* Only once it has been awarded, because until then there is no
          amount and asking for one invites a guess. */}
      {status === "awarded" && (
        <Field
          name="amountAwarded"
          label="Amount Awarded"
          error={err("amountAwarded")}
          inputMode="decimal"
          defaultValue={initial?.amountAwarded ?? ""}
        />
      )}

      <Section label="Dates That Bite Later" role="time" kind="clock">
        <Grid2>
          <Field name="appliedOn" label="Submitted" type="date" defaultValue={initial?.appliedOn ?? ""} />
          <Field name="decisionExpectedOn" label="Decision Expected" type="date" defaultValue={initial?.decisionExpectedOn ?? ""} />
        </Grid2>
        <Field name="reportDueOn" label="Report Due" type="date" defaultValue={initial?.reportDueOn ?? ""} />
      </Section>

      <TextAreaField name="notes" label="Notes" rows={2} defaultValue={initial?.notes ?? ""} />

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
