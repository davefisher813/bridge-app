import { z } from "zod";
import { METRICS, SOURCES } from "@/lib/fit/contract";

// One logged number. docs/MATCHING_CONTRACT.md section 1: value, date,
// where it was measured, and the source that sets its trust.

const metricKeys = METRICS.map((m) => m.key) as [string, ...string[]];
const sourceKeys = SOURCES.map((s) => s.key) as [string, ...string[]];

export const metricSchema = z.object({
  metric: z.enum(metricKeys, { message: "Pick a metric" }),
  value: z.number({ message: "Enter the number" }).finite().min(0, "A number cannot be negative").max(10000, "That number is too large"),
  measuredOn: z.string().date("Pick the date it was measured"),
  source: z.enum(sourceKeys, { message: "Say where it was measured" }),
  sourceDetail: z.string().trim().max(120).optional(),
});

export type MetricFormValues = z.infer<typeof metricSchema>;

export function parseMetricForm(formData: FormData): { ok: boolean; values: MetricFormValues | null; errors: Record<string, string> } {
  const raw = String(formData.get("value") ?? "").trim();
  const n = raw === "" ? undefined : Number(raw);
  const detail = String(formData.get("sourceDetail") ?? "").trim();
  const input = {
    metric: String(formData.get("metric") ?? ""),
    value: n === undefined || Number.isNaN(n) ? undefined : n,
    measuredOn: String(formData.get("measuredOn") ?? ""),
    source: String(formData.get("source") ?? ""),
    sourceDetail: detail === "" ? undefined : detail,
  };
  const result = metricSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) errors[String(issue.path[0])] = issue.message;
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}
