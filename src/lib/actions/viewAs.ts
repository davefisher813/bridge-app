"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";
import { homeFor, requireOwner, type OrgRole } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { getViewAs } from "@/lib/data/viewAs";

// View As (migration 0047, docs/PLAN_STAGE5.md Phase 5). An Admin sees
// exactly what an Athlete login, a Viewer or another Admin sees, read
// only, for at most 30 minutes.
//
// This is the one action file that does not begin with requireNotViewing
// (src/laws/viewAsLaws.test.ts names it as the exception, with the
// reason): start and end are what turns viewing on and off, and each
// answers for the REAL caller. Everything that matters is decided in the
// database, in start_view_as and end_view_as (security definer, the only
// writers of view_as_sessions): who may start (an owner of that org,
// never a Viewer, an Athlete login or a leftover staff row), who may be
// viewed (a member of that org other than the caller), one session at a
// time, and the activity line for each end. Nothing is minted for anyone
// and nothing reads with the service role; the row changes whose eyes
// the policies use, on the caller's own token.
//
// Those two functions write the log lines themselves, as literals by the
// role viewed, so this file writes none: a line written from here would
// be refused while viewing, and one written before would be written
// before anything happened.

const q = (s: string) => encodeURIComponent(s);

// The same shape src/lib/org/membership uses for a slug in a URL and
// create_org enforces: nothing that could change where a redirect goes.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The database's refusals, in words for the screen. It never says more
// than the person chose: a stranger and someone outside the org get the
// same answer there, and here.
function startRefusal(error: { code?: string; message?: string }): string {
  if (error.code === "55000") return "You are already viewing as someone. Return to Admin first.";
  if (error.code === "23514" && /yourself/.test(error.message ?? "")) return "Choose someone other than yourself.";
  if (error.code === "42501") return "You cannot view as that person.";
  return "Could not start View As.";
}

// Start viewing as one person of this organization, then land on the
// home their own role opens: the Athlete's screens, the Viewer's, or the
// Admin's. Admin only: anyone else is Not Authorized before anything is
// asked of the database, and the database asks again.
export async function startViewAs(slug: string, targetId: string): Promise<void> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const back = `/org/${slug}/view-as`;
  const already = await getViewAs();
  if (already) redirect(`${back}?error=${q(`You are already viewing as ${already.name}. Return to Admin first.`)}`);
  await requireOwner(org.id);

  const id = String(targetId ?? "").trim();
  if (!UUID.test(id)) redirect(`${back}?error=${q("Choose a person from the list.")}`);

  const supabase = await createClient();
  // Read before the switch, as the Admin, for the role that decides where
  // they land. A person who is not in this org is not found: the same
  // answer whether or not they exist.
  const { data: seat } = await supabase.from("org_members").select("user_id, role").eq("org_id", org.id).eq("user_id", id).maybeSingle();
  if (!seat) redirect(`${back}?error=${q("That person is not in this organization.")}`);

  const { error } = await supabase.rpc("start_view_as", { p_org: org.id, p_target: id });
  if (error) redirect(`${back}?error=${q(startRefusal(error))}`);

  revalidatePath("/", "layout");
  redirect(homeFor(slug, seat!.role as OrgRole));
}

// Stop. Works from any screen and for any person being viewed, because it
// asks who the REAL caller is and nothing else: while an Admin is looking
// through a Viewer's eyes, they cannot pass an Admin check, and Return
// must not need one. No session open is not an error (a second tab, or
// the time ran out and something closed it), so Return always lands the
// Admin back on More.
export async function endViewAs(slug: string): Promise<void> {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { error } = await supabase.rpc("end_view_as");
  if (error) redirect(`/unauthorized?error=${q("Could not return to Admin. Try again.")}`);

  revalidatePath("/", "layout");
  redirect(SLUG.test(slug) ? `/org/${slug}/more?notice=${q("Returned to Admin.")}` : "/");
}
