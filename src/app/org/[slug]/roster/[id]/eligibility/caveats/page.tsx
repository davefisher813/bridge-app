// Every caveat on an eligibility verdict, in full, plus what to do about
// each kind.
//
// The verdict screen shows the first few warnings and a count. That is
// the right density there and it hides the thing this product exists to
// prevent: a verdict that looks settled and is actually resting on an
// assumed grading scale and a half-typed approved list. The count says
// "6 things to know". This page says which six, and which of them
// somebody can clear today.
//
// It reads from loadEligibility, the same loader the verdict uses, so a
// caveat cannot appear on one screen and not the other.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { EmptyState, Notice, Prose, Row, Screen, Section } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { loadEligibility } from "@/lib/data/loadEligibility";

export const dynamic = "force-dynamic";

export default async function CaveatsPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const today = new Date().toISOString().slice(0, 10);
  const bundle = await loadEligibility(org.id, id, today);
  if (!bundle) notFound();

  const { view, athlete } = bundle;

  // Two sources, deliberately kept apart in the data and joined here.
  // An adapter warning is about what the app could not read (no scale on
  // file, an unmatched course); an eligibility warning is about the
  // athlete's standing itself. They read as one list to a coordinator and
  // they are cleared in completely different ways.
  const dataCaveats = view.adapterWarnings;
  const standingCaveats = view.eligibility.warnings;
  const total = dataCaveats.length + standingCaveats.length;

  return (
    <Screen
      title="Things to Know"
      back={{ href: `/org/${slug}/roster/${id}/eligibility`, label: "NCAA Eligibility" }}
      lede={`${athlete.name} · ${total} ${total === 1 ? "item" : "items"}`}
    >
      {total === 0 ? (
        <EmptyState kind="check" role="committed" title="Nothing outstanding">
          Every core course is matched to an approved list and every school has a grading scale on file. The verdict is built on real data
          rather than defaults.
        </EmptyState>
      ) : (
        <>
          {/* Data caveats first, because they are the ones somebody can
              clear. A coordinator who reads the standing caveats first
              takes the verdict as final and stops. */}
          {dataCaveats.length > 0 && (
            <Section label="What the app could not read" count={dataCaveats.length} role="offer" kind="warning">
              {dataCaveats.map((w, i) => (
                <Note key={i}>{w}</Note>
              ))}
              <Notice tone="info" title="Gaps in what has been entered, not findings about the athlete">
                Each one is something the verdict is currently guessing at, and each one can be closed.
              </Notice>
            </Section>
          )}

          {standingCaveats.length > 0 && (
            <Section label="About their standing" count={standingCaveats.length} role="contact" kind="checklist">
              {standingCaveats.map((w, i) => (
                <Note key={i}>{w}</Note>
              ))}
            </Section>
          )}
        </>
      )}

      {/* Always rendered, even when nothing is fixable, because the
          transcript is the answer to "so what do I do with this" on
          every one of these screens. The two named actions appear above
          it when they apply: "enter a grading scale" is advice, "enter
          one for Cardinal Ridge" is a task. */}
      <Section label="What to do" role="accent" kind="info">
        {view.schoolsMissingScale.length > 0 && (
          <Row
            href={`/org/${slug}/grading-scales/new`}
            kind="scale"
            role="offer"
            title="Enter a grading scale"
            meta={`${view.schoolsMissingScale.join(", ")}. Until then the core GPA assumes a ten-point scale.`}
            wrap
          />
        )}
        {view.schoolsMissingApprovedList.length > 0 && (
          <Row
            href={`/org/${slug}/approved-courses/new`}
            kind="checklist"
            role="offer"
            title="Enter an approved course list"
            meta={`${view.schoolsMissingApprovedList.join(", ")}. Without one, no course can be confirmed as counting.`}
            wrap
          />
        )}
        <Row
          href={`/org/${slug}/roster/${id}/transcript`}
          kind="course"
          role="contact"
          title="See the transcript"
          meta="Every course the core GPA counted, and every one it did not."
        />
        {canEdit && (
          <Row
            href={`/org/${slug}/roster/${id}/eligibility/approvals`}
            kind="checklist"
            role="contact"
            title="Check course approvals"
            meta="Settle the courses a list could not match on its own."
          />
        )}
      </Section>

      {/* The line that belongs at the bottom of every eligibility screen
          and is easiest to forget on the one that lists the doubts. */}
      <Prose>A projection until every core credit is final. Confirm with the NCAA Eligibility Center before anyone signs anything.</Prose>
    </Screen>
  );
}
