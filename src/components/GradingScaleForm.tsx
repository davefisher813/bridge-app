"use client";

import { useActionState } from "react";
import { SCALE_LETTERS } from "@/lib/fit/ncaa/gradingScale";
import type { GradingScaleActionState } from "@/lib/actions/gradingScales";
import { errorClass, fieldClass, inputClass, labelClass, submitClass } from "@/components/formStyles";

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
    <form action={formAction} className="flex flex-col gap-4">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      {state.errors.form && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[13px] font-semibold text-danger">
          {state.errors.form}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="schoolName">
          School
        </label>
        <input
          className={fieldClass(err("schoolName"))}
          id="schoolName"
          name="schoolName"
          defaultValue={defaults.schoolName}
          placeholder="Cardinal Hayes High School"
          required
        />
        {err("schoolName") && <p className={errorClass}>{err("schoolName")}</p>}
        <p className="mt-1 text-[11.5px] leading-tight text-muted">
          Spell it the way the transcript does. Courses are matched to this table by school name.
        </p>
      </div>

      <div>
        <div className={labelClass}>The table</div>
        <p className="mb-2 text-[11.5px] leading-tight text-muted">
          Five rows, not twelve. The NCAA does not recognise plus or minus, so A+, A and A- are all worth four points and collapse into
          one band. Leave a letter blank if the school does not award it.
        </p>
        {err("bands") && <p className="mb-2 text-[11.5px] font-semibold text-danger">{err("bands")}</p>}

        <div className="flex flex-col gap-2">
          {SCALE_LETTERS.map((letter) => {
            const row = defaults.rows.find((r) => r.letter === letter);
            const rowError = err(`band_${letter}`);
            return (
              <div key={letter}>
                <div className="flex items-center gap-2">
                  <span className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[9px] bg-tint-contact text-[16px] font-black text-tint-contact-on">
                    {letter}
                  </span>
                  <input
                    className={`${fieldClass(rowError)} text-center tabular-nums`}
                    name={`min_${letter}`}
                    inputMode="decimal"
                    defaultValue={row?.min ?? ""}
                    placeholder="low"
                    aria-label={`${letter} band lowest grade`}
                  />
                  <span className="text-[13px] font-bold text-muted">to</span>
                  <input
                    className={`${fieldClass(rowError)} text-center tabular-nums`}
                    name={`max_${letter}`}
                    inputMode="decimal"
                    defaultValue={row?.max ?? ""}
                    placeholder="high"
                    aria-label={`${letter} band highest grade`}
                  />
                </div>
                {rowError && <p className={errorClass}>{rowError}</p>}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className={labelClass}>Weighted courses</div>
        <div className="flex flex-col gap-2">
          {/* Both conditions come straight from the NCAA's own rule, and
              neither can be read off a transcript. Until this form
              existed nothing ever set them, so every AP athlete got an
              understated core GPA and a warning about their school not
              being on record that nobody had been asked about. */}
          <label className="flex items-start gap-3 rounded-[10px] bg-paper px-3 py-2.5">
            <input
              type="checkbox"
              name="reportsWeightedGrades"
              defaultChecked={defaults.reportsWeightedGrades}
              className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 accent-[color:var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-ink">
                The school is on record with the Eligibility Center as awarding weighted grades
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-tight text-muted">
                Not just that they offer AP. The school has to have told the NCAA.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-[10px] bg-paper px-3 py-2.5">
            <input
              type="checkbox"
              name="weightingIsClassRankOnly"
              defaultChecked={defaults.weightingIsClassRankOnly}
              className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 accent-[color:var(--accent)]"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-ink">The weighting only affects class rank, not the GPA</span>
              <span className="mt-0.5 block text-[11.5px] leading-tight text-muted">If this is true, the bonus does not apply at all.</span>
            </span>
          </label>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="weightBonus">
          Bonus per weighted course
        </label>
        <input
          className={`${fieldClass(err("weightBonus"))} tabular-nums`}
          id="weightBonus"
          name="weightBonus"
          inputMode="decimal"
          defaultValue={defaults.weightBonus}
        />
        {err("weightBonus") && <p className={errorClass}>{err("weightBonus")}</p>}
        <p className="mt-1 text-[11.5px] leading-tight text-muted">
          What this school actually adds. The NCAA caps it at 1.00, and the cap is not the same as the amount: a school that adds 0.50
          would have every AP athlete overstated if the cap were used instead.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="sourceNote">
          Where this came from
        </label>
        <textarea
          className={inputClass}
          id="sourceNote"
          name="sourceNote"
          rows={3}
          defaultValue={defaults.sourceNote}
          placeholder="Legend printed on page 2 of the official transcript"
          required
        />
        {err("sourceNote") && <p className={errorClass}>{err("sourceNote")}</p>}
        <p className="mt-1 text-[11.5px] leading-tight text-muted">
          Required. This table governs every eligibility verdict for every athlete at this school in your org, and in six months nobody
          will remember who typed it.
        </p>
      </div>

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving..." : submitLabel}
      </button>

      <p className="text-[11px] leading-relaxed text-muted">
        Saving recalculates every athlete at this school immediately. Verdicts can move in either direction.
      </p>
    </form>
  );
}
