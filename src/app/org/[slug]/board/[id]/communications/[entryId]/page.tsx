// One logged communication, to correct or remove.
//
// A wrong date on a call keeps Today's follow-up count wrong for as long
// as it sits there, so a logged entry is fixable where it was typed:
// the same fields as logging one, prefilled, and a confirmed Remove.
// Staff only, like the log itself.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { isRemovedAthlete } from "@/lib/data/loadTarget";
import { removeCommunication, updateCommunication } from "@/lib/actions/communications";
import { CommunicationForm } from "@/components/CommunicationForm";
import { ConfirmButton, Form, Screen } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function EditCommunicationPage({ params }: { params: Promise<{ slug: string; id: string; entryId: string }> }) {
  const { slug, id, entryId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: entry }, { data: target }] = await Promise.all([
    supabase.from("target_communications").select("id, kind, occurred_on, notes").eq("id", entryId).eq("target_id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("recruiting_targets").select("id, schools(name), athletes(name, deleted_at)").eq("id", id).eq("org_id", org.id).maybeSingle(),
  ]);
  if (!entry || !target || isRemovedAthlete((target as { athletes?: { deleted_at?: string | null } | { deleted_at?: string | null }[] | null }).athletes)) notFound();

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const school = one((target as { schools?: { name: string } | { name: string }[] | null }).schools);
  const athlete = one((target as { athletes?: { name: string } | { name: string }[] | null }).athletes);
  const logHref = `/org/${slug}/board/${id}/communications`;

  return (
    <Screen title="Edit Communication" back={{ href: logHref, label: "Contact Log" }} lede={[school?.name, athlete?.name].filter(Boolean).join(" · ") || undefined}>
      <CommunicationForm
        action={updateCommunication.bind(null, slug, id, entryId)}
        submitLabel="Save Changes"
        initialValues={{ kind: entry.kind, occurredOn: entry.occurred_on ?? "", notes: entry.notes ?? "" }}
      />
      <Form action={removeCommunication.bind(null, slug, id, entryId)}>
        <ConfirmButton title="Remove This Entry?" body="It comes off the contact log, and the follow-up count on Today reads the log without it." confirmLabel="Remove">
          Remove Entry
        </ConfirmButton>
      </Form>
    </Screen>
  );
}
