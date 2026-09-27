import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireDirectoryEditor } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { deleteTransferWindow, updateTransferWindow } from "@/lib/actions/transferWindows";
import { TransferWindowForm } from "@/components/TransferWindowForm";
import { ConfirmButton, Form, Screen } from "@/components/kit";

export const dynamic = "force-dynamic";

// Correcting a transfer window (crud F22). Directory editors only, like
// adding one: a window is shared reference data every org reads,
// written through the service role behind requireDirectoryEditor().
export default async function EditTransferWindowPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireDirectoryEditor(org.id);

  const supabase = await createClient();
  const { data: w } = await supabase
    .from("transfer_windows")
    .select("id, sport, division, season_year, window_label, opens_on, closes_on, source_url, notes")
    .eq("id", id)
    .maybeSingle();
  if (!w) notFound();

  return (
    <Screen title="Edit Transfer Window" back={{ href: `/org/${slug}/transfer-windows`, label: "Transfer Windows" }} lede={`${w.division} · ${w.window_label} · ${w.season_year}`}>
      <TransferWindowForm
        action={updateTransferWindow.bind(null, slug, id)}
        submitLabel="Save Changes"
        initialValues={{
          sport: w.sport,
          division: w.division,
          seasonYear: w.season_year,
          windowLabel: w.window_label,
          opensOn: w.opens_on,
          closesOn: w.closes_on,
          sourceUrl: w.source_url ?? "",
          notes: w.notes ?? "",
        }}
      />
      <Form action={deleteTransferWindow.bind(null, slug, id)}>
        <ConfirmButton title="Remove This Window?" body="Every transfer's timing stops reading it, in every organization." confirmLabel="Remove">
          Remove Window
        </ConfirmButton>
      </Form>
    </Screen>
  );
}
