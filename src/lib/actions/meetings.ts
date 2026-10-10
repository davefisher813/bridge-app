"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { parseMeetingForm } from "@/lib/validation/meeting";

// Board meetings and their materials (migration 0050). Admins only, and
// only where the governance module is on, the same gate as the rest of
// Board Governance. Materials are documents already in the vault, linked
// and never copied; removing a meeting or a link never touches a document.

export interface MeetingActionState {
  errors: Record<string, string>;
}

async function requireGovernance(slug: string) {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  if (!org.modules.board_governance) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);
  return { org, user };
}

const q = (s: string) => encodeURIComponent(s);
const base = (slug: string) => `/org/${slug}/board-governance/meetings`;

// A board the form names must be one of this org's. The database checks
// it too (a trigger in 0050); this answers with a sentence instead.
async function boardIsOurs(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, boardId: string | null): Promise<boolean> {
  if (!boardId) return true;
  const { data } = await supabase.from("boards").select("id").eq("id", boardId).eq("org_id", orgId).maybeSingle();
  return !!data;
}

export async function createMeeting(slug: string, _prev: MeetingActionState, formData: FormData): Promise<MeetingActionState> {
  const { org, user } = await requireGovernance(slug);
  const parsed = parseMeetingForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };
  const supabase = await createClient();
  if (!(await boardIsOurs(supabase, org.id, parsed.row.board_id))) return { errors: { boardId: "Pick a board from the list." } };

  const { data, error } = await supabase.from("board_meetings").insert({ org_id: org.id, created_by: user.id, ...parsed.row }).select("id").single();
  if (error || !data) return { errors: { form: `The meeting could not be saved: ${error?.message ?? "no row came back"}` } };
  revalidatePath(base(slug));
  revalidatePath(`/org/${slug}/board-governance`);
  redirect(`${base(slug)}/${(data as { id: string }).id}`);
}

export async function updateMeeting(slug: string, meetingId: string, _prev: MeetingActionState, formData: FormData): Promise<MeetingActionState> {
  const { org } = await requireGovernance(slug);
  const parsed = parseMeetingForm(formData);
  if ("errors" in parsed) return { errors: parsed.errors };
  const supabase = await createClient();
  if (!(await boardIsOurs(supabase, org.id, parsed.row.board_id))) return { errors: { boardId: "Pick a board from the list." } };

  const { data, error } = await supabase
    .from("board_meetings")
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq("id", meetingId)
    .eq("org_id", org.id)
    .select("id");
  if (error) return { errors: { form: `The meeting could not be saved: ${error.message}` } };
  if (!data || (data as unknown[]).length === 0) return { errors: { form: "That meeting is not in this organization." } };
  revalidatePath(base(slug));
  revalidatePath(`${base(slug)}/${meetingId}`);
  redirect(`${base(slug)}/${meetingId}?notice=${q("Meeting saved.")}`);
}

// Removes the meeting and its list of materials. The documents stay in
// Documents, untouched.
export async function removeMeeting(slug: string, meetingId: string): Promise<void> {
  const { org } = await requireGovernance(slug);
  const supabase = await createClient();
  const { data: found } = await supabase.from("board_meetings").select("id").eq("id", meetingId).eq("org_id", org.id).maybeSingle();
  if (!found) redirect(`${base(slug)}?error=${q("That meeting is already gone.")}`);
  const { error } = await supabase.from("board_meetings").delete().eq("id", meetingId).eq("org_id", org.id);
  if (error) redirect(`${base(slug)}/${meetingId}?error=${q(`The meeting could not be removed: ${error.message}`)}`);
  revalidatePath(base(slug));
  revalidatePath(`/org/${slug}/board-governance`);
  redirect(`${base(slug)}?notice=${q("Meeting removed. Its documents are still in Documents.")}`);
}

export async function attachMeetingDocument(slug: string, meetingId: string, formData: FormData): Promise<void> {
  const { org, user } = await requireGovernance(slug);
  const back = `${base(slug)}/${meetingId}`;
  const documentId = String(formData.get("documentId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(documentId)) redirect(`${back}?error=${q("Pick a document from the list.")}`);

  const supabase = await createClient();
  const [{ data: meeting }, { data: doc }] = await Promise.all([
    supabase.from("board_meetings").select("id").eq("id", meetingId).eq("org_id", org.id).maybeSingle(),
    supabase.from("documents").select("id, lifecycle").eq("id", documentId).eq("org_id", org.id).maybeSingle(),
  ]);
  if (!meeting) redirect(`${base(slug)}?error=${q("That meeting is already gone.")}`);
  if (!doc) redirect(`${back}?error=${q("That document is not in this organization.")}`);

  const { data: existing } = await supabase.from("board_meeting_documents").select("document_id").eq("meeting_id", meetingId).eq("document_id", documentId).eq("org_id", org.id).maybeSingle();
  if (existing) redirect(`${back}?notice=${q("That document is already on this meeting.")}`);

  const { error } = await supabase.from("board_meeting_documents").insert({ meeting_id: meetingId, document_id: documentId, org_id: org.id, added_by: user.id });
  if (error) redirect(`${back}?error=${q(`The document could not be added: ${error.message}`)}`);
  revalidatePath(back);
  redirect(`${back}?notice=${q("Added to the meeting.")}`);
}

// Takes a document off a meeting's list. The document itself stays.
export async function detachMeetingDocument(slug: string, meetingId: string, documentId: string): Promise<void> {
  const { org } = await requireGovernance(slug);
  const back = `${base(slug)}/${meetingId}`;
  const supabase = await createClient();
  const { error } = await supabase.from("board_meeting_documents").delete().eq("meeting_id", meetingId).eq("document_id", documentId).eq("org_id", org.id);
  if (error) redirect(`${back}?error=${q(`The document could not be taken off: ${error.message}`)}`);
  revalidatePath(back);
  redirect(`${back}?notice=${q("Taken off the meeting. It is still in Documents.")}`);
}
