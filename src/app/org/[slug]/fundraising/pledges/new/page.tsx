import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { recordPledge } from "@/lib/actions/fundraising";
import { PledgeForm } from "@/components/FundraisingForms";
import { RailCard } from "@/components/catalog";

export const dynamic = "force-dynamic";

export default async function NewPledgePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: donorRows }, { data: campaignRows }] = await Promise.all([
    supabase.from("donors").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("campaigns").select("id, name").eq("org_id", org.id).order("name"),
  ]);

  const donors = (donorRows ?? []) as Array<{ id: string; name: string }>;

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/fundraising`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Record a pledge</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        Money promised. It will not count as raised until a payment against it actually arrives.
      </p>

      {donors.length === 0 ? (
        <>
          <RailCard role="offer">
            <div className="text-[13px] font-bold text-ink">No donors on file yet</div>
            <div className="mt-1 text-[12px] leading-tight text-muted">
              A pledge needs somebody behind it, so add the donor first.
            </div>
          </RailCard>
          <div className="mt-5">
            <Link
              href={`/org/${slug}/fundraising/donors/new`}
              className="block rounded-[8px] bg-solid-accent py-3 text-center text-[14px] font-bold text-solid-accent-on"
            >
              Add a donor
            </Link>
          </div>
        </>
      ) : (
        <PledgeForm
          action={recordPledge.bind(null, slug)}
          donors={donors}
          campaigns={(campaignRows ?? []) as Array<{ id: string; name: string }>}
          today={new Date().toISOString().slice(0, 10)}
        />
      )}
    </main>
  );
}
