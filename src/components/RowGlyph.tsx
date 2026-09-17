// The leading type glyph on a list row.
//
// Dave, 2026-09-16, after clicking through the prototype: "let's use
// icons like Jarvis does to identify categories instead of the color
// highlight."
//
// What changes and what does not. The left colour rail said one thing:
// status. Every row in a list wore one, so a screen of eight rows was
// eight coloured stripes and no indication of what any of them was. The
// glyph carries the KIND, and keeps the status in its colour, so a row
// now answers both questions before it is read.
//
// The form is JARVIS's second one (approved there 2026-08-18): a bare
// coloured glyph with no tile behind it. The tile version reads heavier
// and was kept there for stat and banner surfaces, which is the same
// place it belongs here.
//
// Drawings live in rowIcons.json, not in this file, because the preview
// and prototype generators read the same set. Copies of a shared map
// drifted three times in one sitting earlier in this project, which is
// why nothing keeps one.
//
// Weight, 2026-09-17. 1.75 on a 24 box drawn at 18px is a 1.31px line,
// which on a phone falls between device pixels and reads soft. 2.0 at
// 20px is 1.67px and lands much closer to a whole pixel. That one change
// sharpened the whole set without touching a single path, and it is why
// the size and the stroke are set here rather than per call site: they
// only work as a pair.

import ICONS from "./rowIcons.json";
import { FG, type Role } from "./statusHue";

export type RowKind = Exclude<keyof typeof ICONS, "_comment">;

export function RowGlyph({ kind, role = "neutral", className = "" }: { kind: RowKind; role?: Role; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-[20px] w-[20px] flex-shrink-0 ${FG[role]} ${className}`}
      dangerouslySetInnerHTML={{ __html: ICONS[kind] }}
    />
  );
}
