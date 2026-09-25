"use client";

import { useActionState } from "react";
import { SCALE_LETTERS } from "@/lib/fit/ncaa/gradingScale";
import type { GradingScaleActionState } from "@/lib/actions/gradingScales";
import { Body, Button, CheckField, Field, Form, Hidden, Label, Prose, Stack, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: GradingScaleActionState, formData: FormData) => Promise<GradingScaleActionState>;

const EMPTY_STATE: GradingScaleActionState = { errors: {} };

export interface GradingScaleDefaults {
  schoolName: string;
  rows: Array<{ letter: string; min: string; max: string }>;
  reportsWeightedGrades: boolean;
  weightingIsClassRankOnly: boolean;
  weightBonus: string;
  sourceNote: string;
}

export function GradingScaleForm({
  action,
  defaults,
  returnTo,
  submitLabel,
}: {
  action: ServerAction;
  defaults: GradingScaleDefaults;
  returnTo?: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      {returnTo && <Hidden name="returnTo" value={returnTo} />}

      <Field
        name="schoolName"
        label="School"
        error={err("schoolName")}
        defaultValue={defaults.schoolName}
        required
        hint="Spell it the way the transcript does."
      />

      <Stack gap={2}>
        <Label caps>The table</Label>
        <Label>
          Five rows, not twelve. The NCAA does not recognise plus or minus, so A+, A and A- are all worth four points and collapse into one
          band. Leave a letter blank if the school does not award it.
        </Label>
        {err("bands") && <Label tone="danger">{err("bands")}</Label>}
        <div className="flex items-center gap-2">
          <div className="w-11 flex-shrink-0" />
          <div className="flex-1">
            <Label>Lowest grade</Label>
          </div>
          <div className="flex-1">
            <Label>Highest grade</Label>
          </div>
        </div>
        {SCALE_LETTERS.map((letter) => {
          const row = defaults.rows.find((r) => r.letter === letter);
          const rowError = err(`band_${letter}`);
          return (
            <div key={letter} className="flex items-start gap-2">
              <div className="flex min-h-12 w-11 flex-shrink-0 items-center justify-center">
                <Body weight="bold">{letter}</Body>
              </div>
              <Field name={`min_${letter}`} label={`${letter} Lowest Grade`} labelHidden inputMode="decimal" defaultValue={row?.min ?? ""} error={rowError} />
              <Field name={`max_${letter}`} label={`${letter} Highest Grade`} labelHidden inputMode="decimal" defaultValue={row?.max ?? ""} />
            </div>
          );
        })}
      </Stack>

      <Stack gap={2}>
        <Label caps>Weighted courses</Label>
        {/* Both conditions come straight from the NCAA's own rule, and
            neither can be read off a transcript. Until this form
            existed nothing ever set them, so every AP athlete got an
            understated core GPA and a warning about their school not
            being on record that nobody had been asked about. */}
        <CheckField
          name="reportsWeightedGrades"
          defaultChecked={defaults.reportsWeightedGrades}
          label="The school is on record with the Eligibility Center as awarding weighted grades"
          hint="Not just that they offer AP. The school has to have told the NCAA."
        />
        <CheckField
          name="weightingIsClassRankOnly"
          defaultChecked={defaults.weightingIsClassRankOnly}
          label="The weighting only affects class rank, not the GPA"
          hint="If this is true, the bonus does not apply at all."
        />
      </Stack>

      <Field
        name="weightBonus"
        label="Bonus per Weighted Course"
        inputMode="decimal"
        defaultValue={defaults.weightBonus}
        error={err("weightBonus")}
        hint="What this school adds. The NCAA caps it at 1.00."
      />

      <TextAreaField
        name="sourceNote"
        label="Where This Came From"
        defaultValue={defaults.sourceNote}
        required
        error={err("sourceNote")}
        hint="Required."
      />

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>

      <Prose>Saving recalculates every athlete at this school immediately. Verdicts can move in either direction.</Prose>
    </Form>
  );
}
