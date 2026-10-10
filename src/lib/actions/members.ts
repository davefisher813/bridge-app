"use server";

import { sendFailureMessage } from "@/lib/auth/errors";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner, requireRole, STAFF_ROLES, type OrgRole } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { siteOrigin } from "@/lib/auth/origin";
import { parseInviteForm, parseMemberTitle, parseRole } from "@/lib/validation/member";
import { parsePersonName } from "@/lib/validation/org";
import { RELATIONSHIPS } from "@/lib/copy/relationships";
import { canAdvise, isEligibleAdvisor } from "@/lib/org/advisors";
import { labelForRole } from "@/lib/org/roleLabels";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { checkPhoto, PHOTO_PATH_SHAPE } from "@/lib/people/photo";

// Who belongs to an org, and what they may do there. Owner only, and
// every write goes through the service role on purpose: org_members has
// no INSERT, UPDATE or DELETE policy, because a row in it is what grants
// access to everything else and carries its own role. A policy keyed off
// staff would let a coordinator write themselves in as owner (see
// docs/DECISIONS.md, 2026-09-17). requireOwner() is the gate; the admin
// client is the hand that writes. Two exceptions, each with its own
// check: a family invite and advisor assignments are owner or staff, and
// anyone may change their own name.

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

type Supabase = Awaited<ReturnType<typeof createClient>>;

// What the activity log (Stage 5, Phase 6) calls a person: their name on
// users, read through the caller's own client (users_in_my_orgs, 0031),
// or nothing, which the template reads as "someone". Never their email.
async function personName(supabase: Supabase, userId: string): Promise<string | null> {
  const { data } = await supabase.from("users").select("full_name").eq("id", userId).maybeSingle();
  return (data as { full_name: string | null } | null)?.full_name?.trim() || null;
}

export async function inviteMember(slug: string, _prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  // Staff may invite a FAMILY from an athlete's page (Dave's pick,
  // 2026-09-21: "staff invite a family from the athlete's page"). Every
  // other role is an owner's to hand out, as before.
  const user = await requireRole(org.id, STAFF_ROLES);

  const parsed = parseInviteForm(formData);
  if (!parsed.ok || !parsed.values) {
    return { errors: parsed.errors, values: Object.fromEntries(formData.entries()) };
  }
  const { email, role, fullName, athleteId, relationship } = parsed.values;
  if (role !== "family" && user.role !== "owner") {
    return { errors: { role: "Only an Admin can invite an Admin or a Viewer. You can invite an Athlete login from an athlete's page." }, values: Object.fromEntries(formData.entries()) };
  }

  // Add Admin from an athlete's Advisor sheet (Stage 5, Phase 2): the
  // new Admin is assigned as that athlete's advisor once they are in.
  // Only a role that may advise; an athlete login or a Viewer cannot.
  const assignAthleteId = String(formData.get("assignAthleteId") ?? "").trim() || null;
  if (assignAthleteId && !canAdvise(role)) {
    return { errors: { role: "Only an Admin can be an athlete's advisor." }, values: Object.fromEntries(formData.entries()) };
  }

  // Where to go afterwards: the athlete's page when the invite started
  // there, the members list otherwise. Only a path inside this org.
  const rawReturn = String(formData.get("returnTo") ?? "");
  const returnTo = rawReturn.startsWith(`/org/${slug}/`) && !rawReturn.includes("//") ? rawReturn : `/org/${slug}/members`;
  const done = (notice: string): never => {
    revalidatePath(`/org/${slug}/members`);
    if (athleteId) revalidatePath(`/org/${slug}/roster/${athleteId}`);
    if (assignAthleteId) revalidatePath(`/org/${slug}/roster/${assignAthleteId}`);
    redirect(`${returnTo}?notice=${encodeURIComponent(notice)}`);
  };

  // The caller's own client: every read below goes through it so RLS
  // answers, not the admin client, and the activity log is signed by it.
  const supabase = await createClient();

  // The athlete a family invite is for must be this org's.
  let athleteName: string | null = null;
  if (role === "family" && athleteId) {
    const { data: athlete } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).eq("id", athleteId).is("deleted_at", null).maybeSingle();
    if (!athlete) {
      return { errors: { athleteId: "That athlete is not on this organization's roster." }, values: Object.fromEntries(formData.entries()) };
    }
    athleteName = (athlete as { name: string }).name;
  }

  // The athlete the new Admin will advise must be this org's too, read
  // the same way. Checked before any account is made.
  let advisee: { id: string; name: string } | null = null;
  if (assignAthleteId) {
    const { data: found } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).eq("id", assignAthleteId).is("deleted_at", null).maybeSingle();
    if (!found) {
      return { errors: { form: "That athlete is not on this organization's roster." }, values: Object.fromEntries(formData.entries()) };
    }
    advisee = found as { id: string; name: string };
  }

  // The assignment, through the caller's own client so RLS and the
  // advisor trigger answer, after the membership exists. A failure here
  // leaves the person in and says so; nothing is rolled back, because
  // the invite itself went out.
  const assign = async (personId: string): Promise<string | null> => {
    if (!advisee) return null;
    const { data, error } = await supabase.from("athletes").update({ advisor_id: personId }).eq("org_id", org.id).eq("id", advisee.id).select("id");
    if (error) return error.message;
    if (!data || data.length === 0) return "the athlete could not be updated";
    return null;
  };

  // The activity log (Stage 5, Phase 6). An invite is one row, naming
  // the person, the access level and, for an Athlete login, the athlete
  // they were linked to; an assignment made on the way is its own row
  // on the athlete. Names and levels only; the email never goes in.
  const logInvited = async (personId: string, invitedName: string | null, linkedTo: string | null): Promise<void> => {
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      action: "member_invited",
      subjectType: "member",
      subjectId: personId,
      athleteId: linkedTo ? athleteId : null,
      summary: activitySummary("member_invited", { name: invitedName, role: labelForRole(role), athlete: linkedTo }),
    });
  };
  const logAssigned = async (invitedName: string | null): Promise<void> => {
    if (!advisee) return;
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      action: "advisor_set",
      subjectType: "athlete",
      subjectId: advisee.id,
      athleteId: advisee.id,
      summary: activitySummary("advisor_set", { name: advisee.name, advisor: invitedName ?? "" }),
    });
  };

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
  const { data: existing } = await admin.from("users").select("id, full_name").eq("email", email).maybeSingle();
  let userId = (existing as { id: string } | null)?.id ?? null;
  // What the log calls them: the name typed on the form, else the name
  // their account already carries.
  const invitedName = fullName || (existing as { full_name: string | null } | null)?.full_name?.trim() || null;
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
        const { error: guardianError } = await admin.from("athlete_guardians").insert({ org_id: org.id, athlete_id: athleteId, user_id: userId, relationship: relationship ?? null });
        if (guardianError) {
          return { errors: { form: `Could not link ${email} to ${athleteName ?? "the athlete"}: ${guardianError.message}` }, values: Object.fromEntries(formData.entries()) };
        }
        await logInvited(userId, invitedName, athleteName);
        return done(`${email} now sees ${athleteName ?? "that athlete"} as well.`);
      }
      // Add Admin for somebody already an Admin here: no second
      // membership, they are simply assigned. Anyone else who is already
      // in the org is already in.
      if (advisee && canAdvise((membership as { role: string }).role)) {
        const failed = await assign(userId);
        if (failed) return { errors: { form: `${email} is already an Admin here but could not be assigned to ${advisee.name}: ${failed}.` }, values: Object.fromEntries(formData.entries()) };
        await logAssigned(invitedName);
        return done(`${email} was already an Admin here and is now ${advisee.name}'s advisor.`);
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
      return { errors: { form: `Could not send the invitation: ${error ? sendFailureMessage(error.message) : "no account was created."}` }, values: Object.fromEntries(formData.entries()) };
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
    const { error: guardianError } = await admin.from("athlete_guardians").insert({ org_id: org.id, athlete_id: athleteId, user_id: userId, relationship: relationship ?? null });
    if (guardianError) {
      // They are in, unlinked: logged as such before the error goes back.
      await logInvited(userId, invitedName, null);
      return { errors: { form: `${email} was added but could not be linked to ${athleteName ?? "the athlete"}: ${guardianError.message}` }, values: Object.fromEntries(formData.entries()) };
    }
    notice = `${notice} They will see ${athleteName ?? "their athlete"} and nothing else.`;
  }
  await logInvited(userId, invitedName, role === "family" ? athleteName : null);

  // Written after the membership, because the database checks, in that
  // order, that the advisor is an Admin of the athlete's org.
  if (advisee) {
    const failed = await assign(userId);
    if (failed) {
      return { errors: { form: `${email} was added but could not be assigned to ${advisee.name}: ${failed}. Assign them from the athlete's page.` }, values: Object.fromEntries(formData.entries()) };
    }
    await logAssigned(invitedName);
    notice = `${notice} They are ${advisee.name}'s advisor.`;
  }

  return done(notice);
}

// A role change, in place. Moving a family login to an org-wide role, or
// the other way, used to be a remove and a fresh invite (audit crud
// F23). Now it happens here, with the links kept straight:
//
//   - family to anything else drops that person's links to this org's
//     athletes, because an org-wide role sees athletes through the role
//     and a stale link would come back to life on a later switch. It
//     only goes ahead with `confirmed`, which the screen sets from a
//     confirm sheet naming what they stop seeing.
//   - anything to family needs the athlete they will see, since a family
//     login with no link shows nothing. Their advisor assignments and
//     any board seat linked to their sign-in are cleared: a family login
//     can neither advise (migration 0039) nor hold a seat.
export interface RoleChangeOptions {
  athleteId?: string | null;
  relationship?: string | null;
  confirmed?: boolean;
}

export async function changeMemberRole(slug: string, userId: string, role: unknown, opts: RoleChangeOptions = {}): Promise<{ ok: boolean; error?: string }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Organization not found." };
  const caller = await requireOwner(org.id);

  // staff is retired (migration 0041) and parses as nothing, so a
  // stale form or a hand-built request for it is refused before any
  // read or write.
  const nextRole = parseRole(role);
  if (!nextRole) return { ok: false, error: "Pick Admin, Viewer or Athlete." };

  const supabase = await createClient();
  const { data: current } = await supabase.from("org_members").select("role").eq("user_id", userId).eq("org_id", org.id).maybeSingle();
  const currentRole = (current as { role: string } | null)?.role as OrgRole | undefined;
  if (!currentRole) return { ok: false, error: "That person is not in this organization." };
  if (currentRole === nextRole) return { ok: true };

  const leavingFamily = currentRole === "family";
  const becomingFamily = nextRole === "family";

  if (leavingFamily && !opts.confirmed) {
    return { ok: false, error: "Athlete access is tied to an athlete. Confirm the switch: they stop seeing the athletes they are linked to." };
  }

  // The athlete a new family login will see, checked against this org's
  // roster through the caller's own client.
  const athleteId = (opts.athleteId ?? "").trim();
  let athleteName: string | null = null;
  if (becomingFamily) {
    if (!athleteId) return { ok: false, error: "Athlete access is tied to an athlete. Pick the athlete they should see." };
    const { data: athlete } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).eq("id", athleteId).is("deleted_at", null).maybeSingle();
    if (!athlete) return { ok: false, error: "That athlete is not on this organization's roster." };
    athleteName = (athlete as { name: string }).name;
  }
  const relationshipRaw = (opts.relationship ?? "").trim();
  const relationship = RELATIONSHIPS.some((r) => r.value === relationshipRaw) ? relationshipRaw : "parent";

  // An org always keeps at least one owner, or nobody can fix anything.
  if (nextRole !== "owner") {
    const owners = await ownersOf(org.id);
    if (owners.length === 1 && owners[0] === userId) {
      return { ok: false, error: "This is the organization's only Admin. Make someone else an Admin first." };
    }
  }

  if (!serviceRoleConfigured()) return { ok: false, error: "Changing roles is not set up on this server yet: the service role key is missing." };

  const admin = createAdminClient();
  // A member or a family login cannot advise (migration 0039). The
  // trigger only fires when an athlete is written, so the change clears
  // the column itself, or the athletes they advised keep pointing at
  // somebody who no longer may and reminders keep counting them.
  if (nextRole === "member" || becomingFamily) {
    const { error: advisorError } = await admin.from("athletes").update({ advisor_id: null }).eq("org_id", org.id).eq("advisor_id", userId);
    if (advisorError) return { ok: false, error: advisorError.message };
  }
  if (becomingFamily) {
    const { error: seatError } = await admin.from("board_members").update({ user_id: null }).eq("org_id", org.id).eq("user_id", userId);
    if (seatError) return { ok: false, error: seatError.message };
  }
  if (leavingFamily) {
    const { error: linkError } = await admin.from("athlete_guardians").delete().eq("org_id", org.id).eq("user_id", userId);
    if (linkError) return { ok: false, error: linkError.message };
  }

  const { error } = await admin.from("org_members").update({ role: nextRole satisfies OrgRole }).eq("user_id", userId).eq("org_id", org.id);
  if (error) return { ok: false, error: error.message };

  // Written after the role, because the database checks, in that order,
  // that the person is a family member and the athlete is the org's. If
  // the link fails the role goes back, so nobody is left a family login
  // who sees nothing.
  if (becomingFamily) {
    const { error: guardianError } = await admin.from("athlete_guardians").insert({ org_id: org.id, athlete_id: athleteId, user_id: userId, relationship });
    if (guardianError) {
      await admin.from("org_members").update({ role: currentRole }).eq("user_id", userId).eq("org_id", org.id);
      return { ok: false, error: `Could not link them to ${athleteName ?? "the athlete"}: ${guardianError.message}` };
    }
  }

  // The activity log (Stage 5, Phase 6): one row, the person and the two
  // access levels, on the athlete when the change linked them to one.
  // An Admin who just made themselves a Viewer is no longer one, so the
  // insert policy would refuse their own client; the server records it
  // for them (the row still names them as the actor).
  await logActivity(caller.id === userId ? admin : supabase, {
    orgId: org.id,
    actorId: caller.id,
    action: "member_role_changed",
    subjectType: "member",
    subjectId: userId,
    athleteId: becomingFamily ? athleteId : null,
    summary: activitySummary("member_role_changed", { name: (await personName(supabase, userId)) ?? "", from: labelForRole(currentRole), to: labelForRole(nextRole) }),
  });

  revalidatePath(`/org/${slug}/members`);
  revalidatePath(`/org/${slug}/members/${userId}`);
  if (nextRole === "member" || becomingFamily || leavingFamily) {
    revalidatePath(`/org/${slug}/mine`);
    revalidatePath(`/org/${slug}`);
  }
  if (becomingFamily && athleteId) revalidatePath(`/org/${slug}/roster/${athleteId}`);
  return { ok: true };
}

export async function removeMember(slug: string, userId: string): Promise<{ ok: boolean; error?: string; removedSelf?: boolean }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Organization not found." };
  const caller = await requireOwner(org.id);

  const owners = await ownersOf(org.id);
  if (owners.length === 1 && owners[0] === userId) {
    return { ok: false, error: "This is the organization's only Admin. Make someone else an Admin first." };
  }

  if (!serviceRoleConfigured()) return { ok: false, error: "Removing members is not set up on this server yet: the service role key is missing." };

  // The account stays; only this org's membership goes. Their other
  // organizations, if any, are untouched. A family member's links to
  // this org's athletes go with the membership: the database stops
  // honouring them the moment the membership is gone (migration 0026),
  // and a stale row must not come back to life on a re-invite.
  // Their name, read before the membership goes: once it is gone the
  // caller can no longer see their users row (users_in_my_orgs, 0031).
  const supabase = await createClient();
  const name = await personName(supabase, userId);

  const admin = createAdminClient();
  // The athletes they advised here lose their advisor with the
  // membership, for the same reason as a demotion above.
  const { error: advisorError } = await admin.from("athletes").update({ advisor_id: null }).eq("org_id", org.id).eq("advisor_id", userId);
  if (advisorError) return { ok: false, error: advisorError.message };
  const { error: linkError } = await admin.from("athlete_guardians").delete().eq("user_id", userId).eq("org_id", org.id);
  if (linkError) return { ok: false, error: linkError.message };
  const { error } = await admin.from("org_members").delete().eq("user_id", userId).eq("org_id", org.id);
  if (error) return { ok: false, error: error.message };

  // The activity log (Stage 5, Phase 6): one row, org-level, naming who
  // left. An Admin who removed themselves is no longer a member here, and
  // the insert policy reads the membership as it stands after the delete,
  // so their own client would be refused; the server records that one
  // (the row still names them as the actor).
  await logActivity(caller.id === userId ? admin : supabase, {
    orgId: org.id,
    actorId: caller.id,
    action: "member_removed",
    subjectType: "member",
    subjectId: userId,
    summary: activitySummary("member_removed", { name: name ?? "" }),
  });

  revalidatePath(`/org/${slug}/members`);
  revalidatePath(`/org/${slug}/mine`);
  revalidatePath(`/org/${slug}`);
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
  if (error) return { ok: false, error: sendFailureMessage(error.message) };
  return { ok: true };
}

// The form-shaped wrappers the screens post to. Each turns a result into
// a redirect with a notice or an error in the query string, which is how
// a plain form on a server component reports back without client state.
const q = (s: string) => encodeURIComponent(s);

export async function changeMemberRoleForm(slug: string, userId: string, formData: FormData): Promise<void> {
  const r = await changeMemberRole(slug, userId, formData.get("role"), {
    athleteId: String(formData.get("athleteId") ?? "").trim() || null,
    relationship: String(formData.get("relationship") ?? "").trim() || null,
    confirmed: formData.get("confirmed") === "yes",
  });
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

// ── Names (audit crud F17) ───────────────────────────────────────────
// users.full_name was set once, at invite, and nobody could change it.
// users has no update policy, so both paths below write with the service
// role, each after its own check: an owner renames somebody who is a
// member of the owner's org, and anybody renames themselves. Never
// anyone else, and never somebody outside the org.

async function writeName(userId: string, name: string): Promise<string | null> {
  if (!serviceRoleConfigured()) return "Changing names is not set up on this server yet: the service role key is missing.";
  const admin = createAdminClient();
  const { data, error } = await admin.from("users").update({ full_name: name }).eq("id", userId).select("id");
  if (error) return error.message;
  if (!data || data.length === 0) return "That account is gone.";
  return null;
}

export async function renameMemberForm(slug: string, userId: string, formData: FormData): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const me = await requireOwner(org.id);
  const back = `/org/${slug}/members/${userId}`;

  const parsed = parsePersonName(formData.get("fullName"));
  if (!parsed.ok) redirect(`${back}?error=${q(parsed.error)}`);

  // The target is in this org, read through the owner's own client.
  const supabase = await createClient();
  const { data: membership } = await supabase.from("org_members").select("user_id").eq("org_id", org.id).eq("user_id", userId).maybeSingle();
  if (!membership) redirect(`${back}?error=${q("That person is not in this organization.")}`);

  // users.full_name is one name across every org the person is in, and
  // anyone signed in can start an org (create_org, 0040) and add an
  // existing account to it by email. So an owner renames somebody only
  // when every org that person belongs to is one this owner also owns;
  // otherwise the rename would reach into orgs this owner does not run.
  if (serviceRoleConfigured()) {
    const admin = createAdminClient();
    const [{ data: theirs }, { data: mine }] = await Promise.all([
      admin.from("org_members").select("org_id").eq("user_id", userId),
      admin.from("org_members").select("org_id").eq("user_id", me.id).eq("role", "owner"),
    ]);
    const owned = new Set(((mine ?? []) as { org_id: string }[]).map((r) => r.org_id));
    if (((theirs ?? []) as { org_id: string }[]).some((r) => !owned.has(r.org_id))) {
      redirect(`${back}?error=${q("They also belong to another organization, so only they can change their name, under More.")}`);
    }
  }

  const failed = await writeName(userId, parsed.name);
  if (failed) redirect(`${back}?error=${q(failed)}`);

  revalidatePath(`/org/${slug}`, "layout");
  redirect(`${back}?notice=${q(parsed.name ? "Name saved." : "Name cleared. Their email shows instead.")}`);
}

// Your own name, from the More screen of whichever version of the app
// you use (staff, member or family). Any role in the org.
export async function renameSelfForm(slug: string, formData: FormData): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const me = await requireRole(org.id, ["owner", "staff", "member", "family"]);

  const rawBack = String(formData.get("returnTo") ?? "");
  const back = rawBack.startsWith(`/org/${slug}/`) && !rawBack.includes("//") && !rawBack.includes("?") ? rawBack : `/org/${slug}/more`;

  const parsed = parsePersonName(formData.get("fullName"));
  if (!parsed.ok) redirect(`${back}?error=${q(parsed.error)}`);

  const failed = await writeName(me.id, parsed.name);
  if (failed) redirect(`${back}?error=${q(failed)}`);

  revalidatePath(`/org/${slug}`, "layout");
  redirect(`${back}?notice=${q("Your name is saved.")}`);
}

// ── Titles (migration 0041) ─────────────────────────────────────────
// Dave, 2026-09-27: "Within admin I can set board, title, role,
// whatever." A Title is what a person is called here (Head Coach, Board
// Chair), shown next to their name wherever the access level used to
// be. Display only, never a permission. org_members has no update
// policy, so the write is the service role's, behind the same Admin
// gate as every other member action, scoped by org and person.
export async function setMemberTitle(slug: string, userId: string, raw: unknown): Promise<{ ok: boolean; error?: string; title?: string | null }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Organization not found." };
  await requireOwner(org.id);

  const parsed = parseMemberTitle(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  // The person is in this org, asked through the Admin's own client.
  const supabase = await createClient();
  const { data: membership } = await supabase.from("org_members").select("user_id").eq("org_id", org.id).eq("user_id", userId).maybeSingle();
  if (!membership) return { ok: false, error: "That person is not in this organization." };

  if (!serviceRoleConfigured()) return { ok: false, error: "Changing titles is not set up on this server yet: the service role key is missing." };

  const admin = createAdminClient();
  const { data, error } = await admin.from("org_members").update({ title: parsed.title }).eq("org_id", org.id).eq("user_id", userId).select("user_id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "That person is not in this organization." };

  // The Title shows on the members list, their page, every athlete they
  // advise and the athlete logins' screens, so the whole org refreshes.
  revalidatePath(`/org/${slug}`, "layout");
  return { ok: true, title: parsed.title };
}

export async function setMemberTitleForm(slug: string, userId: string, formData: FormData): Promise<void> {
  const r = await setMemberTitle(slug, userId, formData.get("title"));
  const back = `/org/${slug}/members/${userId}`;
  redirect(`${back}?${r.ok ? `notice=${q(r.title ? "Title saved." : "Title cleared. Their access level shows instead.")}` : `error=${q(r.error ?? "Could not save the title.")}`}`);
}

// ── Advisors (audit crud F18; Stage 5, Phase 2) ──────────────────────
// Connect several athletes to one advisor, or take one off, from the
// member page; or one athlete's advisor from the athlete page's sheet
// (src/lib/actions/advisor.ts), which calls this too. Any Admin, the
// same guard as editing the athlete. The advisor must be an Admin here
// (the one rule, src/lib/org/advisors.ts, asked first so the answer is
// a sentence), and every athlete must be this org's. Nothing is
// recomputed: fit does not read the advisor. The database stamps
// advisor_assigned_at itself (migration 0043).

export async function setAthleteAdvisor(
  slug: string,
  athleteIds: string[],
  advisorId: string | null,
  opts: { onlyFrom?: string } = {},
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const org = await getOrgBySlug(slug);
  if (!org) return { ok: false, error: "Organization not found." };
  const user = await requireRole(org.id, STAFF_ROLES);

  const ids = [...new Set(athleteIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: "Pick at least one athlete." };

  const supabase = await createClient();
  if (advisorId && !(await isEligibleAdvisor(supabase, org.id, advisorId))) {
    return { ok: false, error: "Only an Admin can advise athletes." };
  }

  const { data: found } = await supabase.from("athletes").select("id").eq("org_id", org.id).in("id", ids).is("deleted_at", null);
  if ((found ?? []).length !== ids.length) return { ok: false, error: "One of those athletes is not on this organization's roster." };

  let update = supabase.from("athletes").update({ advisor_id: advisorId }).eq("org_id", org.id).in("id", ids);
  // Taking an advisor off touches only the athletes they actually
  // advise, so a stale screen cannot clear somebody else's assignment.
  if (opts.onlyFrom) update = update.eq("advisor_id", opts.onlyFrom);
  const { data, error } = await update.select("id, name");
  if (error) return { ok: false, error: error.message };

  // The activity log (Stage 5, Phase 6): one row per athlete actually
  // changed, on that athlete, naming the advisor or saying cleared.
  const advisorName = advisorId ? await personName(supabase, advisorId) : null;
  for (const changed of (data ?? []) as { id: string; name: string }[]) {
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      action: advisorId ? "advisor_set" : "advisor_cleared",
      subjectType: "athlete",
      subjectId: changed.id,
      athleteId: changed.id,
      summary: advisorId ? activitySummary("advisor_set", { name: changed.name, advisor: advisorName ?? "" }) : activitySummary("advisor_cleared", { name: changed.name }),
    });
  }

  revalidatePath(`/org/${slug}/members`);
  revalidatePath(`/org/${slug}/mine`);
  revalidatePath(`/org/${slug}/roster`);
  for (const id of ids) revalidatePath(`/org/${slug}/roster/${id}`);
  return { ok: true, count: (data ?? []).length };
}

// The member page's two forms: tick athletes and assign, or take one off.
export async function assignAdvisorForm(slug: string, advisorId: string, formData: FormData): Promise<void> {
  const ids = formData.getAll("athleteId").map((v) => String(v));
  const r = await setAthleteAdvisor(slug, ids, advisorId);
  const n = r.count ?? 0;
  redirect(`/org/${slug}/members/${advisorId}?${r.ok ? `notice=${q(`${n} ${n === 1 ? "athlete" : "athletes"} now advised here.`)}` : `error=${q(r.error ?? "Could not assign them.")}`}`);
}

export async function unassignAdvisorForm(slug: string, advisorId: string, athleteId: string): Promise<void> {
  const r = await setAthleteAdvisor(slug, [athleteId], null, { onlyFrom: advisorId });
  redirect(`/org/${slug}/members/${advisorId}?${r.ok ? `notice=${q(r.count ? "No longer their advisor." : "They were not advising that athlete.")}` : `error=${q(r.error ?? "Could not take them off.")}`}`);
}

// ── A person's photo (migration 0049) ───────────────────────────────
// Set and cleared by an Admin of this org, on that person's page. One
// photo per membership, so nothing here reaches into another org. The
// browser uploads to a private bucket an Admin may add to and nobody may
// read; the server checks the file, points the row at it, and serves it
// by /org/<slug>/members/<user>/photo to members of this org only. The
// photo it replaces is removed, so the bucket holds one per person.

async function memberPhotoTarget(slug: string, userId: string): Promise<{ orgId: string; current: string | null } | { error: string }> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);
  if (!serviceRoleConfigured()) return { error: "Photos are not set up on this server." };
  const supabase = await createClient();
  const { data } = await supabase.from("org_members").select("user_id, photo_path").eq("org_id", org.id).eq("user_id", userId).maybeSingle();
  if (!data) return { error: "That person is not in this organization." };
  return { orgId: org.id, current: (data as { photo_path?: string | null }).photo_path ?? null };
}

// The photo is already in the bucket: the browser put it under
// <org>/<user>/. Read back and checked here before the row points at it;
// a file that fails the check is removed, so nothing is left loose.
export async function setMemberPhoto(slug: string, userId: string, storagePath: unknown): Promise<{ ok: boolean; error?: string }> {
  const target = await memberPhotoTarget(slug, userId);
  if ("error" in target) return { ok: false, error: target.error };
  const path = typeof storagePath === "string" ? storagePath : "";
  if (!PHOTO_PATH_SHAPE.test(path) || !path.startsWith(`${target.orgId}/${userId}/`)) return { ok: false, error: "That photo was not uploaded for this person." };
  if (path === target.current) return { ok: true };

  const admin = createAdminClient();
  const { data: blob, error: readError } = await admin.storage.from("member-photos").download(path);
  if (readError || !blob) return { ok: false, error: "The photo could not be read back after upload. Try again." };
  const checked = checkPhoto(new Uint8Array(await blob.arrayBuffer()));
  if (!checked.ok) {
    await admin.storage.from("member-photos").remove([path]);
    return { ok: false, error: checked.error };
  }

  const { error } = await admin.from("org_members").update({ photo_path: path }).eq("org_id", target.orgId).eq("user_id", userId);
  if (error) {
    await admin.storage.from("member-photos").remove([path]);
    return { ok: false, error: `The photo could not be saved: ${error.message}` };
  }
  if (target.current && PHOTO_PATH_SHAPE.test(target.current) && target.current.startsWith(`${target.orgId}/${userId}/`)) {
    await admin.storage.from("member-photos").remove([target.current]);
  }
  revalidatePath(`/org/${slug}`, "layout");
  return { ok: true };
}

export async function removeMemberPhotoForm(slug: string, userId: string): Promise<void> {
  const back = `/org/${slug}/members/${userId}`;
  const target = await memberPhotoTarget(slug, userId);
  if ("error" in target) redirect(`${back}?error=${q(target.error)}`);
  if (!target.current) redirect(`${back}?notice=${q("No photo to remove.")}`);
  const admin = createAdminClient();
  const { error } = await admin.from("org_members").update({ photo_path: null }).eq("org_id", target.orgId).eq("user_id", userId);
  if (error) redirect(`${back}?error=${q(`The photo could not be removed: ${error.message}`)}`);
  if (PHOTO_PATH_SHAPE.test(target.current) && target.current.startsWith(`${target.orgId}/${userId}/`)) {
    await admin.storage.from("member-photos").remove([target.current]);
  }
  revalidatePath(`/org/${slug}`, "layout");
  redirect(`${back}?notice=${q("Photo removed. Their initials show instead.")}`);
}
