import { orgToday } from "@/lib/datetime/today";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { removeGift, updateGift } from "@/lib/actions/fundraising";
import { GiftForm, type BoardMemberOption, type OpenPledge } from "@/components/GiftForm";
import { outstandingOn, toCents } from "@/lib/fundraising/rollup";
import { centsToDecimalString } from "@/lib/validation/gift";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { ConfirmButton, Form, Notice, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

interface FullGiftRow {
  id: string;
  amount: number | string;
  received_on: string;
  category: string;
  method: string;
  donor_id: string | null;
  campaign_id: string | null;
  pledge_id: string | null;
  solicited_by: string | null;
  in_kind_description: string | null;
  external_ref: string | null;
  notes: string | null;
}

// Edit Gift (audit crud F10): the same form as recording one, prefilled.
// Saving re-settles the pledge it pays down, before and after, so a
// corrected amount moves the outstanding figure too. Remove is behind a
// confirm; a refund is still better recorded as a negative gift.
export default async function EditGiftPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: giftRow }, { data: donorRows }, { data: campaignRows }, { data: pledgeRows }, { data: paymentRows }] = await Promise.all([
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id, solicited_by, in_kind_description, external_ref, notes")
      .eq("id", id)
      .eq("org_id", org.id)
      .maybeSingle(),
    supabase.from("donors").select("id, name, deleted_at").eq("org_id", org.id).order("name"),
    supabase.from("campaigns").select("id, name").eq("org_id", org.id).order("name"),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
    supabase.from("gifts").select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id").eq("org_id", org.id).not("pledge_id", "is", null),
  ]);
  if (!giftRow) notFound();
  const g = giftRow as FullGiftRow;

  // The donor list, plus this gift's own donor even if they have since
  // been removed, so saving does not quietly make the gift anonymous.
  const donors = ((donorRows ?? []) as { id: string; name: string; deleted_at: string | null }[]).filter((d) => !d.deleted_at || d.id === g.donor_id).map((d) => ({ id: d.id, name: d.name }));

  // Open pledges with what each still owes, not counting this gift, and
  // the pledge this gift already pays even if it now reads as settled.
  const payments = toGifts(paymentRows as GiftRow[] | null).filter((p) => p.id !== g.id);
  const openPledges: OpenPledge[] = toPledges(pledgeRows as PledgeRow[] | null)
    .filter((p) => p.status === "open" || p.id === g.pledge_id)
    .map((p) => ({ id: p.id, donorId: p.donorId, donorName: donors.find((d) => d.id === p.donorId)?.name ?? "Unknown", outstandingCents: outstandingOn(p, payments) }))
    .filter((p) => p.outstandingCents > 0 || p.id === g.pledge_id);

  let boardMembers: BoardMemberOption[] = [];
  if (org.modules.board_governance) {
    const { data } = await supabase.from("board_members").select("id, name, status, boards(name)").eq("org_id", org.id).order("name");
    boardMembers = ((data ?? []) as Array<{ id: string; name: string; status: string; boards: { name: string } | { name: string }[] | null }>)
      .filter((m) => m.status === "active" || m.id === g.solicited_by)
      .map((m) => {
        const board = Array.isArray(m.boards) ? m.boards[0] : m.boards;
        return { id: m.id, name: m.name, boardName: board?.name ?? "Board" };
      });
  }

  return (
    <Screen title="Edit Gift" back={{ href: `/org/${slug}/fundraising/gifts`, label: "Gifts" }}>
      {error && <Notice tone="danger" title={error} />}
      <GiftForm
        action={updateGift.bind(null, slug, g.id)}
        donors={donors}
        campaigns={(campaignRows ?? []) as Array<{ id: string; name: string }>}
        openPledges={openPledges}
        boardMembers={boardMembers}
        today={orgToday()}
        submitLabel="Save Gift"
        initial={{
          amount: centsToDecimalString(toCents(g.amount)),
          receivedOn: g.received_on,
          method: g.method,
          donorId: g.donor_id,
          category: g.category,
          campaignId: g.campaign_id,
          pledgeId: g.pledge_id,
          solicitedBy: g.solicited_by,
          inKindDescription: g.in_kind_description,
          externalRef: g.external_ref,
          notes: g.notes,
        }}
      />
      <Section label="Remove" role="danger" kind="blocked">
        <Form action={removeGift.bind(null, slug, g.id)}>
          <ConfirmButton title="Remove This Gift?" body="It comes off every total, and a pledge it paid down owes that amount again. For a refund, record a negative gift instead and keep the history." confirmLabel="Remove">
            Remove Gift
          </ConfirmButton>
        </Form>
      </Section>
    </Screen>
  );
}
