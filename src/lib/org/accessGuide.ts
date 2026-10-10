// What each access level can see and do, in plain sentences, for the
// Members screen (Alfred's audit, 2026-10-10: with minors' records in the
// app, an Admin needs to know exactly what a Viewer or an Athlete login
// sees before inviting one; View As was cut on 2026-09-30). Each line is
// what the database's row level security and the screens enforce
// (migrations 0022, 0024, 0031; src/laws/accessLaws.test.ts), not a wish.

export const ACCESS_GUIDE: { level: string; sees: string[]; never: string[] }[] = [
  {
    level: "Admin",
    sees: ["Every athlete, document, target, note and message in this organization", "Fundraising, the board, members, settings and the activity log"],
    never: ["Another organization's records"],
  },
  {
    level: "Viewer",
    sees: ["The program as totals and stages: how many athletes are where, and placements", "Their own board seat and their own giving"],
    never: ["Any athlete's documents, grades, notes or messages", "Members, settings or the activity log"],
  },
  {
    level: "Athlete",
    sees: ["One athlete only, the one they were linked to: their profile, matches and colleges", "Messages with that athlete's advisor, and their own assignments and uploads"],
    never: ["Any other athlete", "The Documents screen, notes Admins keep, fundraising or the board"],
  },
];
