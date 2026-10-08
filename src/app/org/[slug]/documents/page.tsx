import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { AddButton, Body, EmptyState, LinkButton, Notice, Row, Screen, Section, TextLink } from "@/components/kit";
import { LifecycleChip } from "@/components/LifecycleChip";
import { formatBytes, formatLabelOf } from "@/lib/vault/format";
import { isLifecycle, isStaleProcessing, LIFECYCLE_LABEL, type Lifecycle } from "@/lib/vault/lifecycle";
import type { Role } from "@/components/statusHue";
import { isStubbedModel } from "@/lib/actions/documents";
import { SearchField } from "@/components/SearchField";
import { isStubReading } from "@/lib/data/readBy";

// The vault. Every stored document, in the five states it moves through:
// Uploaded, Processing, Needs Review, Ready, Archived (migration 0048).
// The state is on every row. Archived is out of the way until asked for
// and nothing is ever deleted, so Archived is where a discarded or put
// away document lives. What the reader did (applied to an athlete, made
// up by the stand-in) still shows on the row.

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
  file_size: number;
  media_type: string;
  format: string | null;
  lifecycle: string;
  lifecycle_changed_at: string | null;
  review_reason: string | null;
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

function DocumentRow({ slug, doc }: { slug: string; doc: DocRow }) {
  const athlete = athleteLabel(doc);
  const pct = doc.provenance?.confidence != null ? Math.round(doc.provenance.confidence * 100) : null;
  const lifecycle = (isLifecycle(doc.lifecycle) ? doc.lifecycle : "needs_review") as Lifecycle;
  const typed = !!doc.category;
  // A tagged document reads "Transcript · Name"; one nobody tagged is
  // just its file name, which is the only thing known about it.
  const title =
    doc.status === "filed"
      ? `Family Upload${athlete ? ` · ${athlete}` : ""}`
      : typed
        ? `${CATEGORY_LABEL[doc.category!] ?? doc.category}${athlete ? ` · ${athlete}` : " · no match"}`
        : doc.file_name;
  const reason = lifecycle === "processing" && isStaleProcessing(lifecycle, doc.lifecycle_changed_at) ? "Reading did not finish." : doc.review_reason;
  const facts = [typed || doc.status === "filed" ? doc.file_name : null, formatLabelOf(doc.format, doc.media_type), formatBytes(doc.file_size), ago(doc.created_at)].filter(Boolean);
  const notes = [doc.status === "applied" ? "Applied to the record." : null, reason, isStubReading(doc.read_by) ? "Made up by the stand-in." : null].filter(Boolean);
  return (
    <Row
      href={`/org/${slug}/documents/${doc.id}`}
      kind="document"
      role={lifecycle === "needs_review" ? "offer" : lifecycle === "ready" ? "committed" : "neutral"}
      title={title}
      meta={[facts.join(" · "), ...notes].join(" · ")}
      wrap
      trailing={
        <>
          <LifecycleChip lifecycle={lifecycle} />
          {pct !== null && (
            <Body weight="bold" numeric tone={confidenceRole(pct)}>
              {pct}%
            </Body>
          )}
        </>
      }
    />
  );
}

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ q?: string; error?: string; archived?: string }> }) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const q = sp.q?.trim().toLowerCase() ?? "";
  const error = sp.error;
  const showArchived = sp.archived === "1";
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, file_name, category, status, route, provenance, extracted, athlete_id, athletes(name, deleted_at), failure_reason, read_by, created_at, file_size, media_type, format, lifecycle, lifecycle_changed_at, review_reason")
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
  const inState = (state: Lifecycle) => rows.filter((r) => r.lifecycle === state);
  const archivedCount = all.filter((r) => r.lifecycle === "archived").length;
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
          {(["uploaded", "processing", "needs_review", "ready"] as const).map((state) => {
            const list = inState(state);
            if (list.length === 0) return null;
            return (
              <Section key={state} label={LIFECYCLE_LABEL[state]} count={list.length} role={state === "needs_review" ? "offer" : state === "ready" ? "committed" : state === "processing" ? "contact" : "neutral"} kind={state === "needs_review" ? "warning" : state === "ready" ? "check" : state === "processing" ? "clock" : "document"}>
                {list.map((d) => (
                  <DocumentRow key={d.id} slug={slug} doc={d} />
                ))}
              </Section>
            );
          })}
          {showArchived && inState("archived").length > 0 && (
            <Section label="Archived" count={inState("archived").length} role="neutral" kind="note">
              {inState("archived").map((d) => (
                <DocumentRow key={d.id} slug={slug} doc={d} />
              ))}
            </Section>
          )}
        </>
      )}

      {archivedCount > 0 && (
        <TextLink href={showArchived ? `/org/${slug}/documents${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/org/${slug}/documents?archived=1${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
          {showArchived ? "Hide Archived" : `Show Archived (${archivedCount})`}
        </TextLink>
      )}
    </Screen>
  );
}
