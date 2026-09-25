"use client";

import { useActionState, useState } from "react";
import type { MetricActionState } from "@/lib/actions/metrics";
import { SOURCES, metricSpec, type MetricSpec } from "@/lib/fit/contract";
import { Button, Field, Form, Grid2, SelectField } from "@/components/kit";

type ServerAction = (prevState: MetricActionState, formData: FormData) => Promise<MetricActionState>;

const EMPTY_STATE: MetricActionState = { errors: {} };

// One logged number. docs/MATCHING_CONTRACT.md section 1: the metrics
// the engine scores for the position come first, everything else sits
// under More; the value is a decimal field with the number pad and the
// unit printed beside it; the source sets how sure the score is.
export function MetricForm({ action, first, more, today }: { action: ServerAction; first: MetricSpec[]; more: MetricSpec[]; today: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [metric, setMetric] = useState<string>(first[0]?.key ?? more[0]?.key ?? "");
  const spec = metricSpec(metric);
  const err = (key: string) => state.errors[key];
  const unitHint = spec ? (spec.unit ? `Measured in ${spec.unit === "%" ? "percent" : spec.unit === "s" ? "seconds" : spec.unit === "in" ? "inches" : spec.unit === "lb" ? "pounds" : spec.unit}.` : "A plain number.") : undefined;

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField name="metric" label="Metric" value={metric} onChange={(e) => setMetric(e.target.value)} error={err("metric")}>
        {first.length > 0 && (
          <optgroup label="For This Position">
            {first.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </optgroup>
        )}
        {more.length > 0 && (
          <optgroup label={first.length > 0 ? "More" : "Metrics"}>
            {more.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </optgroup>
        )}
      </SelectField>
      <Grid2>
        <Field
          name="value"
          label={spec?.unit ? `Value (${spec.unit})` : "Value"}
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          hint={unitHint}
          required
          error={err("value")}
        />
        <Field name="measuredOn" label="Measured On" type="date" defaultValue={today} required error={err("measuredOn")} />
      </Grid2>
      <SelectField name="source" label="Source" hint="Premier tech is trusted most, self-reported least." defaultValue="event" error={err("source")}>
        {SOURCES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </SelectField>
      <Field name="sourceDetail" label="Event or Detail" hint="For example, PBR Connecticut or fall practice." maxLength={120} error={err("sourceDetail")} />
      <Button disabled={pending}>{pending ? "Saving..." : "Log Metric"}</Button>
    </Form>
  );
}
