// Staff notes on an athlete (migration 0040, athlete_notes). A dated log,
// not one editable blob: each note is added once, filed under the step it
// was typed on, and can be deleted by staff but never edited.
//
// Staff only. Row level security admits owner and staff of the athlete's
// org and nobody else, and no family or member page names this table
// (src/laws/autofillLaws.test.ts). The callers here are server actions
// that have already checked the caller is owner or staff and that the
// athlete belongs to the org; the org_id and athlete_id filters below
// are on top of that, not instead of it.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type AthleteNoteContext = "general" | "enrolled" | "graduated" | "drafted" | "reopened";

export const NOTE_CONTEXT_LABEL: Record<AthleteNoteContext, string> = {
  general: "Note",
  enrolled: "Marked Enrolled",
  graduated: "Marked Graduated",
  drafted: "Marked Drafted",
  reopened: "Reopened Recruiting",
};

export const NOTE_MAX_LENGTH = 4000;

export interface AthleteNote {
  id: string;
  context: AthleteNoteContext;
  body: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
}

// Files a note, or does nothing when the body is blank: every form that
// offers a note leaves it optional. Returns an error to show, or null.
export async function addAthleteNote(
  supabase: Client,
  note: { orgId: string; athleteId: string; authorId: string; context?: AthleteNoteContext; body: string | null | undefined },
): Promise<string | null> {
  const body = (note.body ?? "").trim();
  if (!body) return null;
  if (body.length > NOTE_MAX_LENGTH) return `A note is ${NOTE_MAX_LENGTH} characters or fewer.`;
  const { error } = await supabase.from("athlete_notes").insert({
    org_id: note.orgId,
    athlete_id: note.athleteId,
    author_id: note.authorId,
    context: note.context ?? "general",
    body,
  });
  return error ? "The note could not be saved." : null;
}

// An athlete's notes, newest first, with who wrote each. Every note, by
// default: a note past a cut-off could be neither read nor deleted
// anywhere, since the athlete page is the only screen that lists them.
export async function loadAthleteNotes(supabase: Client, orgId: string, athleteId: string, limit?: number): Promise<AthleteNote[]> {
  const query = supabase
    .from("athlete_notes")
    .select("id, context, body, created_at, author_id")
    .eq("org_id", orgId)
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: false });
  const { data } = limit ? await query.limit(limit) : await query;
  const rows = (data ?? []) as { id: string; context: AthleteNoteContext; body: string; created_at: string; author_id: string | null }[];

  const authorIds = [...new Set(rows.map((r) => r.author_id).filter((id): id is string => !!id))];
  const { data: people } = authorIds.length ? await supabase.from("users").select("id, full_name, email").in("id", authorIds) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, p.full_name?.trim() || p.email?.trim() || null]));

  return rows.map((r) => ({
    id: r.id,
    context: r.context,
    body: r.body,
    createdAt: r.created_at,
    authorId: r.author_id,
    authorName: r.author_id ? (nameOf.get(r.author_id) ?? null) : null,
  }));
}

// Removes one note, scoped to the org and the athlete so an id from
// another org or another athlete deletes nothing. Returns an error to
// show, or null.
export async function deleteAthleteNote(supabase: Client, note: { orgId: string; athleteId: string; noteId: string }): Promise<string | null> {
  const { error } = await supabase.from("athlete_notes").delete().eq("id", note.noteId).eq("org_id", note.orgId).eq("athlete_id", note.athleteId);
  return error ? "The note could not be deleted." : null;
}
