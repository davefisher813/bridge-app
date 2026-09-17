import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { setBudget } from "@/lib/actions/fundraising";
import { BudgetForm } from "@/components/FundraisingForms";

export const dynamic = "force-dynamic";

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug } = await params;
  const { year } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const fiscalYear = Number(year) || new Date().getFullYear();

  const supabase = await createClient();
  const { data } = await supabase
    .from("fundraising_budget")
    .select("category, amount")
    .eq("org_id", org.id)
    .eq("fiscal_year", fiscalYear);

  // Prefilled with what is already stored, so editing one line does not
  // require retyping the other four.
  const current: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ category: string; amount: number | string }>) {
    const n = Number(row.amount);
    if (Number.isFinite(n) && n > 0) current[row.category] = n.toFixed(2);
  }

  const action = setBudget.bind(null, slug, fiscalYear);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/fundraising`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">{fiscalYear} budget</h1>
      <p className="mb-5 text-[13.5px] leading-tight text-muted">
        The full-year target per category, as the board approved it. Everything on the overview is measured against these.
      </p>
      <BudgetForm action={action} fiscalYear={fiscalYear} current={current} />
    </main>
  );
}
