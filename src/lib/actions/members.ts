"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner, type OrgRole } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { siteOrigin } from "@/lib/auth/origin";
import { parseInviteForm, parseRole } from "@/lib/validation/member";

// Who belongs to an org, and what they may do there. Owner only, and
// every write goes through the service role on purpose: org_members has
// no INSERT, UPDATE or DELETE policy, because a row in it is what grants
// access to everything else and carries its own role. A policy keyed off
// staff would let a coordinator write themselves in as owner (see
// docs/DECISIONS.md, 2026-09-17). requireOwner() is the gate; the admin
// client is the hand that writes.

export interface MemberActionState {
  errors: Record<string, string>;
  values?: Record<string, FormDataEntryValue>;
  notice?: string;
}

// Invites need the service role key. Without it the honest answer is
// that invites are not set up, not a stack trace from the admin client.
function serviceRoleConfigured(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function ownersOf(orgId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("org_members").select("user_id").eq("org_id", orgId).eq("role", "owner");
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

export async function inviteMember(slug: string, _prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const parsed = parseInviteForm(formData);
  if (!parsed.ok || !parsed.values) {
    return { errors: parsed.errors, values: Object.fromEntries(formData.entries()) };
  }
  const { email, role, fullName, athleteId } = parsed.values;

  // The athlete a family invite is for must be this org's. Read through
  // the caller's own client so RLS answers, not the admin client.
  let athleteName: string | null = null;
  if (role === "family" && athleteId) {
    const supabase = await createClient();
    const { data: athlete } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).eq("id", athleteId).is("deleted_at", null).maybeSingle();
    if (!athlete) {
      return { errors: { athleteId: "That athlete is not on this organization's roster." }, values: Object.fromEntries(formData.entries()) };
    }
    athleteName = (athlete as { name: string }).name;
  }

  if (!serviceRoleConfigured()) {
    return {
      errors: { form: "Invites are not set up on this server yet: the service role key is missing. Ask whoever deploys the app to add it." },
      values: Object.fromEntries(formData.entries()),
    };
  }

  const admin = createAdminClient();

  // Somebody who already has an account (a coach at another org, say)
  // is added straight away and signs in as usual. Somebody new gets an
  // invitation email; the trigger on auth.users creates their profile
  // row when Supabase creates the account.
  const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  let userId = (existing as { id: string } | null)?.id ?? null;
  let notice: string;

  if (userId) {
    const { data: membership } = await admin.from("org_members").select("role").eq("user_id", userId).eq("org_id", org.id).maybeSingle();
    if (membership) {
      // A family member invited for a second athlete (a parent with two
      // kids) gets the link added, not a refusal. Anyone else who is
      // already in the org is already in.
      if (role === "family" && (membership as { role: string }).role === "family" && athleteId) {
        const { data: linked } = await admin.from("athlete_guardians").select("athlete_id").eq("user_id", userId).eq("athlete_id", athleteId).maybeSingle();
        if (linked) {
          return { errors: { athleteId: `${email} is already linked to ${athleteName ?? "this athlete"}.` }, values: Object.fromEntries(formData.entries()) };
        }
        const { error: guardianError } = await admin.from("athlete_guardians").insert({ org_id: org.id, athlete_id: athleteId, user_id: userId });
        if (guardianError) {
          return { errors: { form: `Could not link ${email} to ${athleteName ?? "the athlete"}: ${guardianError.message}` }, values: Object.fromEntries(formData.entries()) };
        }
        revalidatePath(`/org/${slug}/members`);
        redirect(`/org/${slug}/members?notice=${encodeURIComponent(`${email} now sees ${athleteName ?? "that athlete"} as well.`)}`);
      }
      return { errors: { email: "Already a member of this organization." }, values: Object.fromEntries(formData.entries()) };
    }
    notice = `${email} already had an account and has been added. They can sign in with their email.`;
  } else {
    const origin = await siteOrigin();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: fullName ? { full_name: fullName } : {},
      redirectTo: `${origin}/auth/callback?next=/`,
    });
    if (error || !data?.user) {
      return { errors: { form: `Could not send the invitation: ${error?.message ?? "no account was created."}` }, values: Object.fromEntries(formData.entries()) };
    }
    userId = data.user.id;
    notice = `Invitation sent to ${email}.`;
  }

  const { error: memberError } = await admin.from("org_members").insert({ user_id: userId, org_id: org.id, role });
  if (memberError) {
    return { errors: { form: `The account exists but could not be added to ${org.name}: ${memberError.message}` }, values: Object.fromEntries(formData.entries()) };
  }

  // The link that makes a family login show something. Written after the
  // membership because the database checks, in that order, that the
  // person is a member and the athlete is the org's.
  if (role === "family" && athleteId) {
    const { error: guardianError } = await admin.from("athlete_guardians").insert({ org_id: org.id, athlete_id: athleteId, user_id: userId });
    if (guardianError) {
      return { errors: { form: `${email} was added but could not be linked to ${athleteName ?? "the athlete"}: ${guardianError.message}` }, values: Object.fromEntries(formData.entries()) };
    }
    notice = `${notice} They will see ${athleteName ?? "their athlete"} and nothing else.`;
  }

  revalidatePath(`/org/${slug}/members`);
  redirect(`/org/${slug}/members?notice=${encodeURIComponent(notice)}`);
}

export async function changeMemberRole(slug: string, userId: string, role: unknown): Promise<{ ok: boolean; error?: string }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Organization not found." };
  await requireOwner(org.id);

  const nextRole = parseRole(role);
  if (!nextRole) return { ok: false, error: "That is not a role." };

  // A family login is tied to an athlete and an org-wide login is not.
  // Moving between the two is a remove and a fresh invite, so the
  // guardian link is never left dangling on a staff account or missing
  // on a family one.
  const supabase = await createClient();
  const { data: current } = await supabase.from("org_members").select("role").eq("user_id", userId).eq("org_id", org.id).maybeSingle();
  const currentRole = (current as { role: string } | null)?.role;
  if (currentRole === "family" || nextRole === "family") {
    return { ok: false, error: "Family access is tied to an athlete. Remove them and invite them again instead." };
  }

  // An org always keeps at least one owner, or nobody can fix anything.
  if (nextRole !== "owner") {
    const owners = await ownersOf(org.id);
    if (owners.length === 1 && owners[0] === userId) {
      return { ok: false, error: "This is the organization's only owner. Make someone else an owner first." };
    }
  }

  if (!serviceRoleConfigured()) return { ok: false, error: "Changing roles is not set up on this server yet: the service role key is missing." };

  const admin = createAdminClient();
  const { error } = await admin.from("org_members").update({ role: nextRole satisfies OrgRole }).eq("user_id", userId).eq("org_id", org.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${slug}/members`);
  return { ok: true };
}

export async function removeMember(slug: string, userId: string): Promise<{ ok: boolean; error?: string; removedSelf?: boolean }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Organization not found." };
  const caller = await requireOwner(org.id);

  const owners = await ownersOf(org.id);
  if (owners.length === 1 && owners[0] === userId) {
    return { ok: false, error: "This is the organization's only owner. Make someone else an owner first." };
  }

  if (!serviceRoleConfigured()) return { ok: false, error: "Removing members is not set up on this server yet: the service role key is missing." };

  // The account stays; only this org's membership goes. Their other
  // organizations, if any, are untouched. A family member's links to
  // this org's athletes go with the membership: the database stops
  // honouring them the moment the membership is gone (migration 0026),
  // and a stale row must not come back to life on a re-invite.
  const admin = createAdminClient();
  const { error: linkError } = await admin.from("athlete_guardians").delete().eq("user_id", userId).eq("org_id", org.id);
  if (linkError) return { ok: false, error: linkError.message };
  const { error } = await admin.from("org_members").delete().eq("user_id", userId).eq("org_id", org.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/org/${slug}/members`);
  return { ok: true, removedSelf: caller.id === userId };
}

// A fresh sign-in link for somebody who was invited and has not come in
// yet. It is the ordinary magic link sent on their behalf, so it needs
// no service role: an existing account can always be sent a link.
export async function resendInvite(slug: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Organization not found." };
  await requireOwner(org.id);

  const supabase = await createClient();
  const { data: person } = await supabase.from("users").select("email").eq("id", userId).maybeSingle();
  const email = (person as { email: string } | null)?.email;
  if (!email) return { ok: false, error: "That person is not in this organization." };

  const origin = await siteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// The form-shaped wrappers the screens post to. Each turns a result into
// a redirect with a notice or an error in the query string, which is how
// a plain form on a server component reports back without client state.
const q = (s: string) => encodeURIComponent(s);

export async function changeMemberRoleForm(slug: string, userId: string, formData: FormData): Promise<void> {
  const r = await changeMemberRole(slug, userId, formData.get("role"));
  redirect(`/org/${slug}/members/${userId}?${r.ok ? `notice=${q("Role updated.")}` : `error=${q(r.error ?? "Could not change the role.")}`}`);
}

export async function removeMemberForm(slug: string, userId: string): Promise<void> {
  const r = await removeMember(slug, userId);
  if (!r.ok) redirect(`/org/${slug}/members/${userId}?error=${q(r.error ?? "Could not remove them.")}`);
  if (r.removedSelf) redirect("/");
  redirect(`/org/${slug}/members?notice=${q("Removed.")}`);
}

export async function resendInviteForm(slug: string, userId: string): Promise<void> {
  const r = await resendInvite(slug, userId);
  redirect(`/org/${slug}/members?${r.ok ? `notice=${q("A new sign-in link is on its way.")}` : `error=${q(r.error ?? "Could not send the link.")}`}`);
}
