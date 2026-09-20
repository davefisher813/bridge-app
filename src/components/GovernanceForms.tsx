"use client";

import { useActionState, useState } from "react";
import { BOARD_KINDS, BOARD_KIND_LABEL, BOARD_KIND_PURPOSE, DEFAULT_GIVE_GET_CENTS, DEFAULT_SEATS, type BoardKind } from "@/lib/governance/giveGet";
import { formatMoney } from "@/lib/fundraising/rollup";
import type { GovernanceActionState } from "@/lib/actions/governance";
import { Button, Field, Form, Grid2, Prose, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: GovernanceActionState, formData: FormData) => Promise<GovernanceActionState>;

const EMPTY_STATE: GovernanceActionState = { errors: {} };

export function BoardForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [kind, setKind] = useState<BoardKind>("executive");
  const err = (key: string) => state.errors[key];

  const defaults = DEFAULT_SEATS[kind];

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField name="kind" label="Tier" error={err("kind")} hint={BOARD_KIND_PURPOSE[kind]} value={kind} onChange={(e) => setKind(e.target.value as BoardKind)}>
        {BOARD_KINDS.map((k) => (
          <option key={k} value={k}>
            {BOARD_KIND_LABEL[k]}
          </option>
        ))}
      </SelectField>

      <Field name="name" label="Name" error={err("name")} defaultValue={BOARD_KIND_LABEL[kind]} key={kind} required />

      {/* Required only for a sport board, because the whole point of
          that tier is that there is one per sport. */}
      {kind === "sport" && <Field name="sport" label="Sport" hint="For example, baseball." error={err("sport")} />}

      <Field
        name="giveGet"
        label="Give/Get per Seat"
        error={err("giveGet")}
        hint="Prefilled from your governance document. Stored per board, so changing it here changes nothing anybody already agreed to."
        inputMode="decimal"
        className="tabular-nums"
        defaultValue={formatMoney(DEFAULT_GIVE_GET_CENTS[kind]).replace("$", "")}
        key={`gg-${kind}`}
      />

      <Grid2>
        <Field name="minSeats" label="Minimum Seats" inputMode="numeric" className="tabular-nums" defaultValue={defaults.min} key={`min-${kind}`} />
        <Field name="maxSeats" label="Maximum Seats" error={err("maxSeats")} inputMode="numeric" className="tabular-nums" defaultValue={defaults.max} key={`max-${kind}`} />
      </Grid2>
      {kind === "sport" && (
        <Prose>Your governance document says a sport board starts at three and can grow to five. Below the minimum is flagged, not blocked.</Prose>
      )}

      <TextAreaField name="description" label="Description" rows={2} />

      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create Board"}
      </Button>
    </Form>
  );
}

const SEAT_STATUSES = [
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "emeritus", label: "Emeritus" },
  { value: "resigned", label: "Resigned" },
];

export function BoardSeatForm({
  action,
  donors,
  defaultCommitment,
  today,
  roleSuggestions,
}: {
  action: ServerAction;
  donors: Array<{ id: string; name: string }>;
  defaultCommitment: string;
  today: string;
  roleSuggestions: string[];
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" error={err("name")} required />

      <Field
        name="roleTitle"
        label="Role"
        list="role-suggestions"
        hint={roleSuggestions.length > 0 ? `The core roles for this tier are ${roleSuggestions.join(", ")}. Anything else is fine too.` : undefined}
      />
      <datalist id="role-suggestions">
        {roleSuggestions.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <SelectField
        name="status"
        label="Status"
        error={err("status")}
        hint="Only an active seat counts toward the board's committed total. A prospect has not joined yet."
        defaultValue="prospect"
      >
        {SEAT_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </SelectField>

      <Field
        name="commitment"
        label="Commitment"
        error={err("commitment")}
        hint="Copied from the board, so changing the tier later does not rewrite what a sitting member agreed to."
        inputMode="decimal"
        className="tabular-nums"
        defaultValue={defaultCommitment}
      />

      <SelectField
        name="donorId"
        label="Donor Record"
        error={err("donorId")}
        hint="Linking finds their own giving automatically. Without it, only what they bring in can be credited."
        defaultValue=""
      >
        <option value="">Not linked</option>
        {donors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>

      <Grid2>
        <Field name="termStart" label="Term Starts" type="date" className="tabular-nums" defaultValue={today} />
        <Field name="termEnd" label="Term Ends" type="date" className="tabular-nums" error={err("termEnd")} />
      </Grid2>

      <Grid2>
        <Field name="email" label="Email" type="email" />
        <Field name="phone" label="Phone" type="tel" />
      </Grid2>

      <TextAreaField name="notes" label="Notes" rows={2} />

      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add Seat"}
      </Button>
    </Form>
  );
}
