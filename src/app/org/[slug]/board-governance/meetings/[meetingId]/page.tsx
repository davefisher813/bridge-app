import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { longDate } from "@/lib/copy/dates";
import { attachMeetingDocument, detachMeetingDocument, removeMeeting } from "@/lib/actions/meetings";
import { formatLabelOf } from "@/lib/vault/format";
import { isLifecycle, type Lifecycle } from "@/lib/vault/lifecycle";
import { LifecycleChip } from "@/components/LifecycleChip";
import { Button, ConfirmButton, DownloadLink, EmptyState, Form, LinkButton, Notice, Prose, Row, Screen, Section, SelectField, Stack } from "@/components/kit";

// One board meeting: when and where, the notes, and its materials, which
// are documents in the vault. A document can be opened, downloaded, or
// taken off the meeting; taking it off or removing the meeting never
// touches the document itself.

interface DocRow {
  id: string;
  file_name: string;
  format: string | null;
  media_type: string;
  lifecycle: string;
  original_paths: string[] | null;
  storage_paths: string[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ slug: string; meetingId: string }>; searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const { slug, meetingId } = await params;
  const sp = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: m }, { data: links }, { data: docs }] = await Promise.all([
    supabase.from("board_meetings").select("id, title, meets_on, location, notes, boards(name)").eq("id", meetingId).eq("org_id", org.id).maybeSingle(),
    supabase.from("board_meeting_documents").select("document_id, created_at").eq("meeting_id", meetingId).eq("org_id", org.id).order("created_at", { ascending: true }),
    supabase.from("documents").select("id, file_name, format, media_type, lifecycle, original_paths, storage_paths").eq("org_id", org.id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (!m) notFound();
  const meeting = m as { id: string; title: string; meets_on: string; location: string | null; notes: string | null; boards: { name: string } | { name: string }[] | null };
  const all = (docs ?? []) as DocRow[];
  const byId = new Map(all.map((d) => [d.id, d]));
  const attached = ((links ?? []) as { document_id: string }[]).map((l) => byId.get(l.document_id)).filter((d): d is DocRow => !!d);
  const attachedIds = new Set(attached.map((d) => d.id));
  // What can be added: this org's documents not on the meeting yet, not archived.
  const addable = all.filter((d) => !attachedIds.has(d.id) && d.lifecycle !== "archived");
  const board = unwrap(meeting.boards)?.name;
  const here = `/org/${slug}/board-governance/meetings/${meetingId}`;

  return (
    <Screen title={meeting.title} lede={[longDate(meeting.meets_on), board, meeting.location].filter(Boolean).join(" · ")} back={{ href: `/org/${slug}/board-governance/meetings`, label: "Meetings" }}>
      {(sp.notice || sp.error) && <Notice tone={sp.error ? "danger" : "success"} title={sp.error ?? sp.notice} />}

      {meeting.notes && (
        <Section label="Notes" role="place" kind="note">
          <Prose>{meeting.notes}</Prose>
        </Section>
      )}

      <Section label="Materials" count={attached.length} role="place" kind="document">
        {attached.length === 0 && <EmptyState kind="document" title="No Documents on This Meeting Yet" />}
        {attached.map((d) => {
          const files = d.original_paths?.length ? d.original_paths : (d.storage_paths ?? []);
          return (
            <Stack key={d.id} gap={2}>
              <Row
                href={`/org/${slug}/documents/${d.id}`}
                kind="document"
                role="place"
                title={d.file_name}
                meta={formatLabelOf(d.format, d.media_type)}
                trailing={<LifecycleChip lifecycle={(isLifecycle(d.lifecycle) ? d.lifecycle : "needs_review") as Lifecycle} />}
                wrap
              />
              {files.length > 0 && <DownloadLink href={`/org/${slug}/documents/${d.id}/download?n=1`}>Download {d.file_name}</DownloadLink>}
              <Form action={detachMeetingDocument.bind(null, slug, meetingId, d.id)}>
                <ConfirmButton title="Take This Off the Meeting?" body="The document stays in Documents. Only this meeting's list changes." confirmLabel="Take Off">
                  Take Off the Meeting
                </ConfirmButton>
              </Form>
            </Stack>
          );
        })}
      </Section>

      <Section label="Add a Document" role="place" kind="document">
        {addable.length > 0 ? (
          <Form action={attachMeetingDocument.bind(null, slug, meetingId)}>
            <SelectField name="documentId" label="From Documents" defaultValue="">
              <option value="" disabled>
                Pick a document
              </option>
              {addable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name}
                </option>
              ))}
            </SelectField>
            <Button type="submit" variant="secondary">
              Add to Meeting
            </Button>
          </Form>
        ) : (
          <Prose>Every document in Documents is on this meeting already, or archived.</Prose>
        )}
        <LinkButton href={`/org/${slug}/documents/new`} variant="secondary">
          Upload a New Document
        </LinkButton>
      </Section>

      <Stack>
        <LinkButton href={`${here}/edit`} variant="secondary">
          Edit Meeting
        </LinkButton>
        <Form action={removeMeeting.bind(null, slug, meetingId)}>
          <ConfirmButton title="Remove This Meeting?" body="The meeting and its list go. Every document on it stays in Documents." confirmLabel="Remove Meeting">
            Remove Meeting
          </ConfirmButton>
        </Form>
      </Stack>
    </Screen>
  );
}
