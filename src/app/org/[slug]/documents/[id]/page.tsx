import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { applyDocument, discardDocument, isStubbedModel } from "@/lib/actions/documents";
import { Avatar, Body, Button, Chip, Form, Hidden, Label, LinkButton, Meter, Notice, Row, Screen, Section, Stack } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { Role } from "@/components/statusHue";

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

  const headline = isFailed
    ? "Could not use this"
    : isPending
      ? candidates.length
        ? "Check this before it lands"
        : "Not sure who this is"
      : `${doc.category ? (CATEGORY_LABEL[doc.category] ?? doc.category) : "Document"} read`;

  const chip = isApplied ? (
    <Chip label="Applied" kind="check" role="committed" />
  ) : isPending ? (
    <Chip label="Needs review" kind="warning" role="offer" />
  ) : isFailed ? (
    <Chip label="Not used" kind="blocked" role="danger" />
  ) : undefined;

  return (
    <Screen
      title={headline}
      back={{ href: `/org/${slug}/documents`, label: "Documents" }}
      lede={`${doc.file_name}${doc.page_count ? ` · ${doc.page_count} page${doc.page_count === 1 ? "" : "s"}` : ""} · from ${SOURCE_LABEL[doc.source_role] ?? doc.source_role}`}
      action={chip}
    >
      {stubbed && (
        <Notice tone="warning" title="Simulated reading">
          No AI model is connected yet. Nothing below was read off the page; it is made up by the stand-in so the flow can be used.
        </Notice>
      )}

      {doc.requested_category === null && doc.detected_type && (
        <Note title="Worked out the type itself">Nobody told it what this was. It decided: {doc.detected_type.replace(/_/g, " ")}.</Note>
      )}

      {isFailed && (
        <>
          <Section label="What went wrong" count={doc.triage?.issues?.length || undefined} role="danger" kind="blocked">
            <Notice tone="danger" title={doc.failure_reason ?? "It could not be read."}>
              {legibility !== null ? `Legibility ${legibility}%` : undefined}
            </Notice>
            {(doc.triage?.issues ?? []).map((issue) => (
              <Note key={issue}>{issue}</Note>
            ))}
          </Section>
          <Note title="Try again">
            Lay it flat, avoid a window behind you, and get the whole page in frame. Nothing was changed on any athlete.
          </Note>
          <LinkButton href={`/org/${slug}/documents/new`}>Add Another</LinkButton>
        </>
      )}

      {!isFailed && (
        <>
          <Section label={matched ? "Matched to" : "Pick the athlete"} count={matched ? undefined : candidates.length} role={matched ? "people" : "offer"} kind="athlete">
            {matched ? (
              <Row leading={<Avatar name={matched} />} title={matched} meta={candidates[0]?.reasons.join(" · ") || "Matched on the name"} />
            ) : candidates.length ? (
              <>
                {candidates.map((c) => (
                  <Form key={c.athleteId} action={applyAction}>
                    <Hidden name="athleteId" value={c.athleteId} />
                    <Row
                      leading={<Avatar name={c.name} />}
                      title={c.name}
                      meta={`${Math.round(c.score * 100)}% · ${c.reasons.join(" · ") || "Possible match"}`}
                      trailing={
                        <Button variant="secondary" inline>
                          Apply
                        </Button>
                      }
                    />
                  </Form>
                ))}
                <Label>Applying puts what was read onto that athlete.</Label>
              </>
            ) : (
              <Note title="No athlete on the roster looks like a match">
                {doc.extracted?.studentName ? `The document says "${String(doc.extracted.studentName)}".` : "No name was read off it."} Add them to
                the roster first, then come back.
              </Note>
            )}
          </Section>

          {fields.length > 0 && (
            <Section label="What it says" count={fields.length} role={isApplied ? "committed" : "offer"} kind="document">
              {fields.map((f) => (
                <Row
                  key={f.label}
                  title={f.label}
                  emphasis="semibold"
                  trailing={
                    <Body weight="bold" numeric>
                      {f.value}
                    </Body>
                  }
                />
              ))}
            </Section>
          )}

          {pct !== null && (
            <Section label={isApplied ? "How sure" : "Why it stopped"} role={isApplied ? "committed" : "offer"} kind="info">
              <Stack gap={2}>
                <Row
                  title={pct >= 70 ? "High confidence" : pct >= 40 ? "Medium confidence" : "Low confidence"}
                  trailing={
                    <Body weight="bold" numeric tone={confidenceRole(pct)}>
                      {pct}%
                    </Body>
                  }
                />
                <Meter parts={[{ role: confidenceRole(pct), fraction: pct / 100 }]} />
                <Label>
                  {modelPct !== null ? `It was ${modelPct}% sure of what it read` : "Confidence was not reported"}
                  {legibility !== null ? `, the scan was ${legibility}% legible` : ""}, and it came from {SOURCE_LABEL[doc.source_role] ?? doc.source_role}.
                  {isApplied ? " Applied without asking." : " That is not enough to change an athlete without a look."}
                </Label>
              </Stack>
            </Section>
          )}

          {/* What discarding actually did, kept on the row so it
              survives a reload. A discard that silently leaves an
              athlete's GPA rewritten is the bug this replaced. */}
          {isDiscarded && doc.undo_note && <Note title="What was undone">{doc.undo_note}</Note>}

          {/* Discarding an APPLIED document is an undo, so the button
              says so. */}
          {isApplied && (
            <Note title="Applied to the wrong athlete, or read wrong?">
              Discarding this now removes the courses it added and puts back the athlete&apos;s previous GPA and date of birth. Anything
              corrected by hand since is left alone.
            </Note>
          )}

          <Stack>
            <LinkButton href={`/org/${slug}/documents`}>Done</LinkButton>
            {(isPending || isApplied) && (
              <Form action={discardAction}>
                <Button variant="destructive">{isApplied ? "Undo and Discard" : "Discard"}</Button>
              </Form>
            )}
          </Stack>
        </>
      )}
    </Screen>
  );
}
