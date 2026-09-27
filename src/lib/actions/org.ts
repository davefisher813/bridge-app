"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { mergeModules, parseCreateOrgForm, parseOrgSettingsForm, slugify, SLUG_MAX } from "@/lib/validation/org";

// An organization's own settings, and starting a new one (audit wired
// F4). Before this a new org, or a rename, was hand-written SQL.
//
// Creating goes through public.create_org (migration 0040), a security
// definer function that inserts the org and makes the caller its owner in
// one transaction. orgs and org_members stay closed to ordinary writes:
// an insert policy on org_members would let staff write themselves an
// owner row. The function checks the caller is signed in, refuses
// anyone with a membership that is not owner (staff, member or family
// anywhere), and refuses a blank name, a malformed address or a taken
// one, each with its own code.
//
// Settings are owner only and written with the service role, the same
// door the scoring preset and the reading budget use: orgs has no update
// policy on purpose.

export interface OrgActionState {
  errors: Record<string, string>;
  values?: Record<string, string>;
}

const q = (s: string) => encodeURIComponent(s);

// The rule create_org enforces (migration 0040), in the words the
// Create an Organization screen shows before anyone fills the form.
const NOT_ALLOWED = "Only an Admin, or someone not yet in any organization, can start one. Ask your organization's Admin.";

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

// The address candidates for a name, in order: the name itself, then
// name-2 up to name-9. Only used when the person left the address blank;
// an address they typed is theirs and a clash is reported, not renamed.
function candidates(base: string): string[] {
  const out = [base];
  for (let n = 2; n <= 9; n++) {
    const suffix = `-${n}`;
    out.push(`${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`);
  }
  return out;
}

export async function createOrg(_prev: OrgActionState, formData: FormData): Promise<OrgActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = parseCreateOrgForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors, values: echo(formData) };
  const { name, slug } = parsed.values;

  const tries = slug ? [slug] : candidates(slugify(name));
  let created: string | null = null;
  for (const attempt of tries) {
    const { data, error } = await supabase.rpc("create_org", { name, slug: attempt });
    if (!error) {
      created = attempt;
      if (!data) return { errors: { form: "The organization was not created. Try again." }, values: echo(formData) };
      break;
    }
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      if (slug) return { errors: { slug: "That web address is taken. Try another." }, values: echo(formData) };
      continue;
    }
    // 42501 is two refusals: no session or profile (sign in again), or
    // a caller who works inside another org as staff, a member or a
    // family login, who may not start one of their own.
    if (code === "42501") {
      if (/sign in first|no profile/.test(error.message)) redirect("/login");
      return { errors: { form: NOT_ALLOWED }, values: echo(formData) };
    }
    if (code === "23514") return { errors: { form: "Check the name and the web address and try again." }, values: echo(formData) };
    return { errors: { form: `Could not create the organization: ${error.message}` }, values: echo(formData) };
  }
  if (!created) return { errors: { slug: "Every address built from that name is taken. Type one of your own." }, values: echo(formData) };

  revalidatePath("/");
  // Settings next: which modules it runs is the first thing a new
  // Admin decides.
  redirect(`/org/${created}/settings?notice=${q(`${name} is ready and you are its Admin. Pick your modules, then invite your people under Members.`)}`);
}

export async function updateOrgSettings(slug: string, _prev: OrgActionState, formData: FormData): Promise<OrgActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const parsed = parseOrgSettingsForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors, values: echo(formData) };
  const v = parsed.values;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { errors: { form: "Saving settings is not set up on this server yet: the service role key is missing." }, values: echo(formData) };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    // orgs.role_labels is left as it is: the access names are fixed now
    // and nothing reads the column, but its data is not ours to drop.
    .update({ name: v.name, modules: mergeModules(org.modules, v.modules) })
    .eq("id", org.id)
    .select("id");
  if (error) return { errors: { form: error.message }, values: echo(formData) };
  if (!data || data.length === 0) return { errors: { form: "That organization is gone." }, values: echo(formData) };

  // The name shows on every screen in the org, and a module
  // switch adds or removes whole sections, so the whole org refreshes.
  revalidatePath(`/org/${slug}`, "layout");
  redirect(`/org/${slug}/more?notice=${q("Settings saved.")}`);
}
