import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { recordGift } from "@/lib/actions/fundraising";
import { GiftForm, type OpenPledge } from "@/components/GiftForm";
import { outstandingOn } from "@/lib/fundraising/rollup";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";

export const dynamic = "force-dynamic";

export default async function NewGiftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: donorRows }, { data: campaignRows }, { data: pledgeRows }, { data: giftRows }] = await Promise.all([
    supabase.from("donors").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("campaigns").select("id, name").eq("org_id", org.id).order("name"),
    supabase
      .from("pledges")
      .select("id, amount, promised_on, due_on, status, donor_id, campaign_id")
      .eq("org_id", org.id)
      .eq("status", "open"),
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id)
      .not("pledge_id", "is", null),
  ]);

  const donors = (donorRows ?? []) as Array<{ id: string; name: string }>;
  const nameById = new Map(donors.map((d) => [d.id, d.name]));

  // What each open pledge still owes, computed from the payments against
  // it rather than from a stored balance, so the figure on the form is
  // the same one the overview shows.
  const pledges = toPledges(pledgeRows as PledgeRow[] | null);
  const pledgePayments = toGifts(giftRows as GiftRow[] | null);
  const openPledges: OpenPledge[] = pledges
    .map((p) => ({
      id: p.id,
      donorId: p.donorId,
      donorName: (p.donorId && nameById.get(p.donorId)) || "Unknown",
      outstandingCents: outstandingOn(p, pledgePayments),
    }))
    .filter((p) => p.outstandingCents > 0);

  const action = recordGift.bind(null, slug);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/fundraising`} className="text-[13px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Record a gift</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        Money that has actually arrived. A promise goes in as a pledge instead, so nothing counts it as raised before it lands.
      </p>

      <GiftForm
        action={action}
        donors={donors}
        campaigns={(campaignRows ?? []) as Array<{ id: string; name: string }>}
        openPledges={openPledges}
        today={new Date().toISOString().slice(0, 10)}
      />
    </main>
  );
}
