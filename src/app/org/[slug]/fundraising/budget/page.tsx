import { notFound } from "next/navigation";
import { orgToday } from "@/lib/datetime/today";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { setBudget } from "@/lib/actions/fundraising";
import { BudgetForm } from "@/components/FundraisingForms";
import { Screen } from "@/components/kit";

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

  // The org's year, not the server's: on New Year's Eve evening UTC is
  // already next year.
  const fiscalYear = Number(year) || Number(orgToday().slice(0, 4));

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
    <Screen
      title={`${fiscalYear} Budget`}
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }}
    >
      <BudgetForm action={action} fiscalYear={fiscalYear} current={current} />
    </Screen>
  );
}
