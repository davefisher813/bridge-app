// What each access level is called, and what a person is shown as.
//
// Dave, 2026-09-27: "Admin, athlete, viewer. I control access of all
// that. Within admin I can set board, title, role, whatever." So there
// are three access levels, with fixed names, the same in every
// organization: owner is Admin, member is Viewer, family is Athlete. The
// enum values stay as they are (no change to RLS or the guards); only
// the words change. staff is retired (migration 0041 moved every staff
// row to owner) and still reads as Admin if one ever turns up, so an old
// row never renders as a database word or crashes a screen.
//
// orgs.role_labels (Bridge's "Executive Director", Elite's "Coach") is
// no longer read. The column and its data stay; what a person is called
// inside an org is now their own Title (org_members.title, 0041), set
// per person by an Admin, and it never grants anything.

import type { OrgRole } from "@/lib/auth/guard";

export const ACCESS_LEVEL: Record<OrgRole, string> = {
  owner: "Admin",
  staff: "Admin",
  member: "Viewer",
  family: "Athlete",
};

// The access level name for a role. Anything unexpected reads as Viewer,
// the level that can change nothing, rather than as the raw value.
export function labelForRole(role: OrgRole | string): string {
  return ACCESS_LEVEL[role as OrgRole] ?? ACCESS_LEVEL.member;
}

export const TITLE_MAX = 80;

// A person's Title, or null when they have none worth showing.
export function cleanTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const t = title.trim();
  return t ? t : null;
}

// What to show next to a person's name: their Title when an Admin has
// set one, otherwise their access level.
export function personLabel(person: { role: OrgRole | string; title?: string | null }): string {
  return cleanTitle(person.title) ?? labelForRole(person.role);
}
