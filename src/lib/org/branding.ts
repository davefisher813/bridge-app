// What an org looks like: for now, its mark. Read off orgs.branding
// (jsonb, free-form by design) and validated in code, the same way the
// modules and role labels are, so a malformed row cannot break a page.

export interface OrgBranding {
  // A path under /public (or an absolute URL) to a white mark on a
  // transparent background. The kit draws it in ink for the theme.
  logo: string | null;
  // The wordmark: mark and name in one image. When an org has one it
  // stands alone at the top of every screen, in place of the name.
  lockup: string | null;
}

export function parseBranding(input: unknown): OrgBranding {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const path = (v: unknown) => (typeof v === "string" && /^(\/|https:\/\/)/.test(v) ? v : null);
  return { logo: path(raw.logo), lockup: path(raw.lockup) };
}
