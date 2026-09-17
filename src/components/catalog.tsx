// The locked catalog's shared primitives (docs/STYLING_CATALOG.md).
// Screens compose these rather than re-implementing a treatment inline,
// for the same reason StatusPill exists: a treatment that lives in six
// places drifts in six directions.

import type { ReactNode } from "react";
import { DOT, TEXT_ON, scoreRole, type Role } from "@/components/statusHue";
import { RowGlyph, type RowKind } from "@/components/RowGlyph";

// C2, revised twice.
//
// 2026-09-16, Dave: "let's use icons like Jarvis does to identify
// categories instead of the color highlight." The glyph landed and the
// 5px coloured rail stayed as the default for rows that were a sentence
// rather than a record.
//
// 2026-09-17, Dave, pointing at the roster: "there's color right here."
// He was right and the earlier reasoning was wrong. A rail on a prose row
// is still a coloured block saying status, sitting next to rows whose
// status is a glyph, which is the same inconsistency the pills had. And
// on the roster it was worse than inconsistent: the row already carried
// an avatar AND a status pill, so the rail was the third thing on one
// line saying the same word.
//
// So the rail is gone. A card is paper. `kind` adds the type glyph when
// a mark helps a reader scan; without one the card is plain, which is
// right for a row that already has its own mark (an avatar) and for a
// paragraph, where a glyph would be labelling prose.
//
// `role` still colours the glyph, so a row that was orange is still
// orange. Nothing had to be relearned, there is just less of it.
export function RailCard({
  role = "accent",
  kind,
  children,
}: {
  role?: Role;
  kind?: RowKind;
  children: ReactNode;
}) {
  if (!kind) return <div className="min-h-[44px] rounded-[10px] bg-paper px-3.5 py-3">{children}</div>;
  return (
    <div className="flex min-h-[44px] items-start gap-3 rounded-[10px] bg-paper px-3.5 py-3">
      <span className="mt-[1px]">
        <RowGlyph kind={kind} role={role} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
      className="flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ios-blue to-ios-indigo font-extrabold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}
    >
      {initials}
    </div>
  );
}

// S2, rewritten 2026-09-17 with the rest of the pills. The fit score was
// a tinted pill; it is now the number alone in the band's hue, one weight
// heavier than the row it sits on.
//
// Losing the tint cost nothing here, because a score was never read off
// its background: it is a two-digit number and the number is the point.
// What it gained is that a row no longer carries two coloured blocks, one
// for stage and one for score, which is what made a board of eight rows
// read as a colour chart.
export function ScorePill({ score }: { score: number }) {
  return <span className={`text-[17px] font-black tabular-nums ${TEXT_ON[scoreRole(score)]}`}>{score}</span>;
}

// The one pill form, added 2026-09-17. Everything that used to be a
// tinted or filled chip is this: a glyph in the role's hue, a label in
// ink, no block behind either.
//
// It lives here rather than in each screen because a pill treatment that
// lives in six places drifts in six directions, which is the same reason
// StatusPill has always existed. `kind` is optional for the handful of
// chips that are pure labels, such as a donor type, where inventing a
// mark would say more than is known.
export function Chip({
  label,
  kind,
  role = "neutral",
  className = "",
}: {
  label: string;
  kind?: RowKind;
  role?: Role;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13.5px] font-bold text-ink ${className}`}>
      {kind && <RowGlyph kind={kind} role={role} className="h-[15px] w-[15px]" />}
      {label}
    </span>
  );
}

// H1: colored dot, label, dotted rule, trailing count. The count is ink
// rather than muted because the number is the useful part.
export function SectionHeader({
  label,
  count,
  role = "accent",
  kind,
}: {
  label: string;
  count?: number;
  role?: Role;
  kind?: RowKind;
}) {
  return (
    <div className="flex items-center gap-2">
      {kind ? (
        <RowGlyph kind={kind} role={role} className="h-[15px] w-[15px]" />
      ) : (
        <span className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${DOT[role]}`} />
      )}
      <span className="text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted">{label}</span>
      <span className="h-px flex-1 border-b-2 border-dotted border-line" />
      {count !== undefined && <span className="text-[13px] font-extrabold tabular-nums text-ink">{count}</span>}
    </div>
  );
}

// G3, rewritten 2026-09-17. Was a tinted pill above a group of rows in
// the same role. The tint was there to stop it competing with the rows
// below it at full saturation; with the fills gone from those rows there
// is nothing left to compete with, so the tab is the same Chip anatomy
// as everything else, with the count after it.
export function GroupTab({ label, count, role = "neutral", kind }: { label: string; count: number; role?: Role; kind?: RowKind }) {
  return <Chip label={`${label} \u00b7 ${count}`} kind={kind} role={role} />;
}

// ST1, rewritten 2026-09-17. Was a tinted block with the label riding
// the tint's paired foreground. It is now a paper tile with the value in
// the role's hue, which is the same trade every other surface made in
// this pass: the colour moved off the background and onto the mark.
//
// The label goes back to text-muted, which is safe again now that it is
// being read against paper rather than against a tint.
export function StatTile({ value, label, role = "neutral", kind }: { value: ReactNode; label: string; role?: Role; kind?: RowKind }) {
  return (
    <div className="flex-1 rounded-[12px] bg-paper px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {kind && <RowGlyph kind={kind} role={role} className="h-[15px] w-[15px]" />}
        <div className={`text-[22px] font-extrabold tabular-nums leading-tight ${TEXT_ON[role]}`}>{value}</div>
      </div>
      <div className="mt-0.5 text-[12.5px] font-bold uppercase tracking-[0.03em] text-muted">{label}</div>
    </div>
  );
}

// B1, rewritten 2026-09-17. Was a solid 30px square per metadata field
// type. It is the bare glyph now, at the row size, for the same reason
// as everything else in this pass: the app had three ways of drawing
// "this is a piece of metadata about a time/person/place" and now has
// one.
export function FieldBadge({ role, kind }: { role: Extract<Role, "time" | "people" | "place">; kind: RowKind }) {
  return (
    <span className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center">
      <RowGlyph kind={kind} role={role} />
    </span>
  );
}

// E1: icon, title, one line of subtext naming the next action. Never an
// empty container and never a bare muted sentence.
export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[12px] bg-paper px-4 py-8 text-center">
      <div className="mb-2 flex justify-center text-muted">{icon}</div>
      <div className="text-[14.5px] font-extrabold text-ink">{title}</div>
      {children && <div className="mt-1 text-[12.5px] text-muted">{children}</div>}
    </div>
  );
}
