"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { centsToDecimalString } from "@/lib/validation/gift";
import { toCents } from "@/lib/fundraising/rollup";
import { BOARD_KINDS, DEFAULT_GIVE_GET_CENTS, DEFAULT_SEATS, type BoardKind } from "@/lib/governance/giveGet";

export interface GovernanceActionState {
  errors: Record<string, string>;
}

// Same shape as the fundraising gate, and for the same reason: a server
// action is a public endpoint, so a screen that never renders for Elite
// Squad is not the same thing as an action they cannot call.
async function requireGovernance(slug: string) {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  if (!org.modules.board_governance) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);
  return { org, user };
}

export async function createBoard(
  slug: string,
  _prevState: GovernanceActionState,
  formData: FormData
): Promise<GovernanceActionState> {
  const { org } = await requireGovernance(slug);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { errors: { name: "A board needs a name." } };

  const kind = String(formData.get("kind") ?? "");
  if (!(BOARD_KINDS as string[]).includes(kind)) return { errors: { kind: "Pick a tier." } };

  const rawGiveGet = String(formData.get("giveGet") ?? "").trim();
  const giveGetCents = rawGiveGet === "" ? DEFAULT_GIVE_GET_CENTS[kind as BoardKind] : toCents(rawGiveGet);
  if (giveGetCents < 0) return { errors: { giveGet: "A commitment cannot be negative." } };

  const defaults = DEFAULT_SEATS[kind as BoardKind];
  const minSeats = Number(String(formData.get("minSeats") ?? "")) || defaults.min;
  const maxSeats = Number(String(formData.get("maxSeats") ?? "")) || defaults.max;
  if (maxSeats < minSeats) return { errors: { maxSeats: "The maximum cannot be below the minimum." } };

  const sport = String(formData.get("sport") ?? "").trim() || null;
  // A sport board without a sport is the one case where the tier itself
  // makes a field required, since the whole point of the tier is that
  // there is one per sport.
  if (kind === "sport" && !sport) return { errors: { sport: "Which sport is this board for?" } };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("boards")
    .insert({
    org_id: org.id,
    name,
    kind,
    sport,
    give_get_amount: centsToDecimalString(giveGetCents),
    min_seats: minSeats,
    max_seats: maxSeats,
    description: String(formData.get("description") ?? "").trim() || null,
    })
    .select("id")
    .single();
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/board-governance`);
  redirect(created?.id ? `/org/${slug}/board-governance/${created.id}` : `/org/${slug}/board-governance`);
}

export async function addBoardSeat(
  slug: string,
  boardId: string,
  _prevState: GovernanceActionState,
  formData: FormData
): Promise<GovernanceActionState> {
  const { org } = await requireGovernance(slug);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { errors: { name: "Who is taking the seat?" } };

  const status = String(formData.get("status") ?? "prospect");
  if (!["prospect", "active", "emeritus", "resigned"].includes(status)) return { errors: { status: "Pick a status." } };

  const supabase = await createClient();

  // RLS proves the SEAT belongs to this org, not that the board does.
  const { data: board } = await supabase
    .from("boards")
    .select("id, give_get_amount, max_seats")
    .eq("id", boardId)
    .eq("org_id", org.id)
    .maybeSingle();
  if (!board) return { errors: { form: "That board is not in this organization." } };

  const donorId = String(formData.get("donorId") ?? "").trim() || null;
  if (donorId) {
    const { data: donor } = await supabase.from("donors").select("id").eq("id", donorId).eq("org_id", org.id).maybeSingle();
    if (!donor) return { errors: { donorId: "That donor is not in this organization." } };
  }

  const b = board as { id: string; give_get_amount: number | string; max_seats: number };

  // Copied from the board rather than referenced, so changing the tier
  // later does not silently rewrite what a sitting member agreed to.
  const rawCommitment = String(formData.get("commitment") ?? "").trim();
  const commitmentCents = rawCommitment === "" ? toCents(b.give_get_amount) : toCents(rawCommitment);
  if (commitmentCents < 0) return { errors: { commitment: "A commitment cannot be negative." } };

  const termStart = String(formData.get("termStart") ?? "").trim() || null;
  const termEnd = String(formData.get("termEnd") ?? "").trim() || null;
  if (termStart && termEnd && termEnd < termStart) return { errors: { termEnd: "The term ends before it starts." } };

  // Only active seats count against the cap, matching how the board's
  // own summary counts them.
  if (status === "active") {
    const { count } = await supabase
      .from("board_members")
      .select("id", { count: "exact", head: true })
      .eq("board_id", boardId)
      .eq("org_id", org.id)
      .eq("status", "active");
    if ((count ?? 0) >= b.max_seats) {
      return { errors: { form: `That board is full at ${b.max_seats} active seats. Raise the cap or add this seat as a prospect.` } };
    }
  }

  const { error } = await supabase.from("board_members").insert({
    org_id: org.id,
    board_id: boardId,
    name,
    donor_id: donorId,
    role_title: String(formData.get("roleTitle") ?? "").trim() || null,
    status,
    term_start: termStart,
    term_end: termEnd,
    commitment_amount: centsToDecimalString(commitmentCents),
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/board-governance`);
  redirect(`/org/${slug}/board-governance/${boardId}`);
}


// Which sign-in a seat belongs to. A member's own Board version finds
// their seat by board_members.user_id, and until this existed nothing in
// the app could set it. Staff pick the person from the org's members
// (owner, staff or member; never a family login) or clear the link.
export async function linkSeatSignIn(slug: string, boardId: string, memberId: string, formData: FormData): Promise<void> {
  const { org } = await requireGovernance(slug);
  const back = `/org/${slug}/board-governance/${boardId}/seats/${memberId}`;
  const userId = String(formData.get("userId") ?? "").trim() || null;

  const supabase = await createClient();
  const { data: seat } = await supabase.from("board_members").select("id, name").eq("id", memberId).eq("board_id", boardId).eq("org_id", org.id).maybeSingle();
  if (!seat) redirect(`${back}?error=${encodeURIComponent("That seat is not in this organization.")}`);

  let personName: string | null = null;
  if (userId) {
    const { data: membership } = await supabase.from("org_members").select("user_id, role, users(email, full_name)").eq("org_id", org.id).eq("user_id", userId).maybeSingle();
    const m = membership as { role: string; users: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null } | null;
    if (!m || m.role === "family") redirect(`${back}?error=${encodeURIComponent("Pick someone who is a member of this organization. A family login cannot hold a seat.")}`);
    const person = Array.isArray(m.users) ? m.users[0] : m.users;
    personName = person?.full_name || person?.email || null;
    // One seat per sign-in, in this org: a person with two seats would
    // see one of them and wonder about the other.
    const { data: taken } = await supabase.from("board_members").select("id").eq("org_id", org.id).eq("user_id", userId).neq("id", memberId).maybeSingle();
    if (taken) redirect(`${back}?error=${encodeURIComponent(`${personName ?? "That person"} is already linked to another seat.`)}`);
  }

  const { error } = await supabase.from("board_members").update({ user_id: userId }).eq("id", memberId).eq("org_id", org.id);
  if (error) redirect(`${back}?error=${encodeURIComponent(`Could not change the sign-in: ${error.message}`)}`);

  revalidatePath(back);
  revalidatePath(`/org/${slug}/member`);
  redirect(`${back}?notice=${encodeURIComponent(userId ? `${personName ?? "They"} will see this seat as theirs when they sign in.` : "This seat is no longer linked to a sign-in.")}`);
}
