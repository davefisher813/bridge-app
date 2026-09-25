import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createTransferWindow } from "@/lib/actions/transferWindows";
import { TransferWindowForm } from "@/components/TransferWindowForm";
import { Screen } from "@/components/kit";

// Owner only, like schools: a window is shared reference data every org
// reads, written through the service role behind requireOwner().
export default async function NewTransferWindowPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  return (
    <Screen title="Add a Transfer Window" back={{ href: `/org/${slug}/transfer-windows`, label: "Transfer Windows" }}>
      <TransferWindowForm action={createTransferWindow.bind(null, slug)} />
    </Screen>
  );
}
