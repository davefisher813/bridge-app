// Piece 2 on the document screen: what this file probably is and who it
// is probably about, with the reasons, and the buttons a person uses to
// decide. Nothing here is linked until somebody taps Confirm.
//
// The type is shown, never set: changing a document's type arrives with
// the formal taxonomy (Piece 3). When the type picked at upload and the
// file disagree, the screen says so plainly and keeps the file.

import { AdvisorSheet, type SheetChoice } from "@/components/AdvisorSheet";
import { Avatar, Body, Button, Form, Hidden, Inline, Label, Row, Section, Stack } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { confidenceLabel, PROVISIONAL_TYPE_LABEL, type IdentityCandidate, type ProvisionalType } from "@/lib/docai/suggest";
import { NOT_AN_ATHLETE } from "@/lib/data/documentSuggestions";

// The six old upload types, as the taxonomy names them, to tell whether
// the pick and the file agree.
const OLD_TO_PROVISIONAL: Record<string, ProvisionalType> = {
  transcript: "transcript",
  test_scores: "test_score_report",
  offer_letter: "athletic_offer_letter",
  recommendation: "recommendation_letter",
  financial_aid: "financial_aid_award",
  metrics: "athletic_metrics_report",
};
const OLD_LABEL: Record<string, string> = {
  transcript: "Transcript",
  test_scores: "Test Scores",
  offer_letter: "Offer Letter",
  recommendation: "Recommendation",
  financial_aid: "Financial Aid",
  metrics: "Metrics Report",
  film: "Film",
};

export interface DocumentSuggestionData {
  suggestedType: string | null;
  suggestedTypeConfidence: number | null;
  suggestedTypeReasons: string[];
  requestedCategory: string | null;
  identityStatus: string | null;
  candidates: IdentityCandidate[];
  subject: { id: string; name: string } | null;
}

function candidateMeta(c: IdentityCandidate): string {
  return [c.school, c.gradYear ? `Class of ${c.gradYear}` : null, `${confidenceLabel(c.score)} Match`, ...c.reasons].filter(Boolean).join(" · ");
}

export function DocumentSuggestions({
  data,
  roster,
  athleteBase,
  setIdentity,
  suggestAgain,
}: {
  data: DocumentSuggestionData;
  // Where an athlete's profile lives ("/org/<slug>/roster"), so a
  // candidate can be checked before it is confirmed.
  athleteBase: string;
  // Everyone on the roster, for Someone Else.
  roster: SheetChoice[];
  setIdentity: (formData: FormData) => void | Promise<void>;
  suggestAgain: () => void | Promise<void>;
}) {
  const type = (data.suggestedType && data.suggestedType in PROVISIONAL_TYPE_LABEL ? data.suggestedType : null) as ProvisionalType | null;
  const picked = data.requestedCategory;
  const pickedAs = picked ? OLD_TO_PROVISIONAL[picked] : undefined;
  const disagrees = !!type && type !== "other" && !!pickedAs && pickedAs !== type;

  const status = data.identityStatus;
  const decided = status === "confirmed" || status === "not_an_athlete";
  const pickSomeone = (trigger: string) => (
    <AdvisorSheet
      action={setIdentity}
      choices={[{ id: NOT_AN_ATHLETE, title: "Not About an Athlete", meta: "A guide, a blank form, a schedule" }, ...roster]}
      field="athleteId"
      title="Who Is This About?"
      trigger={trigger}
      searchLabel="Search the Roster"
      currentId={status === "confirmed" ? (data.subject?.id ?? null) : status === "not_an_athlete" ? NOT_AN_ATHLETE : null}
      clearLabel={decided ? "Undo, Back to the Suggestion" : undefined}
      empty="Nobody is on the roster yet."
    />
  );

  if (status === null && type === null) {
    return (
      <Section label="Who and What" role="people" kind="info">
        <Label>No suggestion yet. This file was stored before suggestions existed.</Label>
        <Form action={suggestAgain}>
          <Button type="submit" variant="secondary">
            Suggest Who and What
          </Button>
        </Form>
      </Section>
    );
  }

  return (
    <Section label="Who and What" role="people" kind="athlete">
      <Stack gap={3}>
        {type && (
          <Stack gap={2}>
            <Body weight="semibold">{type === "other" ? "Type Not Clear" : `Likely ${PROVISIONAL_TYPE_LABEL[type]}`}</Body>
            <Label>{[type === "other" ? "Kept as Other" : `${confidenceLabel(data.suggestedTypeConfidence ?? 0)} Confidence`, ...data.suggestedTypeReasons].join(" · ")}</Label>
          </Stack>
        )}
        {disagrees && (
          <Note title={`This Looks Like ${PROVISIONAL_TYPE_LABEL[type!]}`}>
            It was uploaded as {OLD_LABEL[picked!] ?? "another type"}. The file is kept either way; choosing a different type comes with the next update.
          </Note>
        )}

        {status === "confirmed" && data.subject && (
          <Row href={`${athleteBase}/${data.subject.id}`} leading={<Avatar name={data.subject.name} />} title={data.subject.name} meta="Confirmed" role="people" trailingAction={pickSomeone("Change")} />
        )}
        {status === "not_an_athlete" && (
          <Inline>
            <Body weight="semibold">Not About an Athlete</Body>
            {pickSomeone("Change")}
          </Inline>
        )}

        {(status === "proposed" || status === "ambiguous") && (
          <>
            <Label>{status === "ambiguous" ? "More than one possible match. Pick the right one." : "Possible match. Nothing is linked until you confirm."}</Label>
            {data.candidates.map((c) => (
              <Stack key={c.athleteId} gap={2}>
                <Row href={`${athleteBase}/${c.athleteId}`} leading={<Avatar name={c.name} />} title={c.name} meta={candidateMeta(c)} role="people" wrap />
                <Form action={setIdentity}>
                  <Hidden name="athleteId" value={c.athleteId} />
                  <Button type="submit" variant={status === "proposed" ? "primary" : "secondary"}>
                    {`Confirm ${c.name}`}
                  </Button>
                </Form>
              </Stack>
            ))}
            {pickSomeone("Someone Else")}
          </>
        )}

        {status === "unmatched" && (
          <>
            <Body tone="muted">Nobody on the roster is named in it.</Body>
            {pickSomeone("Choose Who")}
            <Form action={suggestAgain}>
              <Button type="submit" variant="secondary">
                Suggest Again
              </Button>
            </Form>
          </>
        )}
        <Label>Suggested from the file name and the words in the file. A suggestion is not a check that the document is genuine.</Label>
      </Stack>
    </Section>
  );
}
