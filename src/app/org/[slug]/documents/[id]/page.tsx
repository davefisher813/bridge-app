import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { applyDocument, discardDocument, isStubbedModel, moveDocumentAndStay } from "@/lib/actions/documents";
import { ageOf, isStaleProcessing } from "@/lib/data/documentState";
import { applyRefusal, isStubReading } from "@/lib/data/readBy";
import { editableFields } from "@/lib/data/extractedEdit";
import type { DocCategoryId } from "@/lib/docai/types";
import { Avatar, Body, Button, Card, Chip, ConfirmButton, DownloadLink, Form, Hidden, Label, LinkButton, Meter, Notice, Row, Screen, Section, Stack } from "@/components/kit";
import { LifecycleChip } from "@/components/LifecycleChip";
import { longDate } from "@/lib/copy/dates";
import { formatBytes, formatLabelOf } from "@/lib/vault/format";
import { isLifecycle, isStaleProcessing as isStaleLifecycle, type Lifecycle } from "@/lib/vault/lifecycle";
import { Note } from "@/components/EligibilityVerdict";
import type { Role } from "@/components/statusHue";
import { DocumentSuggestions } from "@/components/DocumentSuggestions";
import { setDocumentIdentity, suggestDocumentAgain } from "@/lib/actions/documentIdentity";
import type { IdentityCandidate } from "@/lib/docai/suggest";

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
  athletes: { name: string; deleted_at?: string | null } | { name: string; deleted_at?: string | null }[] | null;
  undo_note: string | null;
  read_by: string | null;
  created_at: string;
  // The vault (migration 0048).
  lifecycle: string;
  lifecycle_changed_at: string | null;
  format: string | null;
  media_type: string;
  review_reason: string | null;
  uploaded_by: string | null;
  content_hash: string | null;
  original_paths: string[] | null;
  storage_paths: string[] | null;
  // Piece 2 (migration 0049).
  suggested_type: string | null;
  suggested_type_confidence: number | null;
  suggested_type_reasons: string[] | null;
  identity_status: string | null;
  identity_candidates: IdentityCandidate[] | null;
  subject_athlete_id: string | null;
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

const REMOVED_ATHLETE = "Removed Athlete";

const SOURCE_LABEL: Record<string, string> = {
  admin: "an Admin",
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
    applied: "Discarding this now removes the courses it added and puts back the athlete's previous GPA, date of birth and any high school it filled in. Anything corrected by hand since is left alone.",
    undo: "The courses it added come off and the previous GPA, date of birth and high school go back.",
  },
  test_scores: { applied: "Discarding this puts back the athlete's previous SAT and ACT. Anything corrected by hand since is left alone.", undo: "The previous SAT and ACT go back." },
  offer_letter: { applied: "Discarding this puts the college back the way it was as a target, or takes it off if this letter added it.", undo: "The college goes back the way it was as a target." },
  financial_aid: { applied: "Discarding this takes the award off the target college and rescores the match.", undo: "The award comes off the college and the match is rescored." },
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

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const error = searchParams ? (await searchParams).error : undefined;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select(
      "id, file_name, file_size, page_count, category, requested_category, detected_type, source_role, status, route, failure_stage, failure_reason, extracted, provenance, triage, candidates, athlete_id, athletes(name, deleted_at), undo_note, read_by, created_at, lifecycle, lifecycle_changed_at, format, media_type, review_reason, uploaded_by, content_hash, original_paths, storage_paths, suggested_type, suggested_type_confidence, suggested_type_reasons, identity_status, identity_candidates, subject_athlete_id"
    )
    .eq("id", id)
    .eq("org_id", org.id)
    .single();

  if (!data) notFound();
  const doc = data as DocDetail;
  const lifecycle = (isLifecycle(doc.lifecycle) ? doc.lifecycle : "needs_review") as Lifecycle;
  const { data: uploader } = doc.uploaded_by ? await supabase.from("users").select("full_name, email").eq("id", doc.uploaded_by).maybeSingle() : { data: null };
  const uploadedBy = ((uploader as { full_name?: string | null; email?: string | null } | null)?.full_name || (uploader as { email?: string | null } | null)?.email || null) as string | null;
  // The files the screen offers: the untouched originals, or for a row
  // from before the vault its one stored copy.
  const files = doc.original_paths?.length ? doc.original_paths : (doc.storage_paths ?? []);
  const stuckReading = isStaleLifecycle(lifecycle, doc.lifecycle_changed_at);

  // Who and What (Piece 2). The roster as this Admin sees it, for the
  // picker and to drop anyone removed since the suggestion was made.
  const { data: rosterRows } = await supabase.from("athletes").select("id, name, detail").eq("org_id", org.id).is("deleted_at", null).order("name", { ascending: true });
  const roster = ((rosterRows ?? []) as { id: string; name: string; detail: { highSchool?: string; currentSchool?: string; gradYear?: number } | null }[]).map((a) => ({
    id: a.id,
    title: a.name,
    meta: [a.detail?.currentSchool || a.detail?.highSchool, a.detail?.gradYear ? `Class of ${a.detail.gradYear}` : null].filter(Boolean).join(" · ") || undefined,
  }));
  const onRoster = new Map(roster.map((r) => [r.id, r.title]));
  const subjectName = doc.subject_athlete_id ? onRoster.get(doc.subject_athlete_id) : undefined;
  const liveCandidates = (doc.identity_candidates ?? []).filter((c) => onRoster.has(c.athleteId));
  const setIdentity = async (formData: FormData) => {
    "use server";
    await setDocumentIdentity(slug, doc.id, formData);
  };
  const suggestAgain = async () => {
    "use server";
    await suggestDocumentAgain(slug, doc.id);
  };
  const whoAndWhat = (
    <DocumentSuggestions
      data={{
        suggestedType: doc.suggested_type,
        suggestedTypeConfidence: doc.suggested_type_confidence,
        suggestedTypeReasons: doc.suggested_type_reasons ?? [],
        requestedCategory: doc.requested_category,
        // A confirmed athlete removed from the roster since reads as no
        // decision, never as a name that is gone.
        identityStatus:
          (doc.identity_status === "confirmed" && !subjectName) || ((doc.identity_status === "proposed" || doc.identity_status === "ambiguous") && !liveCandidates.length)
            ? "unmatched"
            : doc.identity_status === "ambiguous" && liveCandidates.length === 1
              ? "proposed"
              : doc.identity_status,
        candidates: liveCandidates,
        subject: doc.subject_athlete_id && subjectName ? { id: doc.subject_athlete_id, name: subjectName } : null,
      }}
      roster={roster}
      athleteBase={`/org/${slug}/roster`}
      setIdentity={setIdentity}
      suggestAgain={suggestAgain}
    />
  );

  const stubbed = await isStubbedModel();
  // The same gate the actions use (audit wired F1): a reading the
  // stand-in invented, or any reading while no AI key is set, is never
  // offered for applying. A document read before read_by existed needs
  // the model ledger to show a real call for it.
  const stubRead = isStubReading(doc.read_by);
  let ledgerShowsRealRead = false;
  if (doc.read_by === null && !stubbed) {
    const { data: calls } = await supabase.from("docai_usage").select("id").eq("org_id", org.id).eq("document_id", doc.id).limit(1);
    ledgerShowsRealRead = ((calls ?? []) as unknown[]).length > 0;
  }
  const refusal = applyRefusal({ readBy: doc.read_by, stubbed, ledgerShowsRealRead });
  // An athlete removed from the roster is never named or linked here:
  // the match reads "Removed Athlete", the name read off the page is
  // left out of What It Says, and a removed athlete is dropped from the
  // candidates (applyDocument refuses them anyway).
  const matchedRow = unwrap(doc.athletes);
  const matchedRemoved = !!doc.athlete_id && (!matchedRow || !!matchedRow.deleted_at);
  const matched = matchedRemoved ? REMOVED_ATHLETE : (matchedRow?.name ?? null);
  const fields = displayFields(doc.extracted).filter((f) => !(matchedRemoved && f.label === FIELD_LABEL.studentName));
  const pct = doc.provenance?.confidence != null ? Math.round(doc.provenance.confidence * 100) : null;
  const legibility = doc.triage?.legibilityScore != null ? Math.round(doc.triage.legibilityScore * 100) : null;
  const modelPct = doc.provenance?.modelConfidence != null ? Math.round(doc.provenance.modelConfidence * 100) : null;
  const candidateIds = (doc.candidates ?? []).map((c) => c.athleteId);
  const { data: liveRows } = candidateIds.length ? await supabase.from("athletes").select("id").eq("org_id", org.id).in("id", candidateIds).is("deleted_at", null) : { data: [] };
  const live = new Set(((liveRows ?? []) as { id: string }[]).map((r) => r.id));
  const candidates = (doc.candidates ?? []).filter((c) => live.has(c.athleteId));
  // Every doubt the reading raised: the model's own warnings, the
  // pipeline's checks (a number that is not a plausible reading, a date
  // in the future, a name that does not match the athlete it was pinned
  // to) and triage's issues with the scan. These used to be stored and
  // never shown, so a reviewer approving a document could not see what
  // it was unsure of.
  const modelWarnings = Array.isArray(doc.extracted?.warnings) ? (doc.extracted!.warnings as unknown[]).filter((w): w is string => typeof w === "string" && w.trim() !== "") : [];
  const flagged = [...new Set([...modelWarnings, ...(doc.triage?.issues ?? [])])];
  // Read by the reader, or filed to an athlete: there is a reading to
  // show. A file that was only stored (no type, or a format the reader
  // cannot read) has none, and the screen does not pretend it does.
  const wasRead = !!doc.extracted || !!doc.athlete_id || (doc.candidates ?? []).length > 0;
  const isApplied = doc.status === "applied";
  const isPending = doc.status === "pending";
  const isFailed = doc.status === "failed";
  const isDiscarded = doc.status === "discarded";
  const isProcessing = doc.status === "processing";
  // Sent by an Athlete login with an assignment (migration 0046). Filed,
  // never read by a model, so there is nothing to apply or correct.
  const isFiled = doc.status === "filed";
  // A reading that never finished: the row was written, the function
  // was killed. It can be cleared once it is plainly not going to end.
  const isStuck = isProcessing && isStaleProcessing(doc.created_at);

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
  // The vault's moves. Each is one conditional write on the server and
  // comes back to this page, with the reason when it is refused.
  const moveTo = (to: "ready" | "archived" | "needs_review") => async () => {
    "use server";
    await moveDocumentAndStay(slug, doc.id, to);
  };
  // What staff can correct before applying. None for a stand-in reading.
  const correctable = isPending && !stubRead && doc.category && doc.category !== "film" && doc.extracted ? editableFields(doc.category as DocCategoryId, doc.extracted).length > 0 : false;

  const headline = isFiled
    ? "Family Upload"
    : isFailed
    ? "Kept for Review"
    : isProcessing
      ? isStuck
        ? "This Reading Did Not Finish"
        : "Still Being Read"
    : isPending && !wasRead
      ? "Stored File"
      : isPending
      ? matched || candidates.length
        ? "Check This Before It Lands"
        : "Not sure who this is"
      : `${doc.category ? (CATEGORY_LABEL[doc.category] ?? doc.category) : "Document"} read`;

  // The vault's state first; what the reader did to an athlete after it,
  // when it applied a reading.
  const chip = (
    <Stack gap={2}>
      <LifecycleChip lifecycle={lifecycle} />
      {isApplied && <Chip label="Applied" kind="check" role="committed" />}
    </Stack>
  );

  // The file as it was stored: never changed after upload. Name, format,
  // size, who, when and the SHA-256 of the bytes, then a copy to save. No
  // preview in this piece; every format shows the same.
  const hash = doc.content_hash ? (doc.content_hash.match(/.{1,8}/g) ?? []).join(" ") : null;
  const facts: [string, string][] = [
    ["File Name", doc.file_name],
    ["Format", formatLabelOf(doc.format, doc.media_type)],
    ["Size", formatBytes(doc.file_size)],
    ...(uploadedBy ? ([["Uploaded By", uploadedBy]] as [string, string][]) : []),
    ["Uploaded", longDate(doc.created_at)],
    ...(hash ? ([["SHA-256", hash]] as [string, string][]) : []),
  ];
  const originalFile = (
    <Section label="Original File" role="neutral" kind="document">
      <Card isStatic>
        <Stack gap={3}>
          {facts.map(([label, value]) => (
            <Stack key={label} gap={2}>
              <Label>{label}</Label>
              <Body weight="semibold">{value}</Body>
            </Stack>
          ))}
        </Stack>
      </Card>
      {files.map((_, i) => (
        <DownloadLink key={i} href={`/org/${slug}/documents/${doc.id}/download?n=${i + 1}`}>
          {files.length === 1 ? "Download" : `Download Page ${i + 1}`}
        </DownloadLink>
      ))}
    </Section>
  );

  // The moves a person makes. Mark Ready is only ever this tap.
  const vaultButtons = (
    <>
      {lifecycle === "needs_review" && (
        <Form action={moveTo("ready")}>
          <Button type="submit">Mark Ready</Button>
        </Form>
      )}
      {(lifecycle === "needs_review" || lifecycle === "ready") && (
        <Form action={moveTo("archived")}>
          <Button type="submit" variant="secondary">
            Archive
          </Button>
        </Form>
      )}
      {lifecycle === "archived" && (
        <Form action={moveTo("needs_review")}>
          <Button type="submit">Unarchive</Button>
        </Form>
      )}
      {stuckReading && (
        <Form action={moveTo("needs_review")}>
          <Button type="submit">Move to Needs Review</Button>
        </Form>
      )}
    </>
  );

  return (
    <Screen
      title={headline}
      back={{ href: `/org/${slug}/documents`, label: "Documents" }}
      lede={`${doc.file_name}${doc.page_count ? ` · ${doc.page_count} page${doc.page_count === 1 ? "" : "s"}` : ""} · from ${SOURCE_LABEL[doc.source_role] ?? doc.source_role}`}
      action={chip}
    >
      {error && <Notice tone="danger" title={error} />}
      {doc.review_reason && lifecycle !== "ready" && lifecycle !== "archived" && <Notice tone="warning" title={doc.review_reason} />}
      {!wasRead && !isFailed ? null : isPending && refusal ? (
        <Notice tone="warning" title={stubRead ? "This Reading Can't Be Applied" : stubbed ? "AI Key Not Set" : "Reader Not Recorded"}>
          {refusal}
        </Notice>
      ) : (
        (stubbed || stubRead) && (
          <Notice tone="warning" title="Simulated Reading">
            {stubRead
              ? "This was read while no AI key was set. Nothing below was read off the page; it was made up by the stand-in."
              : "No AI model is connected yet. Nothing below was read off the page; it is made up by the stand-in so the flow can be used."}
          </Notice>
        )
      )}

      {whoAndWhat}

      {doc.requested_category === null && doc.detected_type && (
        <Note title="Worked Out the Type Itself">Nobody told it what this was. It decided: {doc.detected_type.replace(/_/g, " ")}.</Note>
      )}

      {isFiled && (
        <Note title="Sent with an Assignment">
          The athlete login handed this in. Nothing has read it and nothing on the athlete was changed. It is kept here with the assignment it answers.
        </Note>
      )}

      {isProcessing && (
        <>
          {isStuck ? (
            <>
              <Note title="It Was Cut Off">
                The reading started {ageOf(doc.created_at)} ago and never came back, so it is not going to. Nothing was changed on any athlete. Discard this and upload the file again.
              </Note>
              <Form action={discardAction}>
                <ConfirmButton title="Discard this document?" body="Nothing was applied, so nothing changes on any athlete. The file is kept, in Archived." confirmLabel="Discard">
                  Discard
                </ConfirmButton>
              </Form>
            </>
          ) : (
            <Note title="Give It a Minute">A transcript takes a minute or two to read. Come back to this page; it fills in on its own.</Note>
          )}
          {originalFile}
          {vaultButtons}
          <LinkButton href={`/org/${slug}/documents`} variant="secondary">Back to Documents</LinkButton>
        </>
      )}

      {isFailed && (
        <>
          <Section label="Why It Is Here" count={doc.triage?.issues?.length || undefined} role="offer" kind="warning">
            <Notice tone="warning" title={doc.failure_reason ?? "It could not be read."}>
              {legibility !== null ? `Legibility ${legibility}%` : undefined}
            </Notice>
            {(doc.triage?.issues ?? []).map((issue) => (
              <Note key={issue}>{issue}</Note>
            ))}
          </Section>
          <Note title="Nothing Was Lost">
            The file is kept as it came in, and nothing was changed on any athlete. If it was a poor photo, lay it flat, avoid a window behind you, and get the whole page in frame.
          </Note>
          {originalFile}
          {vaultButtons}
          <LinkButton href={`/org/${slug}/documents/new`} variant="secondary">Add Another</LinkButton>
        </>
      )}

      {!isFailed && !isProcessing && (
        <>
          {wasRead && (
          <Section label={matched ? "Matched to" : "Pick the athlete"} count={matched ? undefined : candidates.length} role={matched ? "people" : "offer"} kind="athlete">
            {matched ? (
              matchedRemoved ? (
                <Row title={matched} meta="Taken off the roster. What was read stays here." />
              ) : (
                <Row
                  href={doc.athlete_id ? `/org/${slug}/roster/${doc.athlete_id}` : undefined}
                  leading={<Avatar name={matched} />}
                  title={matched}
                  meta={candidates[0]?.reasons.join(" · ") || "Matched on the name"}
                />
              )
            ) : candidates.length && refusal ? (
              // Who it looks like, without an Apply: the reading can not
              // be put on anyone. Each row opens that athlete instead.
              candidates.map((c) => (
                <Row
                  key={c.athleteId}
                  href={`/org/${slug}/roster/${c.athleteId}`}
                  leading={<Avatar name={c.name} />}
                  title={c.name}
                  meta={`${Math.round(c.score * 100)}% · ${c.reasons.join(" · ") || "Possible match"}`}
                />
              ))
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
              </>
            ) : (
              <Note title="No athlete on the roster looks like a match">
                {doc.extracted?.studentName ? `The document says "${String(doc.extracted.studentName)}".` : "No name was read off it."} Add them to
                the roster first, then come back.
              </Note>
            )}
          </Section>
          )}

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

          {/* What applying did that was not a clean write: a metric left
              out, a school not on file, a rescoring that failed. Kept on
              the row and shown here, where the person who applied it
              looks. */}
          {isApplied && doc.failure_reason && <Note title="What Applying Did">{doc.failure_reason}</Note>}

          {/* Discarding an APPLIED document is an undo, so the button
              says so. */}
          {isApplied && <Note title="Applied to the wrong athlete, or read wrong?">{(APPLY_COPY[doc.category ?? ""] ?? APPLY_COPY.transcript!).applied}</Note>}

          {originalFile}

          <Stack>
            {vaultButtons}
            <LinkButton href={`/org/${slug}/documents`} variant="secondary">Done</LinkButton>
            {correctable && (
              <LinkButton href={`/org/${slug}/documents/${doc.id}/edit`} variant="secondary">
                Correct the Reading
              </LinkButton>
            )}
            {(isApplied || (isPending && wasRead)) && (
              <Form action={discardAction}>
                <ConfirmButton
                  title={isApplied ? "Undo and discard this document?" : "Discard this document?"}
                  body={isApplied ? (APPLY_COPY[doc.category ?? ""] ?? APPLY_COPY.transcript!).undo : "Nothing was applied, so nothing changes on any athlete. The file is kept, in Archived."}
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
