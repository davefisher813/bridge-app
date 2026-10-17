// An Admin added without an invite may have no email yet (Dave,
// 2026-10-16). Every account needs one address, so such a person gets a
// placeholder nobody can receive mail at (the .invalid domain is reserved
// for exactly that). It is never shown: screens say "No email on file".

const SUFFIX = "@no-email.invalid";

export function noEmailAddress(): string {
  return `advisor-${crypto.randomUUID()}${SUFFIX}`;
}

export function isNoEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(SUFFIX);
}

// What a screen may show of an address: nothing for a placeholder.
export function visibleEmail(email: string | null | undefined): string {
  return email && !isNoEmail(email) ? email : "";
}
