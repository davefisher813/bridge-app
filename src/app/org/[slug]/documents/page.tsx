import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { AddButton, Body, EmptyState, LinkButton, Notice, Row, Screen, Section } from "@/components/kit";
import type { Role } from "@/components/statusHue";
import { isStubbedModel } from "@/lib/actions/documents";
import { SearchField } from "@/components/SearchField";
import { isStubReading } from "@/lib/data/readBy";

// The review queue. A document routed to "review" has to live somewhere or
// that route is a dead end, which is what this screen is for. Applied and
// refused documents stay listed too, so "what did the reader do to my
// roster" is answerable. Discarded ones are listed last, so their files
// can be deleted for good (audit crud F19) instead of staying in the
// bucket indefinitely.

interface DocRow {
  id: string;
  file_name: string;
  category: string | null;
  status: string;
  route: string | null;
  provenance: { confidence?: number } | null;
  extracted: { studentName?: string } | null;
  athlete_id: string | null;
  athletes: { name: string; deleted_at?: string | null } | { name: string; deleted_at?: string | null }[] | null;
  failure_reason: string | null;
  read_by: string | null;
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

// Who the document is about, as the list may say it. An athlete who was
// removed from the roster is not named here, not even by the name read
// off the page, and nothing links to them: "Removed Athlete".
const REMOVED_ATHLETE = "Removed Athlete";

function athleteLabel(doc: DocRow): string | null {
  const a = unwrap(doc.athletes);
  if (doc.athlete_id && (!a || a.deleted_at)) return REMOVED_ATHLETE;
  return a?.name ?? doc.extracted?.studentName ?? null;
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
  const athlete = athleteLabel(doc);
  const pct = doc.provenance?.confidence != null ? Math.round(doc.provenance.confidence * 100) : null;
  return (
    <Row
      href={`/org/${slug}/documents/${doc.id}`}
      kind="document"
      role={role}
      title={doc.status === "filed" ? `Family Upload${athlete ? ` · ${athlete}` : ""}` : `${doc.category ? (CATEGORY_LABEL[doc.category] ?? doc.category) : "Unrecognized"}${athlete ? ` · ${athlete}` : " · no match"}`}
      meta={`${doc.status === "failed" && doc.failure_reason ? doc.failure_reason : doc.file_name}${isStubReading(doc.read_by) ? " · made up by the stand-in" : ""} · ${ago(doc.created_at)}`}
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

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ q?: string; error?: string }> }) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const q = sp.q?.trim().toLowerCase() ?? "";
  const error = sp.error;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, file_name, category, status, route, provenance, extracted, athlete_id, athletes(name, deleted_at), failure_reason, read_by, created_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const all = (data ?? []) as DocRow[];
  // File name, category or the athlete it was matched to. Filtered here
  // so the sections, the counts and the empty state agree.
  const rows = q
    ? all.filter((r) => {
        const athlete = athleteLabel(r);
        return `${r.file_name} ${r.category ?? ""} ${athlete ?? ""}`.toLowerCase().includes(q);
      })
    : all;
  const reading = rows.filter((r) => r.status === "processing");
  const pending = rows.filter((r) => r.status === "pending");
  const applied = rows.filter((r) => r.status === "applied");
  const problems = rows.filter((r) => r.status === "failed");
  const discarded = rows.filter((r) => r.status === "discarded");
  // A file an Athlete login sent in with an assignment (migration 0046).
  // Filed, never read: it is not in Needs Review and has nothing to apply.
  const familyUploads = rows.filter((r) => r.status === "filed");
  const stubbed = await isStubbedModel();

  return (
    <Screen title="Documents" action={<AddButton href={`/org/${slug}/documents/new`} label="Add" />}>
      {error && <Notice tone="danger" title={error} />}
      {stubbed && (
        <Notice tone="warning" title="Simulated Reading">
          No AI model is connected yet. Anything here was made up by the stand-in, not read off a page.
        </Notice>
      )}

      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A file name, a type or an athlete" />}

      {rows.length === 0 ? (
        <>
          <EmptyState kind="document" title={q ? "Nothing Matches" : "No Documents Yet"} action={q ? undefined : <LinkButton href={`/org/${slug}/documents/new`}>Add the First One</LinkButton>} />
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
          {familyUploads.length > 0 && (
            <Section label="Family Upload" count={familyUploads.length} role="place" kind="document">
              {familyUploads.map((d) => (
                <DocumentRow key={d.id} slug={slug} doc={d} role="place" />
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
          {discarded.length > 0 && (
            <Section label="Discarded" count={discarded.length} role="contact" kind="document">
              {discarded.map((d) => (
                <DocumentRow key={d.id} slug={slug} doc={d} role="contact" />
              ))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
