import { documentTypeLabel } from "@/lib/documents/fileTypes";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { AddButton, Body, EmptyState, LinkButton, Notice, Row, Screen, Section, Stat, StatRow } from "@/components/kit";
import { LifecycleChip } from "@/components/LifecycleChip";
import { formatBytes, formatLabelOf } from "@/lib/vault/format";
import { isLifecycle, isStaleProcessing, LIFECYCLE_LABEL, type Lifecycle } from "@/lib/vault/lifecycle";
import type { Role } from "@/components/statusHue";
import { isStubbedModel } from "@/lib/actions/documents";
import { SearchField } from "@/components/SearchField";
import { isStubReading } from "@/lib/data/readBy";

// The vault. Every stored document, in the five states it moves through:
// Uploaded, Processing, Needs Review, Ready, Archived (migration 0048).
// The state is on every row. Four views (Dave, 2026-10-11): All, Needs
// Review, Ready and Archived, with search across whichever is open.
// Nothing is ever deleted, so Archived is where a discarded or put away
// document lives, and every document is in All. What the reader did (applied to an athlete, made
// up by the stand-in) still shows on the row.

interface DocRow {
  id: string;
  file_name: string;
  category: string | null;
  requested_category: string | null;
  filed_as: string | null;
  status: string;
  route: string | null;
  provenance: { confidence?: number } | null;
  extracted: { studentName?: string } | null;
  athlete_id: string | null;
  linked_athlete_id?: string | null;
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
  athlete_profile: "Athlete Profile",
  film: "Film",
};

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Who the document is about, as the list may say it. An athlete who was
// removed from the roster is not named here, not even by the name read
// off the page, and nothing links to them: "Removed Athlete".
const REMOVED_ATHLETE = "Removed Athlete";

function athleteLabel(doc: DocRow, linkedNames?: Map<string, string>): string | null {
  const a = unwrap(doc.athletes);
  if (doc.athlete_id && (!a || a.deleted_at)) return REMOVED_ATHLETE;
  // The athlete a person linked it to (migration 0058), when no reading
  // was applied.
  const linked = doc.linked_athlete_id ? linkedNames?.get(doc.linked_athlete_id) : undefined;
  return a?.name ?? linked ?? doc.extracted?.studentName ?? null;
}

// The four views. Uploaded and Processing are in All only: they are on
// their way to Needs Review.
const VIEWS = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs Review" },
  { id: "ready", label: "Ready" },
  { id: "archived", label: "Archived" },
] as const;
type View = (typeof VIEWS)[number]["id"];
// A browser cannot hold more than this many rows usefully; past it the
// screen says so instead of quietly dropping the oldest.
const LOAD_CAP = 2000;

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

function DocumentRow({ slug, doc, linkedNames }: { slug: string; doc: DocRow; linkedNames: Map<string, string> }) {
  const athlete = athleteLabel(doc, linkedNames);
  const pct = doc.provenance?.confidence != null ? Math.round(doc.provenance.confidence * 100) : null;
  const lifecycle = (isLifecycle(doc.lifecycle) ? doc.lifecycle : "needs_review") as Lifecycle;
  // The type a person picked or the reader settled on (fileTypes.ts). A
  // read document reads "Transcript · Name"; one typed but not read is
  // just its type, with the file name below; one nobody typed is its file
  // name, the only thing known about it.
  const label = documentTypeLabel(doc, CATEGORY_LABEL);
  const typed = !!label;
  const title =
    doc.status === "filed"
      ? `Family Upload${athlete ? ` · ${athlete}` : ""}`
      : doc.category
        ? `${label}${athlete ? ` · ${athlete}` : " · no match"}`
        : (label ?? doc.file_name);
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

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ q?: string; error?: string; archived?: string; view?: string }> }) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const q = sp.q?.trim().toLowerCase() ?? "";
  const error = sp.error;
  // The old Show Archived address still opens Archived.
  const view: View = VIEWS.some((v) => v.id === sp.view) ? (sp.view as View) : sp.archived === "1" ? "archived" : "all";
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  // Every document, not the newest few: a cap of 60 hid every older one
  // from the list and from search (Dave, 2026-10-11, 150 on production).
  const [{ data }, { data: athleteRows }] = await Promise.all([
    supabase
      .from("documents")
      .select("id, file_name, category, requested_category, filed_as, status, route, provenance, extracted, athlete_id, linked_athlete_id, athletes!documents_athlete_id_fkey(name, deleted_at), failure_reason, read_by, created_at, file_size, media_type, format, lifecycle, lifecycle_changed_at, review_reason")
      .eq("org_id", org.id)
      .order("created_at", { ascending: false })
      .limit(LOAD_CAP),
    supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null),
  ]);
  const linkedNames = new Map(((athleteRows ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));

  const all = (data ?? []) as DocRow[];
  // File name, type or athlete, across every state; the view then narrows
  // it, so a search finds a document wherever it is and the tiles say
  // how many matches each view holds.
  const matched = q
    ? all.filter((r) => {
        const athlete = athleteLabel(r, linkedNames);
        return `${r.file_name} ${documentTypeLabel(r, CATEGORY_LABEL) ?? ""} ${athlete ?? ""}`.toLowerCase().includes(q);
      })
    : all;
  const inView = (v: View) => (v === "all" ? matched : matched.filter((r) => r.lifecycle === v));
  const rows = inView(view);
  const inState = (state: Lifecycle) => rows.filter((r) => r.lifecycle === state);
  const stubbed = await isStubbedModel();
  const viewHref = (v: View) => {
    const qs = new URLSearchParams();
    if (v !== "all") qs.set("view", v);
    if (q) qs.set("q", q);
    const s = qs.toString();
    return `/org/${slug}/documents${s ? `?${s}` : ""}`;
  };
  const viewLabel = VIEWS.find((v) => v.id === view)!.label;

  return (
    <Screen title="Documents" lede={`Showing ${viewLabel}${q ? `, matching "${q}"` : ""}: ${rows.length} ${rows.length === 1 ? "document" : "documents"}.`} action={<AddButton href={`/org/${slug}/documents/new`} label="Add" />}>
      {error && <Notice tone="danger" title={error} />}
      {stubbed && (
        <Notice tone="warning" title="Simulated Reading">
          No AI model is connected yet. Anything here was made up by the stand-in, not read off a page.
        </Notice>
      )}
      {all.length >= LOAD_CAP && <Notice tone="warning" title={`Showing the Newest ${LOAD_CAP}`}>Older documents are not listed. Search by name to narrow it.</Notice>}

      <StatRow>
        {VIEWS.map((v) => (
          <Stat key={v.id} href={viewHref(v.id)} value={inView(v.id).length} label={v.label} role={v.id === view ? "accent" : "neutral"} kind={v.id === view ? "check" : undefined} />
        ))}
      </StatRow>

      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A file name, a type or an athlete" />}

      {rows.length === 0 ? (
        <EmptyState kind="document" title={q ? "Nothing Matches" : all.length === 0 ? "No Documents Yet" : `Nothing in ${viewLabel}`} action={q || all.length > 0 ? undefined : <LinkButton href={`/org/${slug}/documents/new`}>Add the First One</LinkButton>} />
      ) : (
        (["uploaded", "processing", "needs_review", "ready", "archived"] as const).map((state) => {
          const list = inState(state);
          if (list.length === 0) return null;
          return (
            <Section key={state} label={LIFECYCLE_LABEL[state]} count={list.length} role={state === "needs_review" ? "offer" : state === "ready" ? "committed" : state === "processing" ? "contact" : "neutral"} kind={state === "needs_review" ? "warning" : state === "ready" ? "check" : state === "processing" ? "clock" : state === "archived" ? "note" : "document"}>
              {list.map((d) => (
                <DocumentRow key={d.id} slug={slug} doc={d} linkedNames={linkedNames} />
              ))}
            </Section>
          );
        })
      )}
    </Screen>
  );
}
