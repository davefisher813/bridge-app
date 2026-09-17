import { RowGlyph } from "@/components/RowGlyph";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, RailCard, SectionHeader } from "@/components/catalog";
import { TEXT_ON, type Role } from "@/components/statusHue";
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

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <path d="M14 3H7a1.5 1.5 0 00-1.5 1.5v15A1.5 1.5 0 007 21h10a1.5 1.5 0 001.5-1.5V7.5L14 3z" strokeLinejoin="round" />
      <path d="M14 3v4.5h4.5" strokeLinejoin="round" />
    </svg>
  );
}

function DocumentRow({ slug, doc, role }: { slug: string; doc: DocRow; role: Role }) {
  const athlete = unwrap(doc.athletes)?.name ?? doc.extracted?.studentName ?? null;
  const pct = doc.provenance?.confidence != null ? Math.round(doc.provenance.confidence * 100) : null;
  return (
    <Link href={`/org/${slug}/documents/${doc.id}`} className="block">
      <RailCard role={role} kind="document">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold text-ink">
              {doc.category ? CATEGORY_LABEL[doc.category] ?? doc.category : "Unrecognized"}
              {athlete ? ` · ${athlete}` : " · no match"}
            </div>
            <div className="truncate text-[12.5px] text-muted">
              {doc.status === "failed" && doc.failure_reason ? doc.failure_reason : doc.file_name} &middot; {ago(doc.created_at)}
            </div>
          </div>
          {pct !== null && (
            <span className={`flex-shrink-0 text-[16px] font-black tabular-nums ${TEXT_ON[confidenceRole(pct)]}`}>{pct}%</span>
          )}
        </div>
      </RailCard>
    </Link>
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
    .select(
      "id, file_name, category, status, route, provenance, extracted, athlete_id, athletes(name), failure_reason, created_at"
    )
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (data ?? []) as DocRow[];
  const pending = rows.filter((r) => r.status === "pending");
  const applied = rows.filter((r) => r.status === "applied");
  const problems = rows.filter((r) => r.status === "failed");
  const stubbed = await isStubbedModel();

  return (
    <main className="px-4 pt-4 pb-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[22px] font-extrabold text-ink">Documents</div>
        <Link href={`/org/${slug}/documents/new`} className="text-[13px] font-bold text-accent">
          + Add
        </Link>
      </div>

      {stubbed && (
        <div className="mb-4 flex items-start gap-3 rounded-[10px] bg-paper px-3.5 py-3">
          <span className="mt-[1px]"><RowGlyph kind="warning" role="time" /></span>
          <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-bold text-ink">Simulated reading</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            No AI model is connected yet. Anything here was made up by the stand-in, not read off a page.
          </div>
        </div>
          </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={<DocIcon />} title="No documents yet">
          <Link href={`/org/${slug}/documents/new`} className="font-bold text-accent">
            Add the first one &rarr;
          </Link>
        </EmptyState>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="Needs review" count={pending.length} role="offer" />
              </div>
              <div className="mb-6 flex flex-col gap-2">
                {pending.map((d) => (
                  <DocumentRow key={d.id} slug={slug} doc={d} role="offer" />
                ))}
              </div>
            </>
          )}

          {problems.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="Not used" count={problems.length} role="danger" />
              </div>
              <div className="mb-6 flex flex-col gap-2">
                {problems.map((d) => (
                  <DocumentRow key={d.id} slug={slug} doc={d} role="danger" />
                ))}
              </div>
            </>
          )}

          {applied.length > 0 && (
            <>
              <div className="mb-2">
                <SectionHeader label="Applied" count={applied.length} role="committed" />
              </div>
              <div className="flex flex-col gap-2">
                {applied.map((d) => (
                  <DocumentRow key={d.id} slug={slug} doc={d} role="committed" />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
