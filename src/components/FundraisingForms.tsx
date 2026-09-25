"use client";

import { useActionState, useState } from "react";
import { GIFT_CATEGORIES, CATEGORY_LABEL, formatMoney, toCents } from "@/lib/fundraising/rollup";
import type { FundraisingActionState } from "@/lib/actions/fundraising";
import { Body, Button, Field, Form, Grid2, Prose, Row, Section, SelectField, Stack, TextAreaField } from "@/components/kit";

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

      <Prose>
        Leave a category blank and the overview says no target rather than showing it at 0%. Those are different statements and only one
        of them is a problem.
      </Prose>

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

export function CampaignForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" error={err("name")} required />

      <SelectField name="kind" label="Kind" error={err("kind")} defaultValue="event">
        {CAMPAIGN_KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </SelectField>

      <Grid2>
        <Field name="startsOn" label="Starts" type="date" />
        <Field name="endsOn" label="Ends" type="date" error={err("endsOn")} />
      </Grid2>

      <Field
        name="goalAmount"
        label="Goal"
        error={err("goalAmount")}
        inputMode="decimal"
        hint="Measured against cash raised, not pledges."
      />

      <TextAreaField name="notes" label="Notes" rows={2} />

      <Button disabled={pending}>{pending ? "Creating..." : "Create Campaign"}</Button>
    </Form>
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
    <Form action={formAction} error={state.errors.form}>
      <SelectField
        name="donorId"
        label="Who Promised It"
        error={err("donorId")}
        defaultValue=""
        required
        hint="Required, unlike a gift."
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

      <Field name="amount" label="Amount" error={err("amount")} inputMode="decimal" required />

      <Grid2>
        <Field name="promisedOn" label="Promised" type="date" error={err("promisedOn")} defaultValue={today} required />
        <Field name="dueOn" label="Due" type="date" error={err("dueOn")} />
      </Grid2>

      <Prose>Leave the due date blank if none was given. It will show as outstanding and never as overdue, which is the honest reading.</Prose>

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

      <TextAreaField name="notes" label="Notes" rows={2} />

      <Button disabled={pending}>{pending ? "Recording..." : "Record the Pledge"}</Button>
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

export function GrantForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [status, setStatus] = useState("researching");
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="funderName" label="Funder" error={err("funderName")} required />

      <SelectField name="status" label="Where It Stands" error={err("status")} value={status} onChange={(e) => setStatus(e.target.value)}>
        {GRANT_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </SelectField>

      <Grid2>
        <Field name="amountRequested" label="Requesting" inputMode="decimal" />
        <Field name="deadlineOn" label="Deadline" type="date" />
      </Grid2>

      {/* Only once it has been awarded, because until then there is no
          amount and asking for one invites a guess. */}
      {status === "awarded" && (
        <Field
          name="amountAwarded"
          label="Amount Awarded"
          error={err("amountAwarded")}
          inputMode="decimal"
          hint="The money itself is recorded separately, as a gift in Foundation Grants."
        />
      )}

      <Section label="Dates That Bite Later" role="time" kind="clock">
        <Prose>Most of a grant&apos;s life happens before any money exists, and these are the ones that get missed.</Prose>
        <Grid2>
          <Field name="appliedOn" label="Submitted" type="date" />
          <Field name="decisionExpectedOn" label="Decision Expected" type="date" />
        </Grid2>
        <Field name="reportDueOn" label="Report Due" type="date" />
      </Section>

      <TextAreaField name="notes" label="Notes" rows={2} />

      <Button disabled={pending}>{pending ? "Saving..." : "Track It"}</Button>
    </Form>
  );
}
