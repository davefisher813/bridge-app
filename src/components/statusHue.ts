// The one place a status turns into a color. StatusPill, the row rails,
// the board's group tabs and Today's stat tiles all read from here, so a
// status can never be one color as a pill and another as a rail.
//
// The language, per docs/STYLING_CATALOG.md: the pipeline is a single
// progression, cold to warm to green, so a board reads as distance
// travelled rather than five unrelated labels. Committed is green because
// it is the win. Red is NOT a stage: it belongs to the primary action, and
// pink to destructive ones, which is what keeps the Add button meaning
// something.

export type Role =
  | "target"
  | "contact"
  | "visit"
  | "offer"
  | "committed"
  | "high"
  | "mid"
  | "low"
  | "time"
  | "people"
  | "place"
  | "accent"
  | "danger"
  | "neutral";

// recruiting_targets.status and athletes.status values, per
// migrations/0001_core_schema.sql.
const STATUS_ROLE: Record<string, Role> = {
  Target: "target",
  "In Contact": "contact",
  Visit: "visit",
  Offer: "offer",
  Committed: "committed",
  "Not Interested": "neutral",
  // Athlete-level status, which is a different column with its own values.
  Active: "committed",
  Inactive: "neutral",
};

export function statusRole(status: string): Role {
  return STATUS_ROLE[status] ?? "neutral";
}

// A fit score's band. Lives here rather than in a component so every
// screen reads the same score the same way.
export function scoreRole(score: number): Role {
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
  return "low";
}

// Solid fill plus its paired foreground. Each value carries both halves in
// one string, which is what the styling law checks for.
export const SOLID: Record<Role, string> = {
  target: "bg-solid-target text-solid-target-on",
  contact: "bg-solid-contact text-solid-contact-on",
  visit: "bg-solid-visit text-solid-visit-on",
  offer: "bg-solid-offer text-solid-offer-on",
  committed: "bg-solid-committed text-solid-committed-on",
  high: "bg-solid-high text-solid-high-on",
  mid: "bg-solid-mid text-solid-mid-on",
  low: "bg-solid-low text-solid-low-on",
  time: "bg-solid-time text-solid-time-on",
  people: "bg-solid-people text-solid-people-on",
  place: "bg-solid-place text-solid-place-on",
  accent: "bg-solid-accent text-solid-accent-on",
  danger: "bg-solid-danger text-solid-danger-on",
  neutral: "bg-solid-neutral text-solid-neutral-on",
};

// A tint of the same role, for surfaces that sit beside a solid one and
// should not compete with it: stat tiles, group tabs, and the fit score.
export const TINT: Record<Role, string> = {
  target: "bg-tint-target text-tint-target-on",
  contact: "bg-tint-contact text-tint-contact-on",
  visit: "bg-tint-visit text-tint-visit-on",
  offer: "bg-tint-offer text-tint-offer-on",
  committed: "bg-tint-committed text-tint-committed-on",
  high: "bg-tint-high text-tint-high-on",
  mid: "bg-tint-mid text-tint-mid-on",
  low: "bg-tint-low text-tint-low-on",
  time: "bg-tint-time text-tint-time-on",
  people: "bg-tint-people text-tint-people-on",
  place: "bg-tint-place text-tint-place-on",
  accent: "bg-tint-accent text-tint-accent-on",
  danger: "bg-tint-danger text-tint-danger-on",
  neutral: "bg-tint-neutral text-tint-neutral-on",
};

// The 5px left rail on a card. A rail is a border, not a filled surface
// carrying text, so it takes the primitive rather than a pair.
export const RAIL: Record<Role, string> = {
  target: "border-l-ios-gray",
  contact: "border-l-ios-blue",
  visit: "border-l-ios-mint",
  offer: "border-l-ios-orange",
  committed: "border-l-ios-green",
  high: "border-l-ios-green",
  mid: "border-l-ios-yellow",
  low: "border-l-ios-gray",
  time: "border-l-ios-yellow",
  people: "border-l-ios-teal",
  place: "border-l-ios-indigo",
  accent: "border-l-ios-red",
  danger: "border-l-ios-pink",
  neutral: "border-l-ios-gray",
};

// The dot on a section header, same idea as the rail.
export const DOT: Record<Role, string> = {
  target: "bg-ios-gray",
  contact: "bg-ios-blue",
  visit: "bg-ios-mint",
  offer: "bg-ios-orange",
  committed: "bg-ios-green",
  high: "bg-ios-green",
  mid: "bg-ios-yellow",
  low: "bg-ios-gray",
  time: "bg-ios-yellow",
  people: "bg-ios-teal",
  place: "bg-ios-indigo",
  accent: "bg-ios-red",
  danger: "bg-ios-pink",
  neutral: "bg-ios-gray",
};

// The glyph colour, for the type icon that replaced the left rail
// (Dave 2026-09-16). Same hue as the rail it replaces, so a row that was
// orange is still orange and nothing has to be relearned. Foreground
// rather than background, because the glyph is a drawing and not a
// swatch: a filled tile behind every row reads heavier than the stripe
// it was meant to lighten.
export const FG: Record<Role, string> = {
  target: "text-ios-gray",
  contact: "text-ios-blue",
  visit: "text-ios-mint",
  offer: "text-ios-orange",
  committed: "text-ios-green",
  high: "text-ios-green",
  mid: "text-ios-yellow",
  low: "text-ios-gray",
  time: "text-ios-yellow",
  people: "text-ios-teal",
  place: "text-ios-indigo",
  accent: "text-ios-red",
  danger: "text-ios-pink",
  neutral: "text-ios-gray",
};
