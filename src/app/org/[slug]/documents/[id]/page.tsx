import { RowGlyph } from "@/components/RowGlyph";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { applyDocument, discardDocument, isStubbedModel } from "@/lib/actions/documents";
import { Avatar, RailCard, SectionHeader } from "@/components/catalog";
import { StatusPill } from "@/components/StatusPill";
import { TEXT_ON, type Role } from "@/components/statusHue";
import { Chip } from "@/components/catalog";
import { submitClass } from "@/components/formStyles";

// One document: what was read off it, who it matched, and what happens
// next. Three shapes depending on where the pipeline routed it, because
// "applied on its own", "needs a human" and "refused" need different
// things from the reader. See docs/STYLING_CATALOG.md for the treatments.

interface DocDetail {
  id: string;
  file_name: string;
  file_size: number;
  page_count: number | null;
  category: string | null;
  requested_category: string | null;
  detected_type: string | null;
  source_role: string;
  status: string;
  route: string | null;
  failure_stage: string | null;
  failure_reason: string | null;
  extracted: Record<string, unknown> | null;
  provenance: { confidence?: number; modelConfidence?: number | null; legibility?: number | null } | null;
  triage: { legibilityScore?: number; issues?: string[]; reason?: string } | null;
  candidates: { athleteId: string; name: string; score: number; reasons: string[] }[] | null;
  athlete_id: string | null;
  athletes: { name: string } | { name: string }[] | null;
  undo_note: string | null;
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

const SOURCE_LABEL: Record<string, string> = {
  admin: "an owner",
  coordinator: "you",
  email: "email",
  parent: "a parent",
  athlete: "the athlete",
};

// Only the fields worth showing a human, in the order they matter. A raw
// jsonb dump would technically be more complete and considerably less
// useful.
const FIELD_LABEL: Record<string, string> = {
  gpa: "GPA",
  gpaScale: "GPA scale",
  gradYear: "Grad year",
  courseLoad: "Course load",
  apCount: "AP courses",
  honorsCount: "Honors courses",
  ibCount: "IB courses",
  dualCount: "Dual enrollment",
  satTotal: "SAT total",
  actComposite: "ACT composite",
  testDate: "Test date",
  school: "School",
  studentName: "Name on document",
  offerType: "Offer type",
  scholarshipPercent: "Scholarship",
  totalCostOfAttendance: "Cost of attendance",
  grantAid: "Grant aid",
  recommenderName: "Recommender",
  recommenderRole: "Their role",
};

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function confidenceRole(pct: number): Role {
  if (pct >= 70) return "high";
  if (pct >= 40) return "mid";
  return "low";
}

function displayFields(extracted: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!extracted) return [];
  return Object.entries(FIELD_LABEL)
    .filter(([key]) => extracted[key] !== undefined && extracted[key] !== null && extracted[key] !== "")
    .map(([key, label]) => ({ label, value: String(extracted[key]) }));
}

export default async function DocumentPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select(
      "id, file_name, file_size, page_count, category, requested_category, detected_type, source_role, status, route, failure_stage, failure_reason, extracted, provenance, triage, candidates, athlete_id, athletes(name), undo_note, created_at"
    )
    .eq("id", id)
    .eq("org_id", org.id)
    .single();

  if (!data) notFound();
  const doc = data as DocDetail;

  const stubbed = await isStubbedModel();
  const matched = unwrap(doc.athletes)?.name ?? null;
  const fields = displayFields(doc.extracted);
  const pct = doc.provenance?.confidence != null ? Math.round(doc.provenance.confidence * 100) : null;
  const legibility = doc.triage?.legibilityScore != null ? Math.round(doc.triage.legibilityScore * 100) : null;
  const modelPct = doc.provenance?.modelConfidence != null ? Math.round(doc.provenance.modelConfidence * 100) : null;
  const candidates = doc.candidates ?? [];
  const isApplied = doc.status === "applied";
  const isPending = doc.status === "pending";
  const isFailed = doc.status === "failed";
  const isDiscarded = doc.status === "discarded";

  // Both wrappers exist to return void: a form action's return value has
  // to be void, and applyDocument/discardDocument return a result object
  // so they can be called from elsewhere too.
  const applyAction = async (formData: FormData) => {
    "use server";
    const athleteId = String(formData.get("athleteId") ?? "");
    if (athleteId) await applyDocument(slug, doc.id, athleteId);
  };
  const discardAction = async () => {
    "use server";
    await discardDocument(slug, doc.id);
  };

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href={`/org/${slug}/documents`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Documents
        </Link>
        {isApplied && <StatusPill status="Committed" />}
        {isPending && <Chip label="Needs review" kind="warning" role="offer" />}
        {isFailed && <Chip label="Not used" kind="blocked" role="danger" />}
      </div>

      <h1 className="text-[22px] font-extrabold text-ink">
        {isFailed
          ? "Could not use this"
          : isPending
            ? candidates.length
              ? "Check this before it lands"
              : "Not sure who this is"
            : `${doc.category ? CATEGORY_LABEL[doc.category] ?? doc.category : "Document"} read`}
      </h1>
      <div className="mt-1 text-[14.5px] text-muted">
        {doc.file_name}
        {doc.page_count ? ` · ${doc.page_count} page${doc.page_count === 1 ? "" : "s"}` : ""} · from {SOURCE_LABEL[doc.source_role] ?? doc.source_role}
      </div>

      {stubbed && (
        <div className="mt-4 flex items-start gap-3 rounded-[10px] bg-paper px-3.5 py-3">
          <span className="mt-[1px]"><RowGlyph kind="warning" role="time" /></span>
          <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-bold text-ink">Simulated reading</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            No AI model is connected yet. Nothing below was read off the page; it is made up by the stand-in so the flow can be used.
          </div>
        </div>
          </div>
      )}

      {doc.requested_category === null && doc.detected_type && (
        <div className="mt-4">
          <RailCard role="place">
            <div className="text-[14.5px] font-bold text-ink">Worked out the type itself</div>
            <div className="mt-0.5 text-[12.5px] text-muted">
              Nobody told it what this was. It decided: {doc.detected_type.replace(/_/g, " ")}.
            </div>
          </RailCard>
        </div>
      )}

      {isFailed && (
        <>
          <div className="mb-2 mt-6">
            <SectionHeader label="What went wrong" count={doc.triage?.issues?.length || undefined} role="danger" />
          </div>
          <div className="flex flex-col gap-2">
            <RailCard role="danger">
              <div className="text-[14.5px] font-bold text-ink">{doc.failure_reason ?? "It could not be read."}</div>
              {legibility !== null && <div className="mt-0.5 text-[12.5px] text-muted">Legibility {legibility}%</div>}
            </RailCard>
            {(doc.triage?.issues ?? []).map((issue) => (
              <RailCard key={issue} role="danger">
                <div className="text-[14.5px] font-bold text-ink">{issue}</div>
              </RailCard>
            ))}
          </div>
          <div className="mt-6 rounded-[12px] bg-paper px-4 py-5">
            <div className="text-[14.5px] font-extrabold text-ink">Try again</div>
            <div className="mt-1 text-[12.5px] text-muted">
              Lay it flat, avoid a window behind you, and get the whole page in frame. Nothing was changed on any athlete.
            </div>
          </div>
          <div className="mt-5">
            <Link href={`/org/${slug}/documents/new`} className={`${submitClass} block w-full`}>
              Add another
            </Link>
          </div>
        </>
      )}

      {!isFailed && (
        <>
          <div className="mb-2 mt-6">
            <SectionHeader label={matched ? "Matched to" : "Pick the athlete"} count={matched ? undefined : candidates.length} role={matched ? "people" : "offer"} />
          </div>

          {matched ? (
            <RailCard role="people">
              <div className="flex items-center gap-3">
                <Avatar name={matched} />
                <div>
                  <div className="text-[15px] font-bold text-ink">{matched}</div>
                  <div className="text-[12.5px] text-muted">{candidates[0]?.reasons.join(" · ") || "Matched on the name"}</div>
                </div>
              </div>
            </RailCard>
          ) : candidates.length ? (
            <div className="flex flex-col gap-2">
              {candidates.map((c) => (
                <form key={c.athleteId} action={applyAction}>
                  <input type="hidden" name="athleteId" value={c.athleteId} />
                  <button type="submit" className="block w-full text-left">
                    <RailCard role="offer">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name} />
                          <div>
                            <div className="text-[15px] font-bold text-ink">{c.name}</div>
                            <div className="text-[12.5px] text-muted">{c.reasons.join(" · ") || "Possible match"}</div>
                          </div>
                        </div>
                        <span
                          className={`flex-shrink-0 text-[16px] font-black tabular-nums ${TEXT_ON[confidenceRole(Math.round(c.score * 100))]}`}
                        >
                          {Math.round(c.score * 100)}%
                        </span>
                      </div>
                    </RailCard>
                  </button>
                </form>
              ))}
              <p className="mt-1 text-[12px] text-muted">Tapping one applies this document to them.</p>
            </div>
          ) : (
            <RailCard role="offer">
              <div className="text-[14.5px] font-bold text-ink">No athlete on the roster looks like a match</div>
              <div className="mt-0.5 text-[12.5px] text-muted">
                {doc.extracted?.studentName ? `The document says "${String(doc.extracted.studentName)}".` : "No name was read off it."} Add them to the
                roster first, then come back.
              </div>
            </RailCard>
          )}

          {fields.length > 0 && (
            <>
              <div className="mb-2 mt-6">
                <SectionHeader label="What it says" count={fields.length} role={isApplied ? "committed" : "offer"} />
              </div>
              <div className="flex flex-col gap-2">
                {fields.map((f) => (
                  <RailCard key={f.label} role={isApplied ? "committed" : "offer"}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[14.5px] text-muted">{f.label}</div>
                      <div className="text-[15px] font-extrabold tabular-nums text-ink">{f.value}</div>
                    </div>
                  </RailCard>
                ))}
              </div>
            </>
          )}

          {pct !== null && (
            <>
              <div className="mb-2 mt-6">
                <SectionHeader label={isApplied ? "How sure" : "Why it stopped"} role={isApplied ? "committed" : "offer"} />
              </div>
              <RailCard role={isApplied ? "committed" : "offer"}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[14.5px] font-bold text-ink">
                    {pct >= 70 ? "High confidence" : pct >= 40 ? "Medium confidence" : "Low confidence"}
                  </div>
                  <div className="text-[16px] font-extrabold tabular-nums text-ink">{pct}%</div>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full ${pct >= 70 ? "bg-ios-green" : pct >= 40 ? "bg-ios-orange" : "bg-ios-gray"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-2 text-[12.5px] text-muted">
                  {modelPct !== null ? `It was ${modelPct}% sure of what it read` : "Confidence was not reported"}
                  {legibility !== null ? `, the scan was ${legibility}% legible` : ""}, and it came from {SOURCE_LABEL[doc.source_role] ?? doc.source_role}.
                  {isApplied ? " Applied without asking." : " That is not enough to change an athlete without a look."}
                </div>
              </RailCard>
            </>
          )}

          {/* What discarding actually did, kept on the row so it
              survives a reload. A discard that silently leaves an
              athlete's GPA rewritten is the bug this replaced. */}
          {isDiscarded && doc.undo_note && (
            <div className="mt-5">
              <RailCard role="target">
                <div className="text-[14.5px] font-bold text-ink">What was undone</div>
                <div className="mt-1 text-[13px] leading-tight text-muted">{doc.undo_note}</div>
              </RailCard>
            </div>
          )}

          {/* Discarding an APPLIED document is an undo, so the button
              says so. It did not exist at all before: an applied
              document could only ever be left as it was, however wrong
              it turned out to be. */}
          {isApplied && (
            <div className="mt-5">
              <RailCard role="offer">
                <div className="text-[14.5px] font-bold text-ink">Applied to the wrong athlete, or read wrong?</div>
                <div className="mt-1 text-[13px] leading-tight text-muted">
                  Discarding this now removes the courses it added and puts back the athlete&apos;s previous GPA and date of birth. Anything
                  corrected by hand since is left alone.
                </div>
              </RailCard>
            </div>
          )}

          <div className="mt-6 flex gap-2">
            <Link href={`/org/${slug}/documents`} className={`${submitClass} flex-1`}>
              Done
            </Link>
            {(isPending || isApplied) && (
              <form action={discardAction} className="flex-1">
                <button type="submit" className="w-full rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink">
                  {isApplied ? "Undo and discard" : "Discard"}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </main>
  );
}
