import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { removeGrant, updateGrant } from "@/lib/actions/fundraising";
import { GrantForm } from "@/components/FundraisingForms";
import { toCents } from "@/lib/fundraising/rollup";
import { centsToDecimalString } from "@/lib/validation/gift";
import { ConfirmButton, Form, Notice, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

interface GrantRow {
  id: string;
  funder_name: string;
  status: string;
  amount_requested: number | string | null;
  amount_awarded: number | string | null;
  deadline_on: string | null;
  applied_on: string | null;
  decision_expected_on: string | null;
  report_due_on: string | null;
  notes: string | null;
}

const money = (v: number | string | null) => (v === null || v === undefined ? null : centsToDecimalString(toCents(v)));

// Edit Grant (audit crud F10): where it stands moves forward here, and
// the dates and amounts are corrected in place. Remove is behind a
// confirm; money it brought in is a gift of its own and stays.
export default async function EditGrantPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data }, { data: donorRows }] = await Promise.all([
    supabase
      .from("grants")
      .select("id, funder_name, status, amount_requested, amount_awarded, deadline_on, applied_on, decision_expected_on, report_due_on, notes")
      .eq("id", id)
      .eq("org_id", org.id)
      .maybeSingle(),
    supabase.from("donors").select("name").eq("org_id", org.id).is("deleted_at", null).order("name"),
  ]);
  if (!data) notFound();
  const g = data as GrantRow;

  return (
    <Screen title="Edit Grant" back={{ href: `/org/${slug}/fundraising/grants`, label: "Grants" }} lede={g.funder_name}>
      {error && <Notice tone="danger" title={error} />}
      <GrantForm
        action={updateGrant.bind(null, slug, g.id)}
        funders={((donorRows ?? []) as { name: string }[]).map((d) => d.name)}
        submitLabel="Save Grant"
        initial={{
          funderName: g.funder_name,
          status: g.status,
          amountRequested: money(g.amount_requested),
          amountAwarded: money(g.amount_awarded),
          deadlineOn: g.deadline_on,
          appliedOn: g.applied_on,
          decisionExpectedOn: g.decision_expected_on,
          reportDueOn: g.report_due_on,
          notes: g.notes,
        }}
      />
      <Section label="Remove" role="danger" kind="blocked">
        <Form action={removeGrant.bind(null, slug, g.id)}>
          <ConfirmButton title={`Remove the ${g.funder_name} Grant?`} body="The application and its dates go. Any money it brought in is a gift of its own and stays." confirmLabel="Remove">
            Remove Grant
          </ConfirmButton>
        </Form>
      </Section>
    </Screen>
  );
}
