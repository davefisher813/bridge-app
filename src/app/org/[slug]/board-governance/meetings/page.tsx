import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { orgToday } from "@/lib/datetime/today";
import { longDate } from "@/lib/copy/dates";
import { splitMeetings } from "@/lib/validation/meeting";
import { AddButton, Chevron, EmptyState, LinkButton, Notice, Row, Screen, Section } from "@/components/kit";

// Board meetings (migration 0050): upcoming first, soonest at the top,
// then past ones, latest first. Each carries how many documents are on it.

interface MeetingRow {
  id: string;
  title: string;
  meets_on: string;
  location: string | null;
  boards: { name: string } | { name: string }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function MeetingsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data }, { data: links }] = await Promise.all([
    supabase.from("board_meetings").select("id, title, meets_on, location, boards(name)").eq("org_id", org.id).order("meets_on", { ascending: false }),
    supabase.from("board_meeting_documents").select("meeting_id").eq("org_id", org.id),
  ]);
  const counts = new Map<string, number>();
  for (const l of (links ?? []) as { meeting_id: string }[]) counts.set(l.meeting_id, (counts.get(l.meeting_id) ?? 0) + 1);
  const { upcoming, past } = splitMeetings((data ?? []) as MeetingRow[], orgToday());

  const row = (m: MeetingRow) => {
    const n = counts.get(m.id) ?? 0;
    const board = unwrap(m.boards)?.name;
    return (
      <Row
        key={m.id}
        href={`/org/${slug}/board-governance/meetings/${m.id}`}
        kind="board"
        role="place"
        title={m.title}
        meta={[longDate(m.meets_on), board, m.location, `${n} ${n === 1 ? "document" : "documents"}`].filter(Boolean).join(" · ")}
        trailing={<Chevron />}
        wrap
      />
    );
  };

  return (
    <Screen title="Meetings" back={{ href: `/org/${slug}/board-governance`, label: "Boards" }} action={<AddButton href={`/org/${slug}/board-governance/meetings/new`} label="Add Meeting" />}>
      {(sp.notice || sp.error) && <Notice tone={sp.error ? "danger" : "success"} title={sp.error ?? sp.notice} />}
      {upcoming.length + past.length === 0 ? (
        <EmptyState kind="board" title="No Meetings Yet" action={<LinkButton href={`/org/${slug}/board-governance/meetings/new`}>Add the First One</LinkButton>} />
      ) : (
        <>
          {upcoming.length > 0 && (
            <Section label="Upcoming" count={upcoming.length} role="place" kind="clock">
              {upcoming.map(row)}
            </Section>
          )}
          {past.length > 0 && (
            <Section label="Past" count={past.length} role="time" kind="board">
              {past.map(row)}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
