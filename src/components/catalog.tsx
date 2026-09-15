// The locked catalog's shared primitives (docs/STYLING_CATALOG.md).
// Screens compose these rather than re-implementing a treatment inline,
// for the same reason StatusPill exists: a treatment that lives in six
// places drifts in six directions.

import type { ReactNode } from "react";
import { RAIL_BY_HUE, SOLID_BY_HUE, TINT_BY_HUE, type Hue } from "@/components/statusHue";

// C2: solid card, 5px colored left rail. The rail carries meaning, so it
// takes the row's status hue, defaulting to accent for a row with no
// status of its own.
export function RailCard({
  hue = "accent",
  children,
}: {
  hue?: Hue;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-[10px] border-l-[5px] bg-paper px-3.5 py-3 ${RAIL_BY_HUE[hue]}`}>{children}</div>
  );
}

// AV1: gradient circle with initials. The gradient is fixed rather than
// rotated per person, so a roster does not read as a color wheel.
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  // First and last initial, not the first two words: "Mary Jane Smith" is
  // MS, the way a person would write it, not MJ.
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-info to-accent font-extrabold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}
    >
      {initials}
    </div>
  );
}

// S2: the fit score as a solid pill, number only. The bands live here and
// nowhere else, per the catalog, so every screen reads the same score the
// same way.
export function ScorePill({ score }: { score: number }) {
  // 40 to 69 uses the time hue (amber): a middling fit is a "look closer",
  // which neutral would hide and danger would overstate.
  const cls =
    score >= 70
      ? SOLID_BY_HUE.success
      : score >= 40
        ? "bg-solid-time text-solid-time-on"
        : SOLID_BY_HUE.neutral;
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-[13px] font-extrabold tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

// H1: colored dot, label, dotted rule, trailing count. The count is ink
// rather than muted because the number is the useful part.
export function SectionHeader({
  label,
  count,
  hue = "accent",
}: {
  label: string;
  count?: number;
  hue?: Hue;
}) {
  const dot =
    hue === "success" ? "bg-success" : hue === "info" ? "bg-info" : hue === "neutral" ? "bg-muted" : "bg-accent";
  return (
    <div className="flex items-center gap-2">
      <span className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${dot}`} />
      <span className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-muted">{label}</span>
      <span className="h-px flex-1 border-b-2 border-dotted border-line" />
      {count !== undefined && <span className="text-[12px] font-extrabold tabular-nums text-ink">{count}</span>}
    </div>
  );
}

// G3: tinted pill tab for a board group. Tinted rather than solid because
// it sits directly above rows carrying the same hue at full saturation.
export function GroupTab({ label, count, hue = "neutral" }: { label: string; count: number; hue?: Hue }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[11.5px] font-extrabold ${TINT_BY_HUE[hue]}`}>
      {label} &middot; {count}
    </span>
  );
}

// ST1: tinted stat tile. Tinted for the same reason as the group tab.
export function StatTile({ value, label, hue = "neutral" }: { value: ReactNode; label: string; hue?: Hue }) {
  return (
    <div className={`flex-1 rounded-[12px] px-3 py-2.5 ${TINT_BY_HUE[hue]}`}>
      <div className="text-[18px] font-extrabold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-[0.03em] text-muted">{label}</div>
    </div>
  );
}

// E1: icon, title, one line of subtext naming the next action. Never an
// empty container and never a bare muted sentence.
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[12px] bg-paper px-4 py-8 text-center">
      <div className="mb-2 flex justify-center text-muted">{icon}</div>
      <div className="text-[13px] font-extrabold text-ink">{title}</div>
      {children && <div className="mt-1 text-[11.5px] text-muted">{children}</div>}
    </div>
  );
}
