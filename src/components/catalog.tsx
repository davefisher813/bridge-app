// The locked catalog's shared primitives (docs/STYLING_CATALOG.md).
// Screens compose these rather than re-implementing a treatment inline,
// for the same reason StatusPill exists: a treatment that lives in six
// places drifts in six directions.

import type { ReactNode } from "react";
import { DOT, RAIL, SOLID, TINT, scoreRole, type Role } from "@/components/statusHue";

// C2: solid card, 5px colored left rail. The rail carries meaning, so it
// takes the row's own role, defaulting to accent for a row with nothing to
// say.
export function RailCard({ role = "accent", children }: { role?: Role; children: ReactNode }) {
  return <div className={`rounded-[10px] border-l-[5px] bg-paper px-3.5 py-3 ${RAIL[role]}`}>{children}</div>;
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
      className="flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ios-blue to-ios-indigo font-extrabold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}
    >
      {initials}
    </div>
  );
}

// S2: the fit score, number only. Rendered as a TINT rather than a solid,
// because stage and score are two different questions about the same row:
// if both were solid pills, green would mean Committed and also "good
// score", and amber would mean Offer and also "middling". Weight carries
// the axis so color stays free to mean one thing inside each.
export function ScorePill({ score }: { score: number }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-[13px] font-extrabold tabular-nums ${TINT[scoreRole(score)]}`}
    >
      {score}
    </span>
  );
}

// H1: colored dot, label, dotted rule, trailing count. The count is ink
// rather than muted because the number is the useful part.
export function SectionHeader({ label, count, role = "accent" }: { label: string; count?: number; role?: Role }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${DOT[role]}`} />
      <span className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-muted">{label}</span>
      <span className="h-px flex-1 border-b-2 border-dotted border-line" />
      {count !== undefined && <span className="text-[12px] font-extrabold tabular-nums text-ink">{count}</span>}
    </div>
  );
}

// G3: tinted pill tab for a board group. Tinted rather than solid because
// it sits directly above rows carrying the same role at full saturation.
export function GroupTab({ label, count, role = "neutral" }: { label: string; count: number; role?: Role }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[11.5px] font-extrabold ${TINT[role]}`}>
      {label} &middot; {count}
    </span>
  );
}

// ST1: tinted stat tile, same reasoning as the group tab.
export function StatTile({ value, label, role = "neutral" }: { value: ReactNode; label: string; role?: Role }) {
  return (
    // The label inherits the tile's paired foreground rather than using
    // text-muted: muted is chosen against the page, not against a tint,
    // and lands near 3:1 on one.
    <div className={`flex-1 rounded-[12px] px-3 py-2.5 ${TINT[role]}`}>
      <div className="text-[18px] font-extrabold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-[0.03em] opacity-80">{label}</div>
    </div>
  );
}

// B1: a solid square badge per metadata field type, one hue per type.
// time is anything on a clock, people is coaches and contacts, place is
// schools and locations.
export function FieldBadge({ role, children }: { role: Extract<Role, "time" | "people" | "place">; children: ReactNode }) {
  return (
    <span className={`flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] ${SOLID[role]}`}>
      {children}
    </span>
  );
}

// E1: icon, title, one line of subtext naming the next action. Never an
// empty container and never a bare muted sentence.
export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[12px] bg-paper px-4 py-8 text-center">
      <div className="mb-2 flex justify-center text-muted">{icon}</div>
      <div className="text-[13px] font-extrabold text-ink">{title}</div>
      {children && <div className="mt-1 text-[11.5px] text-muted">{children}</div>}
    </div>
  );
}
