// One logged visit, to correct or remove. The visit count moves the fit
// score, so a visit logged on the wrong target has to be removable, and
// a wrong date fixable, where it was typed. Staff only.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { isRemovedAthlete } from "@/lib/data/loadTarget";
import { removeVisit, updateVisit } from "@/lib/actions/visits";
import { VisitForm } from "@/components/VisitForm";
import { ConfirmButton, Form, Screen } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function EditVisitPage({ params }: { params: Promise<{ slug: string; id: string; visitId: string }> }) {
  const { slug, id, visitId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: visit }, { data: target }] = await Promise.all([
    supabase.from("target_visits").select("id, visit_type, visit_date, impression, next_step, notes").eq("id", visitId).eq("target_id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("recruiting_targets").select("id, schools(name), athletes(name, deleted_at)").eq("id", id).eq("org_id", org.id).maybeSingle(),
  ]);
  if (!visit || !target || isRemovedAthlete((target as { athletes?: { deleted_at?: string | null } | { deleted_at?: string | null }[] | null }).athletes)) notFound();

  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const school = one((target as { schools?: { name: string } | { name: string }[] | null }).schools);
  const athlete = one((target as { athletes?: { name: string } | { name: string }[] | null }).athletes);
  const logHref = `/org/${slug}/board/${id}/communications`;

  return (
    <Screen title="Edit Visit" back={{ href: logHref, label: "Contact Log" }} lede={[school?.name, athlete?.name].filter(Boolean).join(" · ") || undefined}>
      <VisitForm
        action={updateVisit.bind(null, slug, id, visitId)}
        submitLabel="Save Changes"
        initialValues={{
          visitType: visit.visit_type,
          visitDate: visit.visit_date ?? "",
          impression: visit.impression ?? "",
          nextStep: visit.next_step ?? "",
          notes: visit.notes ?? "",
        }}
      />
      <Form action={removeVisit.bind(null, slug, id, visitId)}>
        <ConfirmButton title="Remove This Visit?" body="It comes off the contact log, and the fit score stops counting it." confirmLabel="Remove">
          Remove Visit
        </ConfirmButton>
      </Form>
    </Screen>
  );
}
