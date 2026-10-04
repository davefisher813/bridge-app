// What reading documents has cost this month: the total against the
// cap, the number of calls, and each call with the document it read.
// Admins only. The same numbers More summarizes in one line; an owner
// still sets the cap there.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { isStubbedModel } from "@/lib/actions/documents";
import { dollars, loadMonthCalls, loadMonthSpend } from "@/lib/data/docaiUsage";
import { Chevron, EmptyState, Notice, Row, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function DocAiSpendingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [spend, calls, stubbed] = await Promise.all([loadMonthSpend(supabase, org.id), loadMonthCalls(supabase, org.id), isStubbedModel()]);

  return (
    <Screen title="Doc AI Spending" back={{ href: `/org/${slug}/more`, label: "More" }} lede={`${dollars(spend.spentCents)} of ${dollars(spend.capCents)} this month, ${spend.calls} ${spend.calls === 1 ? "call" : "calls"}.`}>
      {stubbed && (
        <Notice tone="info" title="No AI Model Is Connected Yet">
          Reading is simulated and free until one is.
        </Notice>
      )}
      {spend.exhausted && !stubbed && (
        <Notice tone="warning" title="Budget Used Up">
          Documents are not read again until next month or a higher budget.
        </Notice>
      )}

      <Section label="This Month" count={calls.length} role="contact" kind="money">
        {calls.length === 0 ? (
          <EmptyState kind="money" title="No Calls Yet" />
        ) : (
          calls.map((c) => {
            const meta = `${shortDate(c.createdAt)} · ${c.model} · ${c.inputTokens + c.outputTokens} tokens`;
            const title = `${c.documentName ?? "A Removed Document"} · ${dollars(c.costCents)}`;
            return c.documentId && c.documentName ? (
              <Row key={c.id} href={`/org/${slug}/documents/${c.documentId}`} kind="money" role="contact" title={title} meta={meta} trailing={<Chevron />} wrap />
            ) : (
              <Row key={c.id} kind="money" role="contact" title={title} meta={meta} wrap />
            );
          })
        )}
      </Section>
    </Screen>
  );
}
