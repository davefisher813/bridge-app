// The one status-to-color mapping in the app. StatusPill, the row rails
// and the board's group tabs all read from here, so a status can never be
// green as a pill and indigo as a rail on the same screen.
//
// The language itself is unchanged from docs/DESIGN_SYSTEM.md: success for
// active/on-track, info for in contact, accent for committed, neutral for
// everything else (Target, Not Interested, and any value the app does not
// recognize).

export type Hue = "accent" | "success" | "info" | "neutral";

const STATUS_HUE: Record<string, Hue> = {
  Active: "success",
  "In Contact": "info",
  Visit: "info",
  Offer: "success",
  Committed: "accent",
};

export function statusHue(status: string): Hue {
  return STATUS_HUE[status] ?? "neutral";
}

// Solid fill plus its paired foreground, per the catalog's fill rule. Each
// value carries both halves in one string, which is what the styling law
// checks for. Neutral adds a hairline because its fill sits close to the
// dark background by design.
export const SOLID_BY_HUE: Record<Hue, string> = {
  accent: "bg-solid-accent text-solid-accent-on",
  success: "bg-solid-success text-solid-success-on",
  info: "bg-solid-info text-solid-info-on",
  neutral: "bg-solid-neutral text-solid-neutral-on border border-line",
};

// A tint of the same hue, for surfaces that sit next to a solid one and
// should not compete with it (stat tiles, group tabs).
export const TINT_BY_HUE: Record<Hue, string> = {
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  info: "bg-info/15 text-info",
  neutral: "bg-ink/5 text-muted",
};

// The 5px left rail on a card. A rail is a border, not a filled surface
// carrying text, so it uses the plain hue rather than a solid pair.
export const RAIL_BY_HUE: Record<Hue, string> = {
  accent: "border-l-accent",
  success: "border-l-success",
  info: "border-l-info",
  neutral: "border-l-line",
};
