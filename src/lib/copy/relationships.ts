// What a family login is to the athlete: parent, guardian, the athlete
// themselves, or other. Display only; the value is stored on
// athlete_guardians.relationship.
//
// This lives here rather than beside the form on purpose. The form is a
// client component, and a value exported from a "use client" module
// reaches a server component as a client reference, not as the array:
// the athlete page called .find() on it and the screen threw. A law in
// src/laws/dataLaws.test.ts now fails the build on that shape.

export const RELATIONSHIPS: { value: string; label: string }[] = [
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Guardian" },
  { value: "self", label: "The Athlete" },
  { value: "other", label: "Other" },
];

export function relationshipLabel(value: string | null | undefined): string {
  const known = RELATIONSHIPS.find((r) => r.value === value);
  if (known) return known.label;
  if (!value) return "Family";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
