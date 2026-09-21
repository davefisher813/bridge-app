// Which logged number feeds the score. Dave's pick: best verified, else
// most recent. "Best" is lowest for a time and highest for everything
// else; "verified" is the best trust tier that has an entry (Premier,
// then PBR, Perfect Game or another event, then coach-timed, then
// self-reported). The chosen entry's source is the metric's confidence.
//
// Pure: a list of entries in, a measurables map out. The data layer reads
// athlete_metrics rows into MetricEntry; nothing here knows a column.

import { METRICS, metricSpec, normalizeSport, sourceSpec, type Confidence, type MetricSource, type MetricSpec } from "./contract";

export interface MetricEntry {
  id: string;
  metric: string;
  value: number;
  measuredOn: string; // ISO date
  source: MetricSource;
}

export interface ScoringMetrics {
  measurables: Record<string, number>;
  confidence: Record<string, Confidence>;
  // Which entry was chosen for each metric, so a screen can mark it.
  scoredEntryId: Record<string, string>;
}

export function selectScoringMetrics(entries: MetricEntry[]): ScoringMetrics {
  const byMetric = new Map<string, MetricEntry[]>();
  for (const e of entries) {
    if (!Number.isFinite(e.value)) continue;
    const list = byMetric.get(e.metric) ?? [];
    list.push(e);
    byMetric.set(e.metric, list);
  }
  const out: ScoringMetrics = { measurables: {}, confidence: {}, scoredEntryId: {} };
  for (const [metric, list] of byMetric) {
    const spec = metricSpec(metric);
    const bestTier = Math.min(...list.map((e) => sourceSpec(e.source).tier));
    const candidates = list.filter((e) => sourceSpec(e.source).tier === bestTier);
    let chosen: MetricEntry;
    if (bestTier <= 3) {
      // Verified or coach-timed: the best number in the tier.
      chosen = candidates.reduce((best, e) => (spec?.lowerIsBetter ? (e.value < best.value ? e : best) : e.value > best.value ? e : best));
    } else {
      // Self-reported only: the most recent, not the best.
      chosen = candidates.reduce((latest, e) => (e.measuredOn > latest.measuredOn ? e : latest));
    }
    out.measurables[metric] = chosen.value;
    out.confidence[metric] = sourceSpec(chosen.source).confidence;
    out.scoredEntryId[metric] = chosen.id;
  }
  return out;
}

// The lowest confidence among the metrics a dimension actually used.
export function combinedConfidence(keys: string[], confidence: Record<string, Confidence>): Confidence {
  const order: Confidence[] = ["unknown", "low", "medium", "high"];
  let worst: Confidence = "high";
  let any = false;
  for (const k of keys) {
    const c = confidence[k];
    if (!c) continue;
    any = true;
    if (order.indexOf(c) < order.indexOf(worst)) worst = c;
  }
  return any ? worst : "unknown";
}

// The metrics a log form offers for one athlete: the ones the engine
// scores for the position first, everything else for the sport under
// More (docs/MATCHING_CONTRACT.md section 1). An unknown sport shows
// every metric under More rather than nothing.
export function metricsFor(sport: string, positionGroup: string | null): { first: MetricSpec[]; more: MetricSpec[] } {
  const s = normalizeSport(sport);
  const forSport = METRICS.filter((m) => !s || m.sports.includes(s));
  const list = forSport.length > 0 ? forSport : METRICS;
  const first = positionGroup ? list.filter((m) => m.first.includes(positionGroup)) : [];
  const more = list.filter((m) => !first.includes(m));
  return { first, more };
}

// "86 mph", "1.95 s", "74 in", "18.5". The unit as the contract prints it.
export function formatMetricValue(key: string, value: number): string {
  const spec = metricSpec(key);
  const n = Number(value);
  const text = spec ? n.toFixed(spec.decimals) : String(n);
  if (!spec || !spec.unit) return text;
  return spec.unit === "%" ? `${text}%` : `${text} ${spec.unit}`;
}
