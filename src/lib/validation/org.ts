// What an organization says about itself: its name and which of the
// optional modules it runs (audit wired F4). What it calls each role
// used to be here too; the access names are fixed now (Admin, Viewer,
// Athlete, Dave 2026-09-27) and a person's Title is set per person under
// Members.
//
// Pure, so the settings screen, the create screen and the laws all read
// the same rules. The web address (slug) follows the same pattern
// public.create_org checks in migration 0040: 2 to 48 lowercase letters,
// numbers and single hyphens. The database is the final word; this is
// the message somebody can act on before it gets there.

import type { OrgModules } from "@/lib/org/modules";

export const ORG_NAME_MAX = 120;
export const SLUG_MIN = 2;
export const SLUG_MAX = 48;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Only the modules that are off by default can be switched. Recruiting
// and document reading are the product; turning them off is not a
// setting anybody has asked for.
export const OPTIONAL_MODULES = ["board_governance", "donor_fundraising"] as const;
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];

export const MODULE_LABEL: Record<OptionalModule, { title: string; hint: string }> = {
  board_governance: { title: "Board", hint: "Boards, seats and give/get." },
  donor_fundraising: { title: "Fundraising", hint: "Donors, gifts, pledges, campaigns and grants." },
};

export function isValidSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug);
}

// A name to a web address: "Elite Squad NY" to "elite-squad-ny". Accents
// are dropped rather than refused, and anything left that is not a
// letter or a number becomes a single hyphen.
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return base.length >= SLUG_MIN ? base : "";
}

export interface CreateOrgValues {
  name: string;
  // Null when the person left it blank: the action derives one from the
  // name and tries the next free variant.
  slug: string | null;
}

export interface ParseResult<T> {
  ok: boolean;
  values: T | null;
  errors: Record<string, string>;
}

function checkName(raw: FormDataEntryValue | null, errors: Record<string, string>): string {
  const name = String(raw ?? "").trim();
  if (!name) errors.name = "What is the organization called?";
  else if (name.length > ORG_NAME_MAX) errors.name = `Keep it to ${ORG_NAME_MAX} characters.`;
  return name;
}

export function parseCreateOrgForm(formData: FormData): ParseResult<CreateOrgValues> {
  const errors: Record<string, string> = {};
  const name = checkName(formData.get("name"), errors);
  const rawSlug = String(formData.get("slug") ?? "").trim().toLowerCase();
  if (rawSlug && !isValidSlug(rawSlug)) {
    errors.slug = `Use ${SLUG_MIN} to ${SLUG_MAX} lowercase letters, numbers and single hyphens.`;
  }
  if (!rawSlug && name && !slugify(name)) {
    errors.slug = "Type a web address: the name has no letters or numbers to build one from.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, values: null, errors };
  return { ok: true, values: { name, slug: rawSlug || null }, errors: {} };
}

export interface OrgSettingsValues {
  name: string;
  modules: Record<OptionalModule, boolean>;
}

export function parseOrgSettingsForm(formData: FormData): ParseResult<OrgSettingsValues> {
  const errors: Record<string, string> = {};
  const name = checkName(formData.get("name"), errors);

  const modules = {} as Record<OptionalModule, boolean>;
  for (const m of OPTIONAL_MODULES) {
    const v = formData.get(`module_${m}`);
    modules[m] = v === "on" || v === "true" || v === "1";
  }

  if (Object.keys(errors).length > 0) return { ok: false, values: null, errors };
  return { ok: true, values: { name, modules }, errors: {} };
}

// The modules column after a settings save: the switches that were on
// the form, and every other key exactly as it was.
export function mergeModules(current: OrgModules, next: Record<OptionalModule, boolean>): OrgModules {
  return { ...current, ...next };
}

// A display name for a person, from the name field on either the member
// page or the More screen. Blank is allowed: the screens fall back to the
// email, which is what an invite without a name already shows.
export const PERSON_NAME_MAX = 120;

export function parsePersonName(raw: FormDataEntryValue | null): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length > PERSON_NAME_MAX) return { ok: false, error: `Keep it to ${PERSON_NAME_MAX} characters.` };
  return { ok: true, name };
}
