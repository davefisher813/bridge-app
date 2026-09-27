import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateContact } from "@/lib/actions/contacts";
import { ContactForm } from "@/components/ContactForm";
import { loadCoachOptions } from "@/lib/data/lookups";
import { Screen } from "@/components/kit";

// Edit one of an athlete's contacts (audit crud F16): a changed phone
// number or a typo in an email is fixed here, prefilled, instead of
// removing the contact and retyping every field. Staff only, the same
// people who add and remove contacts on the athlete page.
export default async function EditContactPage({ params }: { params: Promise<{ slug: string; id: string; contactId: string }> }) {
  const { slug, id, contactId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, { data: contact }, { data: schoolRows }] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    supabase.from("contacts").select("id, name, role, email, phone, notes, school_id").eq("id", contactId).eq("athlete_id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("schools").select("id, name, division").order("name"),
  ]);
  if (!athlete || !contact) notFound();
  const c = contact as { id: string; name: string; role: string; email: string | null; phone: string | null; notes: string | null; school_id: string | null };

  const schools = ((schoolRows ?? []) as { id: string; name: string; division: string }[]).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));
  const coaches = await loadCoachOptions(supabase, schools.map((s) => s.id));

  return (
    <Screen title="Edit Contact" back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }} lede={c.name}>
      <ContactForm
        action={updateContact.bind(null, slug, id, c.id)}
        schools={schools}
        coaches={coaches}
        initial={{ name: c.name, role: c.role, schoolId: c.school_id, email: c.email, phone: c.phone, notes: c.notes }}
        submitLabel="Save Changes"
      />
    </Screen>
  );
}
