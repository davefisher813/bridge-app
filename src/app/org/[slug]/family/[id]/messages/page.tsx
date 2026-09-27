import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { loadThread, markThreadRead } from "@/lib/data/messages";
import { loadStaff } from "@/lib/data/staff";
import { sendMessage } from "@/lib/actions/messages";
import { MessageThread } from "@/components/MessageThread";
import { MessageForm } from "@/components/MessageForm";
import { EmptyState, Screen, Section } from "@/components/kit";

// The athlete's thread, as their family sees it: the same messages staff
// read under the roster, and the one thing a family login may write
// (migration 0039). Check-ins stay staff only and never show here.
// Opening the thread moves this person's read mark to now.

export default async function FamilyMessagesPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const { athlete } = await requireFamilyAthlete(org.id, user.id, id);
  const here = `/org/${slug}/family/${id}`;

  const supabase = await createClient();
  const [messages, staff, { data: row }] = await Promise.all([
    loadThread(supabase, org.id, id),
    loadStaff(supabase, org.id),
    supabase.from("athletes").select("advisor_id").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
  ]);
  await markThreadRead(supabase, org.id, id, user.id);

  const advisorId = (row as { advisor_id: string | null } | null)?.advisor_id ?? null;
  const advisor = advisorId ? staff.find((s) => s.id === advisorId) : undefined;

  return (
    <Screen title="Messages" back={{ href: here, label: athlete.name }} lede={`With ${advisor?.name ?? org.name}`}>
      <Section label="Thread" count={messages.length} role="contact" kind="message">
        {messages.length === 0 ? (
          <EmptyState kind="message" title="Nothing Sent Yet">
            Write the first one. {org.name} sees it right away.
          </EmptyState>
        ) : (
          <MessageThread messages={messages} meId={user.id} />
        )}
      </Section>
      <MessageForm action={sendMessage.bind(null, slug, id)} />
    </Screen>
  );
}
