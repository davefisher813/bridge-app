"use client";

import { useActionState, useState } from "react";
import { BOARD_KINDS, BOARD_KIND_LABEL, BOARD_KIND_PURPOSE, DEFAULT_GIVE_GET_CENTS, DEFAULT_SEATS, type BoardKind } from "@/lib/governance/giveGet";
import { formatMoney } from "@/lib/fundraising/rollup";
import type { GovernanceActionState } from "@/lib/actions/governance";
import { errorClass, fieldClass, inputClass, labelClass, submitClass } from "@/components/formStyles";

type ServerAction = (prevState: GovernanceActionState, formData: FormData) => Promise<GovernanceActionState>;

const EMPTY_STATE: GovernanceActionState = { errors: {} };

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[14.5px] font-semibold text-danger">{message}</div>
  );
}

export function BoardForm({ action }: { action: ServerAction }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [kind, setKind] = useState<BoardKind>("executive");
  const err = (key: string) => state.errors[key];

  const defaults = DEFAULT_SEATS[kind];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={state.errors.form} />

      <div>
        <label className={labelClass} htmlFor="kind">
          Tier
        </label>
        <select
          className={fieldClass(err("kind"))}
          id="kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as BoardKind)}
        >
          {BOARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {BOARD_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {err("kind") && <p className={errorClass}>{err("kind")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">{BOARD_KIND_PURPOSE[kind]}</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="name">
          Name
        </label>
        <input
          className={fieldClass(err("name"))}
          id="name"
          name="name"
          defaultValue={BOARD_KIND_LABEL[kind]}
          key={kind}
          required
        />
        {err("name") && <p className={errorClass}>{err("name")}</p>}
      </div>

      {/* Required only for a sport board, because the whole point of
          that tier is that there is one per sport. */}
      {kind === "sport" && (
        <div>
          <label className={labelClass} htmlFor="sport">
            Sport
          </label>
          <input className={fieldClass(err("sport"))} id="sport" name="sport" placeholder="baseball" />
          {err("sport") && <p className={errorClass}>{err("sport")}</p>}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="giveGet">
          Give/get per seat
        </label>
        <input
          className={`${fieldClass(err("giveGet"))} tabular-nums`}
          id="giveGet"
          name="giveGet"
          inputMode="decimal"
          defaultValue={formatMoney(DEFAULT_GIVE_GET_CENTS[kind]).replace("$", "")}
          key={`gg-${kind}`}
        />
        {err("giveGet") && <p className={errorClass}>{err("giveGet")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Prefilled from your governance document. Stored per board, so changing it here changes nothing anybody already agreed to.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="minSeats">
            Minimum seats
          </label>
          <input
            className={`${inputClass} tabular-nums`}
            id="minSeats"
            name="minSeats"
            inputMode="numeric"
            defaultValue={defaults.min}
            key={`min-${kind}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="maxSeats">
            Maximum seats
          </label>
          <input
            className={`${fieldClass(err("maxSeats"))} tabular-nums`}
            id="maxSeats"
            name="maxSeats"
            inputMode="numeric"
            defaultValue={defaults.max}
            key={`max-${kind}`}
          />
          {err("maxSeats") && <p className={errorClass}>{err("maxSeats")}</p>}
        </div>
      </div>
      {kind === "sport" && (
        <p className="text-[12.5px] leading-tight text-muted">
          Your governance document says a sport board starts at three and can grow to five. Below the minimum is flagged, not blocked.
        </p>
      )}

      <div>
        <label className={labelClass} htmlFor="description">
          Description
        </label>
        <textarea className={inputClass} id="description" name="description" rows={2} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Creating..." : "Create the board"}
      </button>
    </form>
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
        <label className={labelClass} htmlFor="roleTitle">
          Role
        </label>
        <input className={inputClass} id="roleTitle" name="roleTitle" list="role-suggestions" />
        <datalist id="role-suggestions">
          {roleSuggestions.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        {roleSuggestions.length > 0 && (
          <p className="mt-1 text-[12.5px] leading-tight text-muted">
            The core roles for this tier are {roleSuggestions.join(", ")}. Anything else is fine too.
          </p>
        )}
      </div>

      <div>
        <label className={labelClass} htmlFor="status">
          Status
        </label>
        <select className={fieldClass(err("status"))} id="status" name="status" defaultValue="prospect">
          {SEAT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {err("status") && <p className={errorClass}>{err("status")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Only an active seat counts toward the board&apos;s committed total. A prospect has not joined yet.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="commitment">
          Commitment
        </label>
        <input
          className={`${fieldClass(err("commitment"))} tabular-nums`}
          id="commitment"
          name="commitment"
          inputMode="decimal"
          defaultValue={defaultCommitment}
        />
        {err("commitment") && <p className={errorClass}>{err("commitment")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Copied from the board, so changing the tier later does not rewrite what a sitting member agreed to.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="donorId">
          Donor record
        </label>
        <select className={fieldClass(err("donorId"))} id="donorId" name="donorId" defaultValue="">
          <option value="">Not linked</option>
          {donors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {err("donorId") && <p className={errorClass}>{err("donorId")}</p>}
        <p className="mt-1 text-[12.5px] leading-tight text-muted">
          Linking finds their own giving automatically. Without it, only what they bring in can be credited.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="termStart">
            Term starts
          </label>
          <input className={`${inputClass} tabular-nums`} id="termStart" name="termStart" type="date" defaultValue={today} />
        </div>
        <div>
          <label className={labelClass} htmlFor="termEnd">
            Term ends
          </label>
          <input className={`${fieldClass(err("termEnd"))} tabular-nums`} id="termEnd" name="termEnd" type="date" />
          {err("termEnd") && <p className={errorClass}>{err("termEnd")}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass} htmlFor="email">
            Email
          </label>
          <input className={inputClass} id="email" name="email" type="email" />
        </div>
        <div>
          <label className={labelClass} htmlFor="phone">
            Phone
          </label>
          <input className={inputClass} id="phone" name="phone" type="tel" />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notes
        </label>
        <textarea className={inputClass} id="notes" name="notes" rows={2} />
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Adding..." : "Add the seat"}
      </button>
    </form>
  );
}
