import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { AddButton, Body, EmptyState, LinkButton, Notice, Row, Screen, Section } from "@/components/kit";
import type { Role } from "@/components/statusHue";
import { isStubbedModel } from "@/lib/actions/documents";

// The review queue. A document routed to "review" has to live somewhere or
// that route is a dead end, which is what this screen is for. Applied and
// refused documents stay listed too, so "what did the reader do to my
// roster" is answerable.

interface DocRow {
  id: string;
  file_name: string;
  category: string | null;
  status: string;
  route: string | null;
  provenance: { confidence?: number } | null;
  extracted: { studentName?: string } | null;
  athlete_id: string | null;
  athletes: { name: string } | { name: string }[] | null;
  failure_reason: string | null;
  created_at: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  transcript: "Transcript",
  test_scores: "Test Scores",
  offer_letter: "Offer Letter",
  recommendation: "Recommendation",
  financial_aid: "Financial Aid",
  metrics: "Metrics Report",
  film: "Film",
};

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function confidenceRole(pct: number): Role {
  if (pct >= 70) return "high";
  if (pct >= 40) return "mid";
  return "low";
}

function DocumentRow({ slug, doc, role }: { slug: string; doc: DocRow; role: Role }) {
  const athlete = unwrap(doc.athletes)?.name ?? doc.extracted?.studentName ?? null;
  const pct = doc.provenance?.confidence != null ? Math.round(doc.provenance.confidence * 100) : null;
  return (
    <Row
      href={`/org/${slug}/documents/${doc.id}`}
      kind="document"
      role={role}
      title={`${doc.category ? (CATEGORY_LABEL[doc.category] ?? doc.category) : "Unrecognized"}${athlete ? ` · ${athlete}` : " · no match"}`}
      meta={`${doc.status === "failed" && doc.failure_reason ? doc.failure_reason : doc.file_name} · ${ago(doc.created_at)}`}
      wrap
      trailing={
        pct !== null ? (
          <Body weight="bold" numeric tone={confidenceRole(pct)}>
            {pct}%
          </Body>
        ) : undefined
      }
    />
  );
}

export default async function DocumentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, file_name, category, status, route, provenance, extracted, athlete_id, athletes(name), failure_reason, created_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (data ?? []) as DocRow[];
  const reading = rows.filter((r) => r.status === "processing");
  const pending = rows.filter((r) => r.status === "pending");
  const applied = rows.filter((r) => r.status === "applied");
  const problems = rows.filter((r) => r.status === "failed");
  const stubbed = await isStubbedModel();

  return (
    <Screen title="Documents" action={<AddButton href={`/org/${slug}/documents/new`} label="Add" />}>
      {stubbed && (
        <Notice tone="warning" title="Simulated Reading">
          No AI model is connected yet. Anything here was made up by the stand-in, not read off a page.
        </Notice>
      )}

      {rows.length === 0 ? (
        <>
          <EmptyState kind="document" title="No Documents Yet" action={<LinkButton href={`/org/${slug}/documents/new`}>Add the First One</LinkButton>}>
            A transcript, test scores, an offer letter. It gets read, matched to an athlete, and applied or sent to review.
          </EmptyState>
        </>
      ) : (
        <>
          {reading.length > 0 && (
            <Section label="Being Read" count={reading.length} role="offer" kind="document">
              {reading.map((d) => (
                <DocumentRow key={d.id} slug={slug} doc={d} role="offer" />
              ))}
            </Section>
          )}
          {pending.length > 0 && (
            <Section label="Needs Review" count={pending.length} role="offer" kind="warning">
              {pending.map((d) => (
                <DocumentRow key={d.id} slug={slug} doc={d} role="offer" />
              ))}
            </Section>
          )}
          {problems.length > 0 && (
            <Section label="Not Used" count={problems.length} role="danger" kind="blocked">
              {problems.map((d) => (
                <DocumentRow key={d.id} slug={slug} doc={d} role="danger" />
              ))}
            </Section>
          )}
          {applied.length > 0 && (
            <Section label="Applied" count={applied.length} role="committed" kind="check">
              {applied.map((d) => (
                <DocumentRow key={d.id} slug={slug} doc={d} role="committed" />
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
