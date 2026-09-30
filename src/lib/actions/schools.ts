"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDirectoryEditor, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CSV_OWNED_KEYS, mergeOwned, parseSchoolForm, schoolColumnsFrom } from "@/lib/validation/school";
import { escapeIlike, nameKey } from "@/lib/lookup/nameKey";
import { loadCoachOptions, matchCoach } from "@/lib/data/lookups";
import { parseOrgSchoolNoteForm, parsePositionsOfNeed, type PositionOfNeed } from "@/lib/validation/orgSchoolNote";
import { TARGET_STATUSES } from "@/lib/validation/target";
import { parseSchoolsCsv, type ImportProblem } from "@/lib/schools/csv";
import { recomputeFitsForOrgSchool, recomputeFitsForSchools } from "@/lib/data/fits";
import { requireNotViewing } from "@/lib/data/viewAs";

export interface SchoolActionState {
  errors: Record<string, string>;
  // Set when the name is already on file: the form links to that school
  // instead of adding a second row for it.
  duplicateOf?: { id: string; name: string };
}

// Any school already on file under the same name, ignoring case and
// outer spaces (the key Postgres and the eligibility loader use). The
// ilike is escaped so a % or _ in a name is literal, then only an exact
// key match counts. `exceptId` is the school being edited.
async function schoolNamed(name: string, exceptId?: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("schools").select("id, name").ilike("name", escapeIlike(name.trim())).limit(20);
  const key = nameKey(name);
  const hit = ((data ?? []) as { id: string; name: string }[]).find((r) => nameKey(r.name) === key && r.id !== exceptId);
  return hit ?? null;
}

function duplicateState(hit: { id: string; name: string }): SchoolActionState {
  return { errors: { name: `${hit.name} is already on file. Open it and edit that one instead.` }, duplicateOf: hit };
}

// schools is shared reference data across every org (see the RLS comment
// in migrations/0001_core_schema.sql and docs/ARCHITECTURE.md) and has no
// INSERT policy at all - deliberately, so no org can silently corrupt
// another org's shared list through ordinary RLS-scoped writes. Rather
// than reopen that policy, these actions are the one deliberate door
// into it: requireDirectoryEditor() is the actual authorization check
// (RLS can't help here, since the admin client bypasses it entirely),
// then the write goes through the service-role client. It admits an
// owner of an org whose orgs.edits_shared_directory is on (migration
// 0040), never merely an owner: an owner of any other org, staff, a
// member or a family login is refused before the admin client is ever
// touched. See docs/DECISIONS.md. Every write recomputes the stored fits for every
// athlete in every org against the school (docs/MATCHING_CONTRACT.md).
export async function createSchool(slug: string, _prevState: SchoolActionState, formData: FormData): Promise<SchoolActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const parsed = parseSchoolForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  // One row per school: the directory is shared by every org, and a
  // second copy of a school splits its targets, notes and coaches
  // across two rows (Stage 4, B3). No unique index backs this, since
  // production may already hold duplicates; Merge on the edit screen
  // is how an existing pair becomes one.
  const duplicate = await schoolNamed(parsed.values.name);
  if (duplicate) return duplicateState(duplicate);

  const admin = createAdminClient();
  const { data: created, error } = await admin.from("schools").insert(schoolColumnsFrom(parsed.values)).select("id").single();
  if (error) return { errors: { form: error.message } };

  if (created?.id) await recomputeFitsForSchools(admin, [created.id]);

  revalidatePath(`/org/${slug}/schools`);
  revalidatePath(`/org/${slug}/board/new`);
  redirect(created?.id ? `/org/${slug}/schools/${created.id}` : `/org/${slug}/schools`);
}

export async function updateSchool(slug: string, schoolId: string, _prevState: SchoolActionState, formData: FormData): Promise<SchoolActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const parsed = parseSchoolForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const duplicate = await schoolNamed(parsed.values.name, schoolId);
  if (duplicate) return duplicateState(duplicate);

  // The row as it stands, so a save keeps every jsonb key the form does
  // not own (crud F4): academics.majorAvailability and the like.
  const admin = createAdminClient();
  const { data: current } = await admin.from("schools").select("id, academics, financials, athletics").eq("id", schoolId).maybeSingle();
  if (!current) return { errors: { form: "That school is no longer on file." } };
  const { error } = await admin.from("schools").update(schoolColumnsFrom(parsed.values, current as { academics: unknown; financials: unknown; athletics: unknown })).eq("id", schoolId);
  if (error) return { errors: { form: error.message } };

  await recomputeFitsForSchools(admin, [schoolId]);

  revalidatePath(`/org/${slug}/schools`);
  revalidatePath(`/org/${slug}/schools/${schoolId}`);
  revalidatePath(`/org/${slug}/board`);
  redirect(`/org/${slug}/schools/${schoolId}`);
}

// The org's private overlay on a shared school. Staff can write it
// (org_school_notes RLS), and it recomputes this org's fits against the
// school because positions of need move the score.
export async function saveOrgSchoolNote(slug: string, schoolId: string, _prevState: SchoolActionState, formData: FormData): Promise<SchoolActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseOrgSchoolNoteForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const supabase = await createClient();

  // A head coach picked from the school's directory listing brings the
  // listed email when the field was left blank. A typed email always
  // wins, and a name matching nobody (or two people) fills nothing.
  let coachEmail = parsed.values.coachEmail ?? null;
  if (!coachEmail && parsed.values.coachName) {
    const options = await loadCoachOptions(supabase, [schoolId]);
    coachEmail = matchCoach(options[schoolId], parsed.values.coachName)?.email ?? null;
  }

  const { error } = await supabase.from("org_school_notes").upsert(
    {
      org_id: org.id,
      school_id: schoolId,
      coach_name: parsed.values.coachName ?? null,
      coach_email: coachEmail,
      positions_of_need: parsePositionsOfNeed(parsed.values.positionsOfNeed),
      notes: parsed.values.notes ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,school_id" },
  );
  if (error) return { errors: { form: error.message } };

  await recomputeFitsForOrgSchool(supabase, org.id, schoolId);

  revalidatePath(`/org/${slug}/schools/${schoolId}`);
  revalidatePath(`/org/${slug}/board`);
  redirect(`/org/${slug}/schools/${schoolId}`);
}

export interface ImportActionState {
  errors: Record<string, string>;
  problems: ImportProblem[];
  imported?: number;
}

// The CSV import. docs/MATCHING_CONTRACT.md section 4: rows with
// problems are listed and nothing half-imports. An existing school with
// the same name is updated, not duplicated; the coach fields land on
// this org's overlay, not the shared row.
export async function importSchools(slug: string, _prevState: ImportActionState, formData: FormData): Promise<ImportActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const file = formData.get("file");
  if (!file || typeof file === "string" || file.size === 0) return { errors: { file: "Choose a CSV file first." }, problems: [] };
  const text = await file.text();
  const { rows, problems } = parseSchoolsCsv(text);
  if (problems.length > 0 || rows.length === 0) {
    return { errors: rows.length === 0 && problems.length === 0 ? { file: "The file has no school rows." } : {}, problems };
  }

  const admin = createAdminClient();
  // Matched on the name key (trimmed, any case), not the exact
  // spelling: "Fixture State University " in a sheet is the school on
  // file, and an exact-name lookup would have added a second row.
  const { data: existingRows } = await admin.from("schools").select("id, name, academics, financials, athletics");
  const existingByName = new Map<string, { id: string; academics: unknown; financials: unknown; athletics: unknown }>();
  for (const e of (existingRows ?? []) as { id: string; name: string; academics: unknown; financials: unknown; athletics: unknown }[]) {
    const k = nameKey(e.name);
    if (!existingByName.has(k)) existingByName.set(k, e);
  }

  const ids: string[] = [];
  for (const r of rows) {
    const s = r.school;
    const columns = {
      name: s.name,
      division: s.division,
      program_tier: s.program_tier,
      conference: s.conference,
      state: s.state,
      sports_sponsored: s.sports_sponsored,
      majors: s.majors,
      academics: s.academics,
      financials: s.financials,
      athletics: s.athletics,
      profile_date: new Date().toISOString(),
    };
    const existing = existingByName.get(nameKey(s.name));
    const existingId = existing?.id;
    let id = existingId;
    if (existing && existingId) {
      // An update keeps the jsonb keys the sheet does not carry, the
      // same rule as the edit form (crud F4).
      // The name on file keeps its spelling: the sheet matched it by key.
      const merged: Record<string, unknown> = {
        ...columns,
        academics: mergeOwned(existing.academics, CSV_OWNED_KEYS.academics, s.academics),
        financials: mergeOwned(existing.financials, CSV_OWNED_KEYS.financials, s.financials),
        athletics: mergeOwned(existing.athletics, CSV_OWNED_KEYS.athletics, s.athletics),
      };
      delete merged.name;
      const { error } = await admin.from("schools").update(merged).eq("id", existingId);
      if (error) return { errors: { form: error.message }, problems: [] };
    } else {
      const { data: created, error } = await admin.from("schools").insert(columns).select("id").single();
      if (error) return { errors: { form: error.message }, problems: [] };
      id = created?.id;
      // A sheet naming the same school twice updates the row it just
      // added rather than adding a second.
      if (id) existingByName.set(nameKey(s.name), { id, academics: s.academics, financials: s.financials, athletics: s.athletics });
    }
    if (!id) continue;
    ids.push(id);
    const { error: noteError } = await admin.from("org_school_notes").upsert(
      {
        org_id: org.id,
        school_id: id,
        coach_name: r.overlay.coach_name || null,
        coach_email: r.overlay.coach_email || null,
        positions_of_need: r.overlay.positions_of_need,
        notes: r.overlay.notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,school_id" },
    );
    if (noteError) return { errors: { form: noteError.message }, problems: [] };
  }

  await recomputeFitsForSchools(admin, ids);

  revalidatePath(`/org/${slug}/schools`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/schools?imported=${ids.length}`);
}

// ── Removing and merging a shared school (crud F3) ─────────────────────
// Both behind requireDirectoryEditor through the service role, the same
// door as creating and editing one. What points at a school is counted across EVERY org,
// not just the caller's: the row is shared, and another org's target or
// private notes on it are theirs, invisible to this owner under RLS.

async function schoolReferences(admin: ReturnType<typeof createAdminClient>, schoolId: string): Promise<string[]> {
  const [{ data: targets }, { data: notes }, { data: coaches }, { data: contacts }] = await Promise.all([
    admin.from("recruiting_targets").select("id").eq("school_id", schoolId),
    admin.from("org_school_notes").select("id").eq("school_id", schoolId),
    admin.from("college_coaches").select("id").eq("school_id", schoolId),
    admin.from("contacts").select("id").eq("school_id", schoolId),
  ]);
  const n = (rows: unknown) => (Array.isArray(rows) ? rows.length : 0);
  const say = (count: number, one: string, many: string) => (count === 0 ? null : `${count} ${count === 1 ? one : many}`);
  return [
    say(n(targets), "target", "targets"),
    say(n(notes), "organization's notes", "organizations' notes"),
    say(n(coaches), "coach", "coaches"),
    say(n(contacts), "contact", "contacts"),
  ].filter((x): x is string => x !== null);
}

function revalidateSchools(slug: string, ...ids: string[]) {
  revalidatePath(`/org/${slug}/schools`);
  for (const id of ids) revalidatePath(`/org/${slug}/schools/${id}`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}`);
}

// Refused while anything in any org points at the school: a target, an
// org's notes, a directory coach or a contact. Merge is the tool for a
// duplicate that is in use; this is for a row nobody relies on.
export async function deleteSchool(slug: string, schoolId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const admin = createAdminClient();
  const { data: school } = await admin.from("schools").select("id, name").eq("id", schoolId).maybeSingle();
  if (!school) redirect(`/org/${slug}/schools`);

  const refs = await schoolReferences(admin, schoolId);
  if (refs.length > 0) {
    const why = `${(school as { name: string }).name} is still in use: ${refs.join(", ")}. Merge it into the right school instead.`;
    redirect(`/org/${slug}/schools/${schoolId}/edit?error=${encodeURIComponent(why)}`);
  }

  // Stored matches are derived from the school and go with it (the
  // foreign key cascades; deleted first so the intent is explicit).
  await admin.from("athlete_school_fits").delete().eq("school_id", schoolId);
  const { error } = await admin.from("schools").delete().eq("id", schoolId);
  if (error) redirect(`/org/${slug}/schools/${schoolId}/edit?error=${encodeURIComponent(error.message)}`);

  // A transfer's Current School keeps its typed name but no longer
  // points at a row that is gone.
  const { data: transfers } = await admin.from("athletes").select("id, detail").neq("recruit_type", "hs");
  for (const a of (transfers ?? []) as { id: string; detail: Record<string, unknown> | null }[]) {
    if (a.detail?.currentSchoolId !== schoolId) continue;
    const { currentSchoolId: _gone, ...rest } = a.detail;
    void _gone;
    await admin.from("athletes").update({ detail: rest }).eq("id", a.id);
  }

  revalidateSchools(slug, schoolId);
  redirect(`/org/${slug}/schools?notice=${encodeURIComponent(`${(school as { name: string }).name} removed.`)}`);
}

interface TargetRef {
  id: string;
  org_id: string;
  athlete_id: string;
  status: string;
  closed_from: string | null;
  coach_name: string | null;
  aid: unknown;
  notes: string | null;
  offer_type: string | null;
  offer_scholarship_percent: number | null;
  visit_date: string | null;
}

const REFS_TARGET = "id, org_id, athlete_id, status, closed_from, coach_name, aid, notes, offer_type, offer_scholarship_percent, visit_date";

// How far along a target is, on the board's own order (TARGET_STATUSES:
// Target, In Contact, Visit, Offer, Committed). Not Interested is a
// closed door, so it ranks below every open stage rather than after
// Committed where the list happens to put it. An unknown status ranks
// with it.
function stageRank(status: string): number {
  if (status === "Not Interested") return -1;
  return (TARGET_STATUSES as readonly string[]).indexOf(status);
}

// "Merged from <name>." and the text it carried, under what was there.
function appendMerged(kept: string | null, sourceName: string, carried: string[]): string | null {
  const lines = carried.map((c) => c.trim()).filter(Boolean);
  if (lines.length === 0) return kept;
  const block = [`Merged from ${sourceName}.`, ...lines].join("\n");
  return kept?.trim() ? `${kept}\n\n${block}` : block;
}

function offerLine(t: Pick<TargetRef, "offer_type" | "offer_scholarship_percent">): string | null {
  if (!t.offer_type) return null;
  const kind = t.offer_type.replace(/_/g, " ");
  return t.offer_scholarship_percent != null ? `Offer: ${kind}, ${t.offer_scholarship_percent}% scholarship.` : `Offer: ${kind}.`;
}

function samePosition(a: PositionOfNeed, b: PositionOfNeed): boolean {
  return a.position.trim().toUpperCase() === b.position.trim().toUpperCase() && (a.gradYear ?? null) === (b.gradYear ?? null);
}

interface NoteRef {
  id: string;
  org_id: string;
  coach_name: string | null;
  coach_email: string | null;
  positions_of_need: PositionOfNeed[] | null;
  notes: string | null;
}

// Two rows for one school become one. Everything that pointed at the
// source moves to the kept school, in every org, then the source is
// deleted and every stored match against the kept school recomputed.
//
// - A target moves. When the athlete already has a target at the kept
//   school (one per athlete per school), the kept target stays and takes
//   the source's contact log and visits, the more advanced stage of the
//   two (Committed always wins), its coach, award and visit date when it
//   had none, and the source's notes and offer appended under "Merged
//   from <source name>." when it had its own; the source target is then
//   removed. Nothing either org typed is dropped.
// - An org's notes move when that org has none on the kept school. When
//   it has both, the source's text is appended to the kept row under
//   "Merged from <source name>.", its positions of need join the kept
//   list without repeats, and its coach fills a blank one. Another org's
//   notes are never deleted.
// - A directory coach moves unless the kept school already lists
//   someone by that name.
// - Contacts and a transfer's Current School follow the kept school.
export async function mergeSchool(slug: string, sourceId: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const back = (message: string) => redirect(`/org/${slug}/schools/${sourceId}/edit?error=${encodeURIComponent(message)}`);
  const targetId = String(formData.get("mergeInto") ?? "").trim();
  if (!targetId) back("Pick the school to keep.");
  if (targetId === sourceId) back("A school cannot be merged into itself.");

  const admin = createAdminClient();
  const [{ data: sourceRow }, { data: keptRow }] = await Promise.all([
    admin.from("schools").select("id, name").eq("id", sourceId).maybeSingle(),
    admin.from("schools").select("id, name").eq("id", targetId).maybeSingle(),
  ]);
  const source = sourceRow as { id: string; name: string } | null;
  const kept = keptRow as { id: string; name: string } | null;
  if (!source) redirect(`/org/${slug}/schools`);
  if (!kept) back("The school to keep is no longer on file.");
  const keep = kept as { id: string; name: string };

  // Targets.
  const [{ data: movingRows }, { data: keptTargetRows }] = await Promise.all([
    admin.from("recruiting_targets").select(REFS_TARGET).eq("school_id", source.id),
    admin.from("recruiting_targets").select(REFS_TARGET).eq("school_id", keep.id),
  ]);
  const keptByAthlete = new Map(((keptTargetRows ?? []) as TargetRef[]).map((t) => [t.athlete_id, t]));
  for (const t of (movingRows ?? []) as TargetRef[]) {
    const clash = keptByAthlete.get(t.athlete_id);
    if (!clash) {
      const { error } = await admin.from("recruiting_targets").update({ school_id: keep.id, updated_at: new Date().toISOString() }).eq("id", t.id);
      if (error) back(error.message);
      continue;
    }
    // The source target is deleted below and its log and visits cascade
    // with it, so every move has to land first.
    const { error: commError } = await admin.from("target_communications").update({ target_id: clash.id }).eq("target_id", t.id).eq("org_id", t.org_id);
    if (commError) back(commError.message);
    const { error: visitError } = await admin.from("target_visits").update({ target_id: clash.id }).eq("target_id", t.id).eq("org_id", t.org_id);
    if (visitError) back(visitError.message);
    const carry: Record<string, unknown> = { updated_at: new Date().toISOString() };
    // The more advanced stage of the two stands. A commitment carried
    // over is live again: the kept target may be the one that commitment
    // closed out, and a stale closed_from would let a later reopen treat
    // it as closed by a close-out. Any other stage carried over brings
    // its own closed_from with it.
    if (t.status === "Committed" && clash.status !== "Committed") Object.assign(carry, { status: "Committed", closed_from: null });
    else if (clash.status !== "Committed" && stageRank(t.status) > stageRank(clash.status)) Object.assign(carry, { status: t.status, closed_from: t.closed_from ?? null });
    if (!clash.coach_name && t.coach_name) carry.coach_name = t.coach_name;
    if (!clash.aid && t.aid) carry.aid = t.aid;
    if (!clash.visit_date && t.visit_date) carry.visit_date = t.visit_date;
    // The offer: taken whole when the kept target had none, and written
    // into the notes when both had one and they differ, so neither is
    // lost to a column that holds one.
    const carriedText: string[] = [];
    if (!clash.offer_type && t.offer_type) Object.assign(carry, { offer_type: t.offer_type, offer_scholarship_percent: t.offer_scholarship_percent });
    else if (t.offer_type && (t.offer_type !== clash.offer_type || t.offer_scholarship_percent !== clash.offer_scholarship_percent)) carriedText.push(offerLine(t) ?? "");
    if (t.notes?.trim()) carriedText.push(t.notes);
    const notes = appendMerged(clash.notes, source.name, carriedText);
    if (notes !== clash.notes) carry.notes = notes;
    const { error: carryError } = await admin.from("recruiting_targets").update(carry).eq("id", clash.id).eq("org_id", clash.org_id);
    if (carryError) back(carryError.message);
    await admin.from("recruiting_targets").delete().eq("id", t.id).eq("org_id", t.org_id);
  }

  // Each org's private notes. These belong to whichever org wrote them,
  // usually not the one merging, so nothing in them is ever dropped.
  const NOTE_COLUMNS = "id, org_id, coach_name, coach_email, positions_of_need, notes";
  const [{ data: sourceNotes }, { data: keptNotes }] = await Promise.all([
    admin.from("org_school_notes").select(NOTE_COLUMNS).eq("school_id", source.id),
    admin.from("org_school_notes").select(NOTE_COLUMNS).eq("school_id", keep.id),
  ]);
  const keptNoteByOrg = new Map(((keptNotes ?? []) as NoteRef[]).map((n) => [n.org_id, n]));
  for (const n of (sourceNotes ?? []) as NoteRef[]) {
    const kn = keptNoteByOrg.get(n.org_id);
    if (!kn) {
      const { error } = await admin.from("org_school_notes").update({ school_id: keep.id, updated_at: new Date().toISOString() }).eq("id", n.id).eq("org_id", n.org_id);
      if (error) back(error.message);
      continue;
    }
    const keptNeeds = Array.isArray(kn.positions_of_need) ? kn.positions_of_need : [];
    const sourceNeeds = Array.isArray(n.positions_of_need) ? n.positions_of_need : [];
    const needs = [...keptNeeds];
    for (const p of sourceNeeds) if (!needs.some((k) => samePosition(k, p))) needs.push(p);
    const merged: Record<string, unknown> = {
      positions_of_need: needs,
      notes: appendMerged(kn.notes, source.name, [n.notes ?? ""]),
      updated_at: new Date().toISOString(),
    };
    if (!kn.coach_name && !kn.coach_email && (n.coach_name || n.coach_email)) Object.assign(merged, { coach_name: n.coach_name, coach_email: n.coach_email });
    const { error } = await admin.from("org_school_notes").update(merged).eq("id", kn.id).eq("org_id", kn.org_id);
    // Only once the kept row holds what the source said.
    if (error) back(error.message);
    await admin.from("org_school_notes").delete().eq("id", n.id).eq("org_id", n.org_id);
  }

  // Directory coaches: one row per coach per school (migration 0036).
  // The same person listed at both keeps the kept row, which takes the
  // source's title, email and phone where it had none.
  type CoachRef = { id: string; name: string; title: string | null; email: string | null; phone: string | null };
  const COACH_COLUMNS = "id, name, title, email, phone";
  const [{ data: sourceCoaches }, { data: keptCoaches }] = await Promise.all([
    admin.from("college_coaches").select(COACH_COLUMNS).eq("school_id", source.id),
    admin.from("college_coaches").select(COACH_COLUMNS).eq("school_id", keep.id),
  ]);
  const keptCoachByKey = new Map(((keptCoaches ?? []) as CoachRef[]).map((c) => [nameKey(c.name), c]));
  for (const c of (sourceCoaches ?? []) as CoachRef[]) {
    const same = keptCoachByKey.get(nameKey(c.name));
    if (!same) {
      await admin.from("college_coaches").update({ school_id: keep.id, school_name: keep.name, updated_at: new Date().toISOString() }).eq("id", c.id);
      continue;
    }
    const fill: Record<string, unknown> = {};
    for (const k of ["title", "email", "phone"] as const) if (!same[k] && c[k]) fill[k] = c[k];
    if (Object.keys(fill).length > 0) {
      const { error: fillError } = await admin.from("college_coaches").update({ ...fill, updated_at: new Date().toISOString() }).eq("id", same.id);
      if (fillError) back(fillError.message);
    }
    await admin.from("college_coaches").delete().eq("id", c.id);
  }

  // Contacts, and a transfer's Current School.
  await admin.from("contacts").update({ school_id: keep.id }).eq("school_id", source.id);
  // recruit_type is an enum with no plain "transfer" value, so the
  // filter is every recruit type but high school. The name moves with
  // the id: a Current School left reading the deleted duplicate's name
  // would match nothing on the next save and drop the id again.
  const { data: transfers } = await admin.from("athletes").select("id, detail").neq("recruit_type", "hs");
  for (const a of (transfers ?? []) as { id: string; detail: Record<string, unknown> | null }[]) {
    if (a.detail?.currentSchoolId !== source.id) continue;
    await admin.from("athletes").update({ detail: { ...a.detail, currentSchool: keep.name, currentSchoolId: keep.id } }).eq("id", a.id);
  }

  await admin.from("athlete_school_fits").delete().eq("school_id", source.id);
  const { error } = await admin.from("schools").delete().eq("id", source.id);
  if (error) back(error.message);

  await recomputeFitsForSchools(admin, [keep.id]);

  revalidateSchools(slug, source.id, keep.id);
  redirect(`/org/${slug}/schools/${keep.id}?notice=${encodeURIComponent(`${source.name} merged into ${keep.name}.`)}`);
}
