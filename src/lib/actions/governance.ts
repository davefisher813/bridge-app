"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { centsToDecimalString } from "@/lib/validation/gift";
import { toCents } from "@/lib/fundraising/rollup";
import { BOARD_KINDS, DEFAULT_GIVE_GET_CENTS, DEFAULT_SEATS, type BoardKind } from "@/lib/governance/giveGet";
import { requireNotViewing } from "@/lib/data/viewAs";

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

// The board fields, shared by create and edit. Returns the row to write
// or the field errors.
type BoardFields = { name: string; kind: BoardKind; sport: string | null; give_get_amount: string; min_seats: number; max_seats: number; description: string | null };

function readBoardForm(formData: FormData): { row: BoardFields } | { errors: Record<string, string> } {
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
  if (minSeats < 0 || !Number.isInteger(minSeats)) return { errors: { minSeats: "A whole number, zero or more." } };
  if (!Number.isInteger(maxSeats)) return { errors: { maxSeats: "A whole number." } };
  if (maxSeats < minSeats) return { errors: { maxSeats: "The maximum cannot be below the minimum." } };

  const sport = String(formData.get("sport") ?? "").trim() || null;
  // A sport board without a sport is the one case where the tier itself
  // makes a field required, since the whole point of the tier is that
  // there is one per sport.
  if (kind === "sport" && !sport) return { errors: { sport: "Which sport is this board for?" } };

  return {
    row: {
      name,
      kind: kind as BoardKind,
      sport: kind === "sport" ? sport : null,
      give_get_amount: centsToDecimalString(giveGetCents),
      min_seats: minSeats,
      max_seats: maxSeats,
      description: String(formData.get("description") ?? "").trim() || null,
    },
  };
}

export async function createBoard(
  slug: string,
  _prevState: GovernanceActionState,
  formData: FormData
): Promise<GovernanceActionState> {
  await requireNotViewing();
  const { org } = await requireGovernance(slug);

  const parsed = readBoardForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("boards")
    .insert({ org_id: org.id, ...parsed.row })
    .select("id")
    .single();
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/board-governance`);
  redirect(created?.id ? `/org/${slug}/board-governance/${created.id}` : `/org/${slug}/board-governance`);
}

// Edit a board (audit crud F11): name, tier, sport, the give/get for new
// seats, the seat range and the description. A sitting member's own
// commitment is copied onto their seat and does not move with this.
export async function updateBoard(slug: string, boardId: string, _prevState: GovernanceActionState, formData: FormData): Promise<GovernanceActionState> {
  await requireNotViewing();
  const { org } = await requireGovernance(slug);

  const parsed = readBoardForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq("id", boardId)
    .eq("org_id", org.id)
    .select("id");
  if (error) return { errors: { form: error.message } };
  if (!data || data.length === 0) return { errors: { form: "That board is not in this organization." } };

  revalidatePath(`/org/${slug}/board-governance`);
  revalidatePath(`/org/${slug}/board-governance/${boardId}`);
  redirect(`/org/${slug}/board-governance/${boardId}?notice=${encodeURIComponent("Board saved.")}`);
}

// Remove a board. Refused while it has seats: a board's seats cascade
// with it, and a seat carries give/get history a chair still reports
// on. Remove or move the seats first, then the board.
export async function removeBoard(slug: string, boardId: string): Promise<void> {
  await requireNotViewing();
  const { org } = await requireGovernance(slug);
  const back = `/org/${slug}/board-governance/${boardId}`;

  const supabase = await createClient();
  const { data: board } = await supabase.from("boards").select("id, name").eq("id", boardId).eq("org_id", org.id).maybeSingle();
  if (!board) redirect(`/org/${slug}/board-governance?error=${encodeURIComponent("That board is already gone.")}`);

  const { data: seats } = await supabase.from("board_members").select("id").eq("board_id", boardId).eq("org_id", org.id);
  const n = (seats ?? []).length;
  if (n > 0) redirect(`${back}?error=${encodeURIComponent(`This board still has ${n} ${n === 1 ? "seat" : "seats"}. Remove them first.`)}`);

  const { error } = await supabase.from("boards").delete().eq("id", boardId).eq("org_id", org.id);
  if (error) redirect(`${back}?error=${encodeURIComponent(`Could not remove the board: ${error.message}`)}`);

  revalidatePath(`/org/${slug}/board-governance`);
  redirect(`/org/${slug}/board-governance?notice=${encodeURIComponent(`${(board as { name: string }).name} removed.`)}`);
}

// The seat fields, shared by add and edit, with every check addBoardSeat
// always made: the status enum, the board and the donor belonging to this
// org, the term order, and the active-seat cap, counted without the seat
// being edited. Picking a donor fills the name, email and phone when
// they were left blank (Stage 4, B8), here as well as on the form, so a
// post without the client script gets the same answer.
type SeatFields = {
  name: string;
  donor_id: string | null;
  role_title: string | null;
  status: string;
  term_start: string | null;
  term_end: string | null;
  commitment_amount: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

async function readSeatForm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  boardId: string,
  formData: FormData,
  editingSeatId: string | null,
): Promise<{ row: SeatFields } | { errors: Record<string, string> }> {
  const status = String(formData.get("status") ?? "prospect");
  if (!["prospect", "active", "emeritus", "resigned"].includes(status)) return { errors: { status: "Pick a status." } };

  // RLS proves the SEAT belongs to this org, not that the board does.
  const { data: board } = await supabase.from("boards").select("id, give_get_amount, max_seats").eq("id", boardId).eq("org_id", orgId).maybeSingle();
  if (!board) return { errors: { form: "That board is not in this organization." } };
  const b = board as { id: string; give_get_amount: number | string; max_seats: number };

  const donorId = String(formData.get("donorId") ?? "").trim() || null;
  let donor: { name: string; email: string | null; phone: string | null } | null = null;
  if (donorId) {
    const { data } = await supabase.from("donors").select("id, name, email, phone").eq("id", donorId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
    if (!data) return { errors: { donorId: "That donor is not in this organization." } };
    donor = data as { name: string; email: string | null; phone: string | null };
  }

  const typed = (field: string) => String(formData.get(field) ?? "").trim() || null;
  const name = typed("name") ?? donor?.name ?? null;
  if (!name) return { errors: { name: "Who is taking the seat?" } };

  // Copied from the board rather than referenced, so changing the tier
  // later does not silently rewrite what a sitting member agreed to.
  const rawCommitment = String(formData.get("commitment") ?? "").trim();
  const commitmentCents = rawCommitment === "" ? toCents(b.give_get_amount) : toCents(rawCommitment);
  if (commitmentCents < 0) return { errors: { commitment: "A commitment cannot be negative." } };

  const termStart = typed("termStart");
  const termEnd = typed("termEnd");
  if (termStart && termEnd && termEnd < termStart) return { errors: { termEnd: "The term ends before it starts." } };

  // Only active seats count against the cap, matching how the board's
  // own summary counts them. An edit does not count itself.
  if (status === "active") {
    const { data: active } = await supabase.from("board_members").select("id").eq("board_id", boardId).eq("org_id", orgId).eq("status", "active");
    const others = ((active ?? []) as { id: string }[]).filter((r) => r.id !== editingSeatId).length;
    if (others >= b.max_seats) {
      return { errors: { form: `That board is full at ${b.max_seats} active seats. Raise the cap or keep this seat as a prospect.` } };
    }
  }

  return {
    row: {
      name,
      donor_id: donorId,
      role_title: typed("roleTitle"),
      status,
      term_start: termStart,
      term_end: termEnd,
      commitment_amount: centsToDecimalString(commitmentCents),
      email: typed("email") ?? donor?.email ?? null,
      phone: typed("phone") ?? donor?.phone ?? null,
      notes: typed("notes"),
    },
  };
}

export async function addBoardSeat(
  slug: string,
  boardId: string,
  _prevState: GovernanceActionState,
  formData: FormData
): Promise<GovernanceActionState> {
  await requireNotViewing();
  const { org } = await requireGovernance(slug);

  const supabase = await createClient();
  const parsed = await readSeatForm(supabase, org.id, boardId, formData, null);
  if ("errors" in parsed) return { errors: parsed.errors };

  const { error } = await supabase.from("board_members").insert({ org_id: org.id, board_id: boardId, ...parsed.row });
  if (error) return { errors: { form: error.message } };

  revalidatePath(`/org/${slug}/board-governance`);
  redirect(`/org/${slug}/board-governance/${boardId}`);
}

// Edit a seat (audit crud F11): name, role, status, term, commitment,
// donor record and contact details. Ending a seat is a status change to
// Emeritus or Resigned, which keeps its history; Remove is for a seat
// that should never have existed.
export async function updateBoardSeat(slug: string, boardId: string, memberId: string, _prevState: GovernanceActionState, formData: FormData): Promise<GovernanceActionState> {
  await requireNotViewing();
  const { org } = await requireGovernance(slug);

  const supabase = await createClient();
  const parsed = await readSeatForm(supabase, org.id, boardId, formData, memberId);
  if ("errors" in parsed) return { errors: parsed.errors };

  const { data, error } = await supabase
    .from("board_members")
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("board_id", boardId)
    .eq("org_id", org.id)
    .select("id");
  if (error) return { errors: { form: error.message } };
  if (!data || data.length === 0) return { errors: { form: "That seat is not on this board." } };

  revalidatePath(`/org/${slug}/board-governance`);
  revalidatePath(`/org/${slug}/board-governance/${boardId}`);
  revalidatePath(`/org/${slug}/member`);
  redirect(`/org/${slug}/board-governance/${boardId}/seats/${memberId}?notice=${encodeURIComponent("Seat saved.")}`);
}

// Remove a seat. Gifts credited to it as brought in lose that credit
// (the column is set null), which the confirm says before it happens.
export async function removeBoardSeat(slug: string, boardId: string, memberId: string): Promise<void> {
  await requireNotViewing();
  const { org } = await requireGovernance(slug);

  const supabase = await createClient();
  const back = `/org/${slug}/board-governance/${boardId}`;
  const { data: seat } = await supabase.from("board_members").select("id").eq("id", memberId).eq("board_id", boardId).eq("org_id", org.id).maybeSingle();
  if (!seat) redirect(`${back}?error=${encodeURIComponent("That seat is already gone.")}`);
  const { error } = await supabase.from("board_members").delete().eq("id", memberId).eq("board_id", boardId).eq("org_id", org.id);
  if (error) redirect(`${back}/seats/${memberId}?error=${encodeURIComponent(`Could not remove the seat: ${error.message}`)}`);

  revalidatePath(`/org/${slug}/board-governance`);
  revalidatePath(back);
  revalidatePath(`/org/${slug}/member`);
  redirect(`${back}?notice=${encodeURIComponent("Seat removed.")}`);
}

// Which sign-in a seat belongs to. A member's own Board version finds
// their seat by board_members.user_id, and until this existed nothing in
// the app could set it. Staff pick the person from the org's members
// (owner, staff or member; never a family login) or clear the link.
export async function linkSeatSignIn(slug: string, boardId: string, memberId: string, formData: FormData): Promise<void> {
  await requireNotViewing();
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
    if (!m || m.role === "family") redirect(`${back}?error=${encodeURIComponent("Pick someone who is a member of this organization. An athlete login cannot hold a seat.")}`);
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
