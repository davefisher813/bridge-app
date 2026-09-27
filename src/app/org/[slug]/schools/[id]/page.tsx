// One school: what it costs, what it takes academically, how deep the
// position is, and which of your athletes are pointed at it.
//
// A school record is the input to half the fit engine, so "what does
// this school actually say" has to have an answer somewhere in the
// product.
//
// The shared facts (the numbers, money with the D3 rule, the depth
// chart, the flags) render through src/components/SchoolProfile.tsx,
// the same component the family and member directories use. What is
// here and not there is the org's own side: its coaches, its notes,
// its athletes pointed at this school.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { isDirectoryEditor, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, Label, LinkButton, Notice, Row, Score, Screen, Section, TextLink } from "@/components/kit";
import { OrgSchoolNoteForm } from "@/components/OrgSchoolNoteForm";
import { saveOrgSchoolNote } from "@/lib/actions/schools";
import { formatPositionsOfNeed, type PositionOfNeed } from "@/lib/validation/orgSchoolNote";
import { Note } from "@/components/EligibilityVerdict";
import { stageKind, statusRole } from "@/components/statusHue";
import { loadTarget } from "@/lib/data/loadTarget";
import { loadCoachesForSchool } from "@/lib/data/coaches";
import { loadSchoolFacts } from "@/lib/data/schoolDirectory";
import { CoachRows } from "@/components/CoachRows";
import { SchoolAcademics, SchoolMoneyAndDepth, schoolLede } from "@/components/SchoolProfile";
import { StatusPill } from "@/components/StatusPill";
import { isScoredStatus } from "@/lib/placement";

export const dynamic = "force-dynamic";

export default async function SchoolPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ notice?: string }> }) {
  const { slug, id } = await params;
  const { notice } = (await searchParams) ?? {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);
  // Only a directory editor (an owner of an org with
  // orgs.edits_shared_directory on, migration 0040) may change a school
  // or its coaches, so only they get a tile that opens the form. For
  // everybody else, an owner of any other org included, the number is
  // just a number and the profile reads as it does for staff.
  const canEditDirectory = await isDirectoryEditor(user);
  const viewer = canEditDirectory ? "owner" : user.role === "owner" ? "staff" : user.role;
  const editHref = canEditDirectory ? `/org/${slug}/schools/${id}/edit` : undefined;

  const supabase = await createClient();
  const [facts, { data: targetRows }, { data: noteRow }, coaches] = await Promise.all([
    loadSchoolFacts(supabase, id),
    supabase
      .from("recruiting_targets")
      .select("id, status, athletes(id, name, position, status, deleted_at)")
      .eq("school_id", id)
      .eq("org_id", org.id),
    supabase.from("org_school_notes").select("coach_name, coach_email, positions_of_need, notes").eq("org_id", org.id).eq("school_id", id).maybeSingle(),
    loadCoachesForSchool(supabase, id),
  ]);

  if (!facts) notFound();
  const { school, location } = facts;

  type TargetAthlete = { id: string; name: string; position: string | null; status: string; deleted_at?: string | null };
  // A removed athlete (a soft delete) is no longer one of Your Athletes Here.
  const targets = ((targetRows ?? []) as Array<{
    id: string;
    status: string;
    athletes: TargetAthlete | TargetAthlete[] | null;
  }>).filter((t) => !(Array.isArray(t.athletes) ? t.athletes[0] : t.athletes)?.deleted_at);

  // Each target's score comes from loadTarget, the same call the target
  // page makes. Scoring them inline here with a second set of adapters is
  // exactly how the same target ends up at 68 on one screen and 71 on
  // another with nothing failing. A placed or Inactive athlete has no
  // score: their status sits where it would, and they sort with the
  // unscored.
  const scored = await Promise.all(
    targets.map(async (t) => {
      const bundle = await loadTarget(org.id, t.id);
      const a = Array.isArray(t.athletes) ? t.athletes[0] : t.athletes;
      const athleteStatus = a?.status ?? bundle?.athleteStatus ?? "";
      const unscored = !isScoredStatus(athleteStatus);
      return { id: t.id, status: t.status, name: a?.name ?? "Unknown athlete", position: a?.position ?? null, athleteStatus, unscored, fit: unscored ? null : (bundle?.fit ?? null) };
    }),
  );
  scored.sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1));

  const note = (noteRow ?? null) as { coach_name: string | null; coach_email: string | null; positions_of_need: PositionOfNeed[] | null; notes: string | null } | null;
  const needs = formatPositionsOfNeed(Array.isArray(note?.positions_of_need) ? note!.positions_of_need! : []);
  const noteAction = saveOrgSchoolNote.bind(null, slug, id);

  return (
    <Screen
      title={school.name}
      back={{ href: `/org/${slug}/schools`, label: "Schools" }}
      lede={schoolLede(school, location)}
      action={canEditDirectory ? <TextLink href={`/org/${slug}/schools/${id}/edit`}>Edit</TextLink> : undefined}
    >
      {/* First, so a merge landing here says so above the fold. */}
      {notice && (
        <Notice tone="success" title="Done">
          {notice}
        </Notice>
      )}

      {/* The numbers the score is built on, and the way to correct one. */}
      <SchoolAcademics school={school} viewer={viewer} editHref={editHref} />

      <CoachRows coaches={coaches} manageHref={canEditDirectory ? `/org/${slug}/schools/${id}` : undefined} />

      {/* This org's private overlay: the coach relationship and the
          positions the program needs. Positions of need move the score
          for an athlete whose position and grad year fit. */}
      <Section label="Your Notes" role="contact" kind="note">
        {note && (note.coach_name || note.coach_email) && (
          <Row href={note.coach_email ? `mailto:${note.coach_email}` : undefined} kind="people" role="people" title={note.coach_name ?? "Head Coach"} meta={note.coach_email ?? undefined} wrap />
        )}
        {needs && <Row kind="target" role="contact" title="Positions of Need" meta={needs} wrap />}
        {note?.notes && <Note>{note.notes}</Note>}
        {!note && !canEdit && (
          <EmptyState kind="note" title="Nothing Noted Yet">
            Staff keep the coach contact and positions of need here.
          </EmptyState>
        )}
        {canEdit && (
          <OrgSchoolNoteForm
            action={noteAction}
            coaches={coaches.map((c) => ({ value: c.name, label: c.title ?? undefined, email: c.email }))}
            initialValues={{ coachName: note?.coach_name ?? undefined, coachEmail: note?.coach_email ?? undefined, positionsOfNeed: needs || undefined, notes: note?.notes ?? undefined }}
          />
        )}
        {canEdit && <Label>Private to your organization. A matching position and grad year adds ten to a score here.</Label>}
      </Section>

      <SchoolMoneyAndDepth school={school} viewer={viewer} editHref={editHref} />

      <Section label="Your Athletes Here" count={scored.length} role="contact" kind="athlete">
        {scored.length === 0 ? (
          <EmptyState kind="athlete" title="Nobody Here Yet" action={<LinkButton href={`/org/${slug}/roster`}>Open Athletes</LinkButton>}
          />
        ) : (
          scored.map((t) => (
            <Row
              key={t.id}
              href={`/org/${slug}/board/${t.id}`}
              kind={stageKind(t.status)}
              role={statusRole(t.status)}
              title={t.name}
              meta={[t.position, t.status].filter(Boolean).join(" · ")}
              trailing={t.unscored ? <StatusPill status={t.athleteStatus} /> : t.fit ? <Score score={t.fit.score} /> : undefined}
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
