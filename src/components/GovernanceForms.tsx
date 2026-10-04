"use client";

import { useActionState, useState } from "react";
import { BOARD_KINDS, BOARD_KIND_LABEL, BOARD_KIND_PURPOSE, DEFAULT_GIVE_GET_CENTS, DEFAULT_SEATS, type BoardKind } from "@/lib/governance/giveGet";
import { formatMoney } from "@/lib/fundraising/rollup";
import { SPORTS } from "@/lib/fit/contract";
import type { GovernanceActionState } from "@/lib/actions/governance";
import { Button, Field, Form, Grid2, Prose, SelectField, SuggestField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: GovernanceActionState, formData: FormData) => Promise<GovernanceActionState>;

const EMPTY_STATE: GovernanceActionState = { errors: {} };

// What an existing board already says, for the Edit Board screen. Money
// comes in as the text the field shows ("25000.00"), not as cents.
export interface BoardInitial {
  kind: BoardKind;
  name: string;
  sport: string | null;
  giveGet: string;
  minSeats: number;
  maxSeats: number;
  description: string | null;
}

const SPORT_SUGGESTIONS = SPORTS.map((sp) => sp.label);

export function BoardForm({ action, initial, submitLabel = "Create Board" }: { action: ServerAction; initial?: BoardInitial; submitLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [kind, setKind] = useState<BoardKind>(initial?.kind ?? "executive");
  const err = (key: string) => state.errors[key];

  const defaults = DEFAULT_SEATS[kind];
  // On an edit, the board's own values stay put until the tier changes;
  // a new tier brings that tier's defaults, the same as on create.
  const own = initial && kind === initial.kind ? initial : null;

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField name="kind" label="Tier" error={err("kind")} hint={BOARD_KIND_PURPOSE[kind]} value={kind} onChange={(e) => setKind(e.target.value as BoardKind)}>
        {BOARD_KINDS.map((k) => (
          <option key={k} value={k}>
            {BOARD_KIND_LABEL[k]}
          </option>
        ))}
      </SelectField>

      <Field name="name" label="Name" error={err("name")} defaultValue={initial?.name ?? BOARD_KIND_LABEL[kind]} key={initial ? "name" : kind} required />

      {/* Required only for a sport board, because the whole point of
          that tier is that there is one per sport. A tap picks one of
          the sports the app already knows; anything else can be typed. */}
      {kind === "sport" && <SuggestField name="sport" label="Sport" suggestions={SPORT_SUGGESTIONS} defaultValue={initial?.sport ?? ""} error={err("sport")} />}

      <Field
        name="giveGet"
        label="Give/Get per Seat"
        error={err("giveGet")}
        inputMode="decimal"
        className="tabular-nums"
        defaultValue={own ? own.giveGet : formatMoney(DEFAULT_GIVE_GET_CENTS[kind]).replace("$", "")}
        hint={initial ? "For seats added from now on. A sitting member keeps what they agreed to." : undefined}
        key={`gg-${kind}`}
      />

      <Grid2>
        <Field name="minSeats" label="Minimum Seats" error={err("minSeats")} inputMode="numeric" className="tabular-nums" defaultValue={own ? own.minSeats : defaults.min} key={`min-${kind}`} />
        <Field name="maxSeats" label="Maximum Seats" error={err("maxSeats")} inputMode="numeric" className="tabular-nums" defaultValue={own ? own.maxSeats : defaults.max} key={`max-${kind}`} />
      </Grid2>
      <TextAreaField name="description" label="Description" rows={2} defaultValue={initial?.description ?? ""} />

      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : submitLabel}
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

export interface SeatDonor {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

// What an existing seat already says, for the Edit Seat screen.
export interface SeatInitial {
  name: string;
  roleTitle: string | null;
  status: string;
  commitment: string;
  donorId: string | null;
  termStart: string | null;
  termEnd: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export function BoardSeatForm({
  action,
  donors,
  defaultCommitment,
  today,
  roleSuggestions,
  initial,
  submitLabel = "Add Seat",
}: {
  action: ServerAction;
  donors: SeatDonor[];
  defaultCommitment: string;
  today: string;
  roleSuggestions: string[];
  initial?: SeatInitial;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  // Picking a donor record fills the name, email and phone when they are
  // still blank, and never overwrites what was typed (Stage 4, B8). The
  // action does the same on the server.
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const pickDonor = (id: string) => {
    const d = donors.find((x) => x.id === id);
    if (!d) return;
    if (!name.trim()) setName(d.name);
    if (!email.trim() && d.email) setEmail(d.email);
    if (!phone.trim() && d.phone) setPhone(d.phone);
  };

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField
        name="donorId"
        label="Donor Record"
        error={err("donorId")}
        defaultValue={initial?.donorId ?? ""}
        onChange={(e) => pickDonor(e.target.value)}
      >
        <option value="">Not linked</option>
        {donors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>

      <Field name="name" label="Name" error={err("name")} value={name} onChange={(e) => setName(e.target.value)} required />

      <SuggestField
        name="roleTitle"
        label="Role"
        suggestions={roleSuggestions}
        defaultValue={initial?.roleTitle ?? ""}
       
      />

      <SelectField
        name="status"
        label="Status"
        error={err("status")}
        hint={initial ? "To end a seat and keep its history, pick Emeritus or Resigned." : undefined}
        defaultValue={initial?.status ?? "prospect"}
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
        inputMode="decimal"
        className="tabular-nums"
        defaultValue={initial?.commitment ?? defaultCommitment}
      />

      <Grid2>
        <Field name="termStart" label="Term Starts" type="date" className="tabular-nums" defaultValue={initial ? (initial.termStart ?? "") : today} />
        <Field name="termEnd" label="Term Ends" type="date" className="tabular-nums" error={err("termEnd")} defaultValue={initial?.termEnd ?? ""} />
      </Grid2>

      <Grid2>
        <Field name="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field name="phone" label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Grid2>

      <TextAreaField name="notes" label="Notes" rows={2} defaultValue={initial?.notes ?? ""} />

      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : submitLabel}
      </Button>
    </Form>
  );
}
