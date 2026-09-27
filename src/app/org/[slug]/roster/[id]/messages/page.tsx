import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { loadThread, markThreadRead } from "@/lib/data/messages";
import { deleteMessage, sendMessage } from "@/lib/actions/messages";
import { MessageForm } from "@/components/MessageForm";
import { MessageThread } from "@/components/MessageThread";
import { EmptyState, Notice, Screen, Section, TextLink } from "@/components/kit";

// One athlete's thread, the staff side (migration 0039). The org's
// owners and staff and that athlete's family share it; a member never
// reads it. Opening the screen moves this person's read mark to now, so
// the "new" count on the athlete page and My Athletes clears.
//
// Each message is a static card: it is prose, not a record to open, and
// the composer under the thread is the action. Staff can remove one,
// behind a confirm (audit crud F9).
export default async function AthleteMessagesPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, { data: guardianRows }, messages] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).single(),
    supabase.from("athlete_guardians").select("user_id").eq("athlete_id", id).eq("org_id", org.id),
    loadThread(supabase, org.id, id),
  ]);
  if (!athlete) notFound();

  // Read once the thread is on screen. Idempotent, so a second render
  // (a prefetch) does no harm.
  await markThreadRead(supabase, org.id, id, user.id);

  const logins = (guardianRows ?? []).length;
  const athleteHref = `/org/${slug}/roster/${id}`;

  return (
    <Screen title="Messages" back={{ href: athleteHref, label: athlete.name }} lede={`${athlete.name} · ${logins} athlete ${logins === 1 ? "login" : "logins"}`}>
      {logins === 0 && (
        <Notice tone="info" title="No Athlete Login Yet">
          Nobody can read this until they have an athlete login. Everything here is waiting for them when they do. <TextLink href={`${athleteHref}/family/new`}>Invite Athlete</TextLink>
        </Notice>
      )}

      <Section label="Thread" count={messages.length} role="contact" kind="message">
        {messages.length === 0 ? (
          <EmptyState kind="message" role="contact" title="Nothing Sent Yet">
            The first message starts the thread.
          </EmptyState>
        ) : (
          <MessageThread messages={messages} meId={user.id} remove={deleteMessage.bind(null, slug, id)} />
        )}
      </Section>

      <MessageForm action={sendMessage.bind(null, slug, id)} />

      <TextLink href={`${athleteHref}/checkins`}>Log a Check-In</TextLink>
    </Screen>
  );
}
