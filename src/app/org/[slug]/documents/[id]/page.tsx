import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { applyDocument, discardDocument, isStubbedModel } from "@/lib/actions/documents";
import { Avatar, Body, Button, Chip, ConfirmButton, Form, Hidden, Label, LinkButton, Meter, Notice, Row, Screen, Section, Stack } from "@/components/kit";
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
  metrics: "Metrics Report",
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
  recommenderTitle: "Their role",
  recommenderOrg: "Their organization",
  recType: "Kind of letter",
  tone: "Tone",
  letterDate: "Letter date",
  summary: "Summary",
  college: "College",
  offerDate: "Offer date",
  decisionDeadline: "Decide by",
  coachName: "Coach",
  isOfficial: "Official",
  documentType: "Document type",
  academicYear: "Academic year",
  netCost: "Net cost",
  efc: "EFC",
  sai: "SAI",
  tests: "Tests",
  awards: "Awards",
  source: "Measured by",
  eventName: "Event",
  measuredOn: "Measured on",
  metrics: "Metrics",
};

// What applying each type does, and what discarding puts back. The
// transcript wording is the original; the rest arrived with the four
// other applies (2026-09-21).
const APPLY_COPY: Record<string, { applied: string; undo: string }> = {
  transcript: {
    applied: "Discarding this now removes the courses it added and puts back the athlete's previous GPA and date of birth. Anything corrected by hand since is left alone.",
    undo: "The courses it added come off and the previous GPA and date of birth go back.",
  },
  test_scores: { applied: "Discarding this puts back the athlete's previous SAT and ACT. Anything corrected by hand since is left alone.", undo: "The previous SAT and ACT go back." },
  offer_letter: { applied: "Discarding this puts the college back the way it was on the board, or takes it off if this letter added it.", undo: "The college goes back the way it was on the board." },
  financial_aid: { applied: "Discarding this takes the award off the college on the board and rescores the match.", undo: "The award comes off the college and the match is rescored." },
  recommendation: { applied: "Discarding this removes the contact it added.", undo: "The contact it added comes off." },
  metrics: { applied: "Discarding this removes the metric entries it logged and rescores the matches.", undo: "The metric entries it logged come off the log." },
};

// A list read off the document, in one line a person can scan.
function summarizeList(key: string, value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (key === "tests") {
    return (value as { type?: string; totalScore?: number | null; testDate?: string }[])
      .map((t) => `${t.type ?? "Test"} ${t.totalScore ?? "?"}${t.testDate ? ` (${t.testDate})` : ""}`)
      .join(", ");
  }
  if (key === "metrics") {
    return (value as { key?: string; value?: number }[]).map((m) => `${m.key ?? "?"} ${m.value ?? "?"}`).join(", ");
  }
  if (key === "awards") {
    return (value as { name?: string; amount?: number; type?: string }[]).map((a) => `${a.name || a.type || "Award"} $${Math.round(a.amount ?? 0).toLocaleString("en-US")}`).join(", ");
  }
  return value.map(String).join(", ");
}

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
    .map(([key, label]) => {
      const v = extracted[key];
      const list = summarizeList(key, v);
      const value = list ?? (typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" && /cost|efc|sai/i.test(key) ? `$${Math.round(v).toLocaleString("en-US")}` : String(v));
      return { label, value };
    })
    .filter((f) => f.value !== "");
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
  // Every doubt the reading raised: the model's own warnings, the
  // pipeline's checks (a number that is not a plausible reading, a date
  // in the future, a name that does not match the athlete it was pinned
  // to) and triage's issues with the scan. These used to be stored and
  // never shown, so a reviewer approving a document could not see what
  // it was unsure of.
  const modelWarnings = Array.isArray(doc.extracted?.warnings) ? (doc.extracted!.warnings as unknown[]).filter((w): w is string => typeof w === "string" && w.trim() !== "") : [];
  const flagged = [...new Set([...modelWarnings, ...(doc.triage?.issues ?? [])])];
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
    ? "Could Not Use This"
    : isPending
      ? matched || candidates.length
        ? "Check This Before It Lands"
        : "Not sure who this is"
      : `${doc.category ? (CATEGORY_LABEL[doc.category] ?? doc.category) : "Document"} read`;

  const chip = isApplied ? (
    <Chip label="Applied" kind="check" role="committed" />
  ) : isPending ? (
    <Chip label="Needs Review" kind="warning" role="offer" />
  ) : isFailed ? (
    <Chip label="Not Used" kind="blocked" role="danger" />
  ) : undefined;

  return (
    <Screen
      title={headline}
      back={{ href: `/org/${slug}/documents`, label: "Documents" }}
      lede={`${doc.file_name}${doc.page_count ? ` · ${doc.page_count} page${doc.page_count === 1 ? "" : "s"}` : ""} · from ${SOURCE_LABEL[doc.source_role] ?? doc.source_role}`}
      action={chip}
    >
      {stubbed && (
        <Notice tone="warning" title="Simulated Reading">
          No AI model is connected yet. Nothing below was read off the page; it is made up by the stand-in so the flow can be used.
        </Notice>
      )}

      {doc.requested_category === null && doc.detected_type && (
        <Note title="Worked Out the Type Itself">Nobody told it what this was. It decided: {doc.detected_type.replace(/_/g, " ")}.</Note>
      )}

      {isFailed && (
        <>
          <Section label="What Went Wrong" count={doc.triage?.issues?.length || undefined} role="danger" kind="blocked">
            <Notice tone="danger" title={doc.failure_reason ?? "It could not be read."}>
              {legibility !== null ? `Legibility ${legibility}%` : undefined}
            </Notice>
            {(doc.triage?.issues ?? []).map((issue) => (
              <Note key={issue}>{issue}</Note>
            ))}
          </Section>
          <Note title="Try Again">
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
            <Section label="What It Says" count={fields.length} role={isApplied ? "committed" : "offer"} kind="document">
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

          {flagged.length > 0 && (
            <Section label="What It Flagged" count={flagged.length} role="offer" kind="warning">
              {flagged.map((w) => (
                <Note key={w}>{w}</Note>
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
          {isDiscarded && doc.undo_note && <Note title="What Was Undone">{doc.undo_note}</Note>}

          {/* Discarding an APPLIED document is an undo, so the button
              says so. */}
          {isApplied && <Note title="Applied to the wrong athlete, or read wrong?">{(APPLY_COPY[doc.category ?? ""] ?? APPLY_COPY.transcript!).applied}</Note>}

          <Stack>
            <LinkButton href={`/org/${slug}/documents`}>Done</LinkButton>
            {(isPending || isApplied) && (
              <Form action={discardAction}>
                <ConfirmButton
                  title={isApplied ? "Undo and discard this document?" : "Discard this document?"}
                  body={isApplied ? (APPLY_COPY[doc.category ?? ""] ?? APPLY_COPY.transcript!).undo : "Nothing was applied, so nothing changes on any athlete."}
                  confirmLabel={isApplied ? "Undo and Discard" : "Discard"}
                >
                  {isApplied ? "Undo and Discard" : "Discard"}
                </ConfirmButton>
              </Form>
            )}
          </Stack>
        </>
      )}
    </Screen>
  );
}
