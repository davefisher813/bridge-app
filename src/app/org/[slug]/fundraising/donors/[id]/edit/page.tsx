import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { removeDonor, updateDonor } from "@/lib/actions/fundraising";
import { DonorForm } from "@/components/DonorForm";
import { ConfirmButton, Form, Notice, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

// Edit Donor (audit crud F10), prefilled, with Remove behind a confirm.
// Removing takes them out of the address book only: their gifts stay in
// every total, because the money was real.
export default async function EditDonorPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase.from("donors").select("id, name, donor_type, email, phone, address, notes").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!data) notFound();
  const d = data as { id: string; name: string; donor_type: string; email: string | null; phone: string | null; address: string | null; notes: string | null };

  return (
    <Screen title="Edit Donor" back={{ href: `/org/${slug}/fundraising/donors/${d.id}`, label: d.name }}>
      {error && <Notice tone="danger" title={error} />}
      <DonorForm
        action={updateDonor.bind(null, slug, d.id)}
        submitLabel="Save Donor"
        initial={{ name: d.name, donorType: d.donor_type, email: d.email, phone: d.phone, address: d.address, notes: d.notes }}
      />
      <Section label="Remove" role="danger" kind="blocked">
        <Form action={removeDonor.bind(null, slug, d.id)}>
          <ConfirmButton title={`Remove ${d.name}?`} body="They leave the donor list. Their gifts still count in every total, and pledges and board seats that name them keep their history." confirmLabel="Remove">
            Remove Donor
          </ConfirmButton>
        </Form>
      </Section>
    </Screen>
  );
}
