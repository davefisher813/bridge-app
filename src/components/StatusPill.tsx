// Shared status/color language across Athletes, Board, and Today:
// green = active/on-track, blue-indigo = in contact, accent red =
// committed/primary, neutral = everything else (Target, Not Interested,
// unrecognized values).
//
// Catalog item P1: solid saturated fills, not tints. Every fill is used
// with its own paired foreground token, which is what keeps an 11px bold
// pill above 4.5:1. Never pair a fill with any other text color.
// See docs/STYLING_CATALOG.md.
const PILL_STYLE: Record<string, string> = {
  Active: "bg-solid-success text-solid-success-on",
  "In Contact": "bg-solid-info text-solid-info-on",
  Visit: "bg-solid-info text-solid-info-on",
  Offer: "bg-solid-success text-solid-success-on",
  Committed: "bg-solid-accent text-solid-accent-on",
};

// The neutral fill is close in value to the dark app background, so unlike
// the colored fills it carries a hairline border to stay readable as a
// shape. See the fill-vs-background note in docs/STYLING_CATALOG.md.
const DEFAULT_STYLE = "bg-solid-neutral text-solid-neutral-on border border-line";

export function StatusPill({ status }: { status: string }) {
  const style = PILL_STYLE[status] ?? DEFAULT_STYLE;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-bold ${style}`}>
      {status}
    </span>
  );
}
