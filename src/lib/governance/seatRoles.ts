import type { BoardKind } from "@/lib/governance/giveGet";

// The core roles each tier carries, from the governance document. Sport
// boards name three explicitly; the others are an organization's own
// officers, so nothing is suggested rather than inventing titles. Shared
// by the Add Seat and Edit Seat screens.
export const SEAT_ROLE_SUGGESTIONS: Record<BoardKind, string[]> = {
  sport: ["Sport Director", "Board Chair", "Recruiting Lead"],
  executive: ["Chair", "Vice Chair", "Treasurer", "Secretary"],
  general: [],
  development: [],
  junior: [],
};
