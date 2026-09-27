"use client";

// The award on a target, editable (crud F14). An award letter applied
// through Doc AI lands here already filled; a misread number is fixed in
// place rather than by discarding the document. The award list is rows
// that can be added, changed and removed; a blank row is dropped on save.

import { useActionState, useState } from "react";
import { AWARD_TYPES, AWARD_TYPE_LABEL, type TargetAid } from "@/lib/validation/targetAid";
import type { TargetAidActionState } from "@/lib/actions/targets";
import { Body, Button, Card, Field, Form, Grid2, Inline, SelectField, Stack } from "@/components/kit";

type ServerAction = (prevState: TargetAidActionState, formData: FormData) => Promise<TargetAidActionState>;

const EMPTY_STATE: TargetAidActionState = { errors: {} };

type AwardRow = { key: number; type: string; name: string; amount: string; renewable: string };

const blank = (key: number): AwardRow => ({ key, type: "scholarship", name: "", amount: "", renewable: "" });

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function TargetAidForm({ action, aid }: { action: ServerAction; aid: TargetAid | null }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const [rows, setRows] = useState<AwardRow[]>(() =>
    (aid?.awards ?? []).map((a, i) => ({ key: i, type: a.type, name: a.name, amount: str(a.amount), renewable: a.renewable === true ? "yes" : a.renewable === false ? "no" : "" })),
  );
  const [nextKey, setNextKey] = useState(1000);

  const update = (key: number, patch: Partial<AwardRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => {
    setRows((rs) => [...rs, blank(nextKey)]);
    setNextKey((k) => k + 1);
  };

  return (
    <Form action={formAction} error={state.errors.form}>
      <Grid2>
        <Field name="academicYear" label="Academic Year" hint="Like 2026-27." defaultValue={aid?.academicYear ?? ""} error={err("academicYear")} />
        <Field
          name="totalCostOfAttendance"
          label="Cost of Attendance"
          hint="Dollars a year."
          inputMode="decimal"
          defaultValue={str(aid?.totalCostOfAttendance)}
          error={err("totalCostOfAttendance")}
        />
      </Grid2>
      <Field
        name="netCost"
        label="Net Cost"
        inputMode="decimal"
        hint="What the family pays. Blank works it out from the cost less grants and scholarships."
        defaultValue={str(aid?.netCost)}
        error={err("netCost")}
      />
      <Grid2>
        <Field name="efc" label="EFC" inputMode="decimal" hint="Expected family contribution, if the letter gives one." defaultValue={str(aid?.efc)} error={err("efc")} />
        <Field name="sai" label="SAI" inputMode="decimal" hint="Student aid index, if the letter gives one." defaultValue={str(aid?.sai)} error={err("sai")} />
      </Grid2>

      <Stack gap={3}>
        {rows.map((r, i) => (
          <Card key={r.key}>
            <Stack gap={3}>
              <Inline>
                <div className="min-w-0 flex-1">
                  <Body weight="bold">{r.name || `Award ${i + 1}`}</Body>
                </div>
                <Button type="button" variant="quiet" inline onClick={() => remove(r.key)}>
                  Remove
                </Button>
              </Inline>
              <Grid2>
                <SelectField id={`award-type-${r.key}`} name={`award_type_${i}`} label="Type" value={r.type} onChange={(e) => update(r.key, { type: e.target.value })}>
                  {AWARD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {AWARD_TYPE_LABEL[t]}
                    </option>
                  ))}
                </SelectField>
                <Field
                  id={`award-amount-${r.key}`}
                  name={`award_amount_${i}`}
                  label="Amount"
                  inputMode="decimal"
                  value={r.amount}
                  onChange={(e) => update(r.key, { amount: e.target.value })}
                  error={err(`award_amount_${i}`)}
                />
              </Grid2>
              <Field id={`award-name-${r.key}`} name={`award_name_${i}`} label="Name" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} error={err(`award_name_${i}`)} />
              <SelectField id={`award-renewable-${r.key}`} name={`award_renewable_${i}`} label="Renewable" value={r.renewable} onChange={(e) => update(r.key, { renewable: e.target.value })}>
                <option value="">Not Stated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </SelectField>
            </Stack>
          </Card>
        ))}
        <Button type="button" variant="secondary" onClick={add}>
          Add an Award
        </Button>
      </Stack>

      <Button disabled={pending}>{pending ? "Saving..." : "Save Award"}</Button>
    </Form>
  );
}
